using System.Collections.Concurrent;
using System.Text.Json.Serialization;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace FlowAnalyzer;

public sealed record DbColumn(string Name, string Column, string Type, bool Key, bool Nullable, int? MaxLength);

/// <summary>What a database card shows: the table an EF query touches, its columns, and what the query does.</summary>
public sealed record DbSchema(
    string Entity, string Table, string? DbSchemaName, string Context,
    List<DbColumn> Columns, List<string> Relations, List<string> Ops, bool Writes,
    string? File, int Line)
{
    /// <summary>The table name is not written in the code (no [Table], no ToTable): a naming default, so the card says "table?". Not sent to the canvas; the edge carries it.</summary>
    [JsonIgnore] public bool Guess { get; init; }
}

/// <summary>Where an entity or its configuration is written: an edit that lands in one of these lines changes the entity.</summary>
public sealed record TableSpan(string File, int Line, int EndLine);

/// <summary>An entity and the table it maps to (the shape editor/extensions/flow-view/src/poly/model.ts calls TableEntity).</summary>
public sealed record TableEntity(string Entity, string Table, string? SchemaName, string Orm, bool Guess, List<TableSpan> Spans);

public sealed record EntitiesFact(int Version, List<TableEntity> Entities);

/// <summary>
/// Reads the EF Core model from source: entity properties, data annotations, and the fluent
/// configuration in <c>IEntityTypeConfiguration&lt;T&gt;</c> classes (ToTable, HasKey, HasColumnName,
/// HasMaxLength, IsRequired, Ignore, HasOne/HasMany).
/// </summary>
public sealed class SchemaReader
{
    private readonly Func<Task<List<INamedTypeSymbol>>> _sourceTypes;
    private readonly Func<SyntaxTree, Task<SemanticModel?>> _model;
    private readonly ConcurrentDictionary<string, Task<Entity>> _cache = new();

    private sealed record Entity(string Table, string? Schema, List<DbColumn> Columns, List<string> Relations, string? File, int Line, bool Explicit, List<TableSpan> Spans);

    private static readonly HashSet<string> WriteOps = new() { "Add", "AddAsync", "AddRange", "AddRangeAsync", "Update", "UpdateRange", "Remove", "RemoveRange", "Attach", "ExecuteUpdate", "ExecuteUpdateAsync", "ExecuteDelete", "ExecuteDeleteAsync" };

    public SchemaReader(Func<Task<List<INamedTypeSymbol>>> sourceTypes, Func<SyntaxTree, Task<SemanticModel?>> model)
    {
        _sourceTypes = sourceTypes;
        _model = model;
    }

    public void Clear() => _cache.Clear();

    public async Task<DbSchema?> ForAsync(ITypeSymbol context, string? member, IReadOnlyList<string> ops, IReadOnlyList<ITypeSymbol> setTypeArgs)
    {
        ITypeSymbol? entity = null;
        if (member != null)
        {
            var prop = AllMembers(context).OfType<IPropertySymbol>().FirstOrDefault(p => p.Name == member);
            if (prop?.Type is INamedTypeSymbol { IsGenericType: true } set && set.Name == "DbSet") entity = set.TypeArguments[0];
        }
        entity ??= setTypeArgs.FirstOrDefault();   // _db.Set<T>()
        var writes = ops.Any(WriteOps.Contains) || ops.Any(o => o.StartsWith("SaveChanges"));
        if (entity == null) return null;
        var e = await _cache.GetOrAdd(entity.ToDisplayString(), _ => ReadAsync(entity, member));
        return new DbSchema(entity.Name, e.Table, e.Schema, context.Name, e.Columns, e.Relations, ops.ToList(), writes, e.File, e.Line) { Guess = !e.Explicit };
    }

    /// <summary>
    /// Every entity the model maps, with its table: the DbSet&lt;T&gt; element types of every DbContext in source, and every T that has an
    /// IEntityTypeConfiguration&lt;T&gt;. Where an entity is written (and its configuration classes) says which edits change it.
    /// </summary>
    public async Task<List<TableEntity>> EntitiesAsync()
    {
        var types = await _sourceTypes();
        var found = new Dictionary<string, (ITypeSymbol Type, string? Member)>();
        foreach (var t in types)
        {
            if (!InheritsFrom(t, "DbContext")) continue;
            foreach (var p in AllMembers(t).OfType<IPropertySymbol>())
                if (p.Type is INamedTypeSymbol { IsGenericType: true } set && set.Name == "DbSet" && set.TypeArguments.Length == 1)
                    found.TryAdd(set.TypeArguments[0].ToDisplayString(), (set.TypeArguments[0], p.Name));
        }
        foreach (var t in types)
            foreach (var i in t.AllInterfaces.Where(i => i.Name == "IEntityTypeConfiguration" && i.TypeArguments.Length == 1))
                found.TryAdd(i.TypeArguments[0].ToDisplayString(), (i.TypeArguments[0], null));
        foreach (var t in types.Where(t => InheritsFrom(t, "DbContext")))
            foreach (var syntaxRef in t.DeclaringSyntaxReferences)
            {
                var node = await syntaxRef.GetSyntaxAsync();
                var model = await _model(node.SyntaxTree);
                if (model == null) continue;
                foreach (var call in node.DescendantNodes().OfType<InvocationExpressionSyntax>())
                    if (call.Expression is MemberAccessExpressionSyntax { Name: GenericNameSyntax { Identifier.Text: "Entity", TypeArgumentList.Arguments.Count: 1 } gn }
                        && model.GetTypeInfo(gn.TypeArgumentList.Arguments[0]).Type is { } mapped && mapped.Locations.Any(l => l.IsInSource))
                        found.TryAdd(mapped.ToDisplayString(), (mapped, null));
            }
        var list = new List<TableEntity>();
        foreach (var (entity, member) in found.Values)
        {
            var e = await _cache.GetOrAdd(entity.ToDisplayString(), _ => ReadAsync(entity, member));
            if (e.Spans.Count > 0) list.Add(new TableEntity(entity.Name, e.Table, e.Schema, "EF Core", !e.Explicit, e.Spans));
        }
        return list;
    }

    private static bool InheritsFrom(ITypeSymbol? t, string name)
    {
        for (; t != null; t = t.BaseType)
            if (t.Name == name) return true;
        return false;
    }

    private static async Task<TableSpan?> SpanOfAsync(SyntaxReference r) => SpanOf(await r.GetSyntaxAsync());

    private static TableSpan? SpanOf(SyntaxNode node)
    {
        var span = node.GetLocation().GetLineSpan();
        return span.Path is { Length: > 0 } path ? new TableSpan(path, span.StartLinePosition.Line + 1, span.EndLinePosition.Line + 1) : null;
    }

    private static IEnumerable<ISymbol> AllMembers(ITypeSymbol t)
    {
        for (var c = t; c != null && c.SpecialType != SpecialType.System_Object; c = c.BaseType)
            foreach (var m in c.GetMembers()) yield return m;
    }

    private static bool IsScalar(ITypeSymbol t)
    {
        if (t is IArrayTypeSymbol a) return a.ElementType.SpecialType == SpecialType.System_Byte;
        if (t.SpecialType != SpecialType.None || t.TypeKind == TypeKind.Enum) return true;
        var name = t.OriginalDefinition.ToDisplayString();
        if (name == "System.Nullable<T>") return IsScalar(((INamedTypeSymbol)t).TypeArguments[0]);
        return name is "System.DateTime" or "System.DateTimeOffset" or "System.Guid" or "System.TimeSpan" or "System.DateOnly" or "System.TimeOnly" or "System.Decimal";
    }

    private static string Short(ITypeSymbol t) => t.ToDisplayString(SymbolDisplayFormat.MinimallyQualifiedFormat);

    /// <summary>Member names in a lambda body: <c>e =&gt; e.A</c> or <c>e =&gt; new { e.A, e.B }</c>.</summary>
    private static List<string> LambdaMembers(ExpressionSyntax? arg)
    {
        var body = (arg as LambdaExpressionSyntax)?.Body as ExpressionSyntax;
        if (body == null) return new();
        return body.DescendantNodesAndSelf().OfType<MemberAccessExpressionSyntax>().Select(m => m.Name.Identifier.Text).Distinct().ToList();
    }

    private static string? StringArg(InvocationExpressionSyntax inv, int i) =>
        inv.ArgumentList.Arguments.Count > i && inv.ArgumentList.Arguments[i].Expression is LiteralExpressionSyntax { RawKind: (int)SyntaxKind.StringLiteralExpression } l ? l.Token.ValueText : null;

    private static string? MethodName(InvocationExpressionSyntax inv) => inv.Expression switch
    {
        MemberAccessExpressionSyntax ma => ma.Name.Identifier.Text,
        IdentifierNameSyntax id => id.Identifier.Text,
        GenericNameSyntax g => g.Identifier.Text,
        _ => null,
    };

    private async Task<Entity> ReadAsync(ITypeSymbol entity, string? member)
    {
        string? table = null, schema = null;
        var spans = new List<TableSpan>();
        foreach (var r in entity.DeclaringSyntaxReferences)
            if (await SpanOfAsync(r) is { } own) spans.Add(own);
        var keys = new List<string>();
        var colName = new Dictionary<string, string>();
        var maxLen = new Dictionary<string, int>();
        var required = new HashSet<string>();
        var ignored = new HashSet<string>();
        var relations = new List<string>();

        // Data annotations.
        foreach (var a in entity.GetAttributes())
            if (a.AttributeClass?.Name == "TableAttribute" && a.ConstructorArguments.Length > 0)
            {
                table = a.ConstructorArguments[0].Value as string;
                schema = a.NamedArguments.FirstOrDefault(n => n.Key == "Schema").Value.Value as string;
            }

        // What a fluent call says about the entity: the table, key, column names, lengths, relations.
        void Apply(IEnumerable<InvocationExpressionSyntax> invocations)
        {
            foreach (var inv in invocations)
            {
                var name = MethodName(inv);
                var arg0 = inv.ArgumentList.Arguments.FirstOrDefault()?.Expression;
                switch (name)
                {
                    case "ToTable":
                        table = StringArg(inv, 0) ?? table;
                        schema = StringArg(inv, 1) ?? schema;
                        break;
                    case "HasKey":
                        keys = LambdaMembers(arg0);
                        break;
                    case "Ignore":
                        ignored.UnionWith(LambdaMembers(arg0));
                        break;
                    case "HasOne":
                    case "HasMany":
                        foreach (var nav in LambdaMembers(arg0)) relations.Add($"{(name == "HasOne" ? "one" : "many")} {nav}");
                        break;
                    case "HasColumnName":
                    case "HasMaxLength":
                    case "IsRequired":
                        // Walk down the chain to the Property(e => e.X) call it configures.
                        ExpressionSyntax? e = (inv.Expression as MemberAccessExpressionSyntax)?.Expression;
                        while (e is InvocationExpressionSyntax inner && MethodName(inner) != "Property")
                            e = (inner.Expression as MemberAccessExpressionSyntax)?.Expression;
                        if (e is not InvocationExpressionSyntax prop) break;
                        var p = LambdaMembers(prop.ArgumentList.Arguments.FirstOrDefault()?.Expression).FirstOrDefault();
                        if (p == null) break;
                        if (name == "HasColumnName" && StringArg(inv, 0) is { } c) colName[p] = c;
                        if (name == "HasMaxLength" && arg0 is LiteralExpressionSyntax lit && lit.Token.Value is int n) maxLen[p] = n;
                        if (name == "IsRequired") required.Add(p);
                        break;
                }
            }
        }

        // Fluent configuration classes for this entity.
        var wanted = entity.OriginalDefinition.ToDisplayString();
        foreach (var t in await _sourceTypes())
        {
            var cfg = t.AllInterfaces.FirstOrDefault(i => i.Name == "IEntityTypeConfiguration" && i.TypeArguments.Length == 1 &&
                i.TypeArguments[0].OriginalDefinition.ToDisplayString() == wanted);
            if (cfg == null) continue;
            foreach (var syntaxRef in t.DeclaringSyntaxReferences)
            {
                if (await SpanOfAsync(syntaxRef) is { } configured) spans.Add(configured);
                Apply((await syntaxRef.GetSyntaxAsync()).DescendantNodes().OfType<InvocationExpressionSyntax>());
            }
        }

        // The same calls written in a DbContext: modelBuilder.Entity<T>().ToTable("x").HasKey(...) or modelBuilder.Entity<T>(b => { ... }).
        // Each statement that configures this entity counts as part of it, so an edit there changes the entity.
        foreach (var t in await _sourceTypes())
        {
            if (!InheritsFrom(t, "DbContext")) continue;
            foreach (var syntaxRef in t.DeclaringSyntaxReferences)
            {
                var node = await syntaxRef.GetSyntaxAsync();
                if (!node.DescendantNodes().OfType<InvocationExpressionSyntax>().Any(i => i.Expression is MemberAccessExpressionSyntax { Name: GenericNameSyntax { Identifier.Text: "Entity" } })) continue;
                var model = await _model(node.SyntaxTree);
                if (model == null) continue;
                foreach (var call in node.DescendantNodes().OfType<InvocationExpressionSyntax>())
                {
                    if (call.Expression is not MemberAccessExpressionSyntax { Name: GenericNameSyntax { Identifier.Text: "Entity", TypeArgumentList.Arguments.Count: 1 } gn }) continue;
                    if (model.GetTypeInfo(gn.TypeArgumentList.Arguments[0]).Type?.OriginalDefinition.ToDisplayString() != wanted) continue;
                    var scope = new List<InvocationExpressionSyntax>();
                    for (SyntaxNode cur = call; cur.Parent is MemberAccessExpressionSyntax up && up.Expression == cur && up.Parent is InvocationExpressionSyntax next; cur = next) scope.Add(next);
                    if (call.ArgumentList.Arguments.FirstOrDefault()?.Expression is LambdaExpressionSyntax lambda)
                        scope.AddRange(lambda.DescendantNodes().OfType<InvocationExpressionSyntax>());
                    if (call.Ancestors().OfType<StatementSyntax>().FirstOrDefault() is { } statement && SpanOf(statement) is { } stated) spans.Add(stated);
                    Apply(scope);
                }
            }
        }

        var columns = new List<DbColumn>();
        var seen = new HashSet<string>();
        // Base type properties first (Id usually lives there), then the entity's own.
        var chain = new List<ITypeSymbol>();
        for (var c = entity; c != null && c.SpecialType != SpecialType.System_Object; c = c.BaseType) chain.Insert(0, c);
        foreach (var t in chain)
            foreach (var p in t.GetMembers().OfType<IPropertySymbol>())
            {
                if (p.IsStatic || p.DeclaredAccessibility != Accessibility.Public || ignored.Contains(p.Name) || !seen.Add(p.Name)) continue;
                if (p.GetAttributes().Any(a => a.AttributeClass?.Name == "NotMappedAttribute")) continue;
                if (!IsScalar(p.Type))
                {
                    if (!relations.Any(r => r.EndsWith(" " + p.Name)))
                        relations.Add(p.Type is INamedTypeSymbol { IsGenericType: true } g && g.TypeArguments.Length == 1 ? $"many {p.Name}" : $"one {p.Name}");
                    continue;
                }
                var attrCol = p.GetAttributes().FirstOrDefault(a => a.AttributeClass?.Name == "ColumnAttribute")?.ConstructorArguments.FirstOrDefault().Value as string;
                var attrLen = p.GetAttributes().FirstOrDefault(a => a.AttributeClass?.Name is "MaxLengthAttribute" or "StringLengthAttribute")?.ConstructorArguments.FirstOrDefault().Value as int?;
                var isKey = keys.Count > 0 ? keys.Contains(p.Name) : p.GetAttributes().Any(a => a.AttributeClass?.Name == "KeyAttribute") || p.Name == "Id" || p.Name == entity.Name + "Id";
                var nullable = !isKey && !required.Contains(p.Name) && (p.Type.NullableAnnotation == NullableAnnotation.Annotated || p.Type.OriginalDefinition.SpecialType == SpecialType.System_Nullable_T || !p.Type.IsValueType);
                columns.Add(new DbColumn(p.Name, colName.GetValueOrDefault(p.Name) ?? attrCol ?? p.Name, Short(p.Type).TrimEnd('?'), isKey, nullable, maxLen.TryGetValue(p.Name, out var ml) ? ml : attrLen));
            }

        var loc = entity.Locations.FirstOrDefault(l => l.IsInSource);
        return new Entity(table ?? member ?? entity.Name, schema, columns.OrderByDescending(c => c.Key).ToList(), relations.Distinct().ToList(),
            loc?.SourceTree?.FilePath, (loc?.GetLineSpan().StartLinePosition.Line ?? 0) + 1, table != null, spans);
    }
}
