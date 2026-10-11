using Microsoft.CodeAnalysis;

namespace FlowAnalyzer;

// The wire shapes of GET /api/types: editor/extensions/flow-view/src/types/wire.ts names the same fields (camelCase on the wire).

/// <summary>A parameter or constructor parameter. `Refs` are the fully qualified names of the source types it is made of (collections, Task, ActionResult and nullables seen through).</summary>
public sealed record CsParam(string Name, string Type, List<string> Refs, bool IsCollection, bool Nullable, string? Source);

public sealed record CsMember(string Name, string Kind, string Type, List<string> Refs, bool IsCollection, bool Nullable, string Visibility, bool IsStatic, int Line);

public sealed record CsMethod(
    string Name, string Signature, string ReturnType, List<string> ReturnRefs, bool ReturnIsCollection, List<CsParam> Parameters,
    string Visibility, bool IsStatic, bool IsAbstract, List<string> Attributes, int Line, int EndLine);

public sealed record CsType(
    string Fqn, string Name, string Namespace, string Project, string Kind, string File, int Line, int EndLine,
    string? BaseType, List<string> Interfaces, List<string> Attributes, bool IsAbstract, bool IsStatic, List<string> TypeParameters,
    List<CsMember> Fields, List<CsMethod> Methods, List<CsParam> ConstructorParameters, List<string> EnumMembers);

/// <summary>A controller action with the types it takes and returns.</summary>
public sealed record CsEntry(
    string Id, string Controller, string Action, string Http, string File, int Line,
    List<CsParam> Parameters, string ReturnType, List<string> ReturnRefs, bool ReturnIsCollection);

public sealed record CsTypesResponse(List<CsType> Types, List<CsEntry> Entries, bool Truncated);

/// <summary>
/// Every type of the solution's source with what the type model needs: members and their types, constructor parameters (what the
/// container injects), base types, attributes; and for each controller action its parameter and return types. Computed once per
/// snapshot: the cache is dropped when a refresh changes the solution.
/// </summary>
public sealed class TypeCatalog
{
    /// <summary>The most types one answer carries: a solution beyond it is cut and says so.</summary>
    public const int MaxTypes = 12_000;
    private const int MaxMembers = 300;

    private static readonly SymbolDisplayFormat Qualified = new(
        typeQualificationStyle: SymbolDisplayTypeQualificationStyle.NameAndContainingTypesAndNamespaces,
        genericsOptions: SymbolDisplayGenericsOptions.None);

    private static readonly SymbolDisplayFormat Short = SymbolDisplayFormat.MinimallyQualifiedFormat;

    private readonly FlowGraph _graph;
    private (int Version, CsTypesResponse Response)? _cache;

    public TypeCatalog(FlowGraph graph) => _graph = graph;

    /// <summary>The answer for the current snapshot, at most `limit` types (the first ones by namespace and name).</summary>
    public async Task<CsTypesResponse> GetAsync(int limit, CancellationToken ct)
    {
        var version = _graph.Version;
        if (_cache is not { } cached || cached.Version != version)
        {
            cached = (version, await BuildAsync(ct));
            _cache = cached;
        }
        var all = cached.Response;
        return limit >= all.Types.Count ? all : all with { Types = all.Types.Take(limit).ToList(), Truncated = true };
    }

    private async Task<CsTypesResponse> BuildAsync(CancellationToken ct)
    {
        var solution = _graph.Solution;
        var types = new List<CsType>();
        foreach (var t in (await _graph.SourceTypesAsync()).OrderBy(t => t.ToDisplayString(), StringComparer.Ordinal))
        {
            ct.ThrowIfCancellationRequested();
            var location = t.Locations.FirstOrDefault(l => l.IsInSource);
            var file = location?.SourceTree?.FilePath;
            if (location == null || file == null || IsGenerated(file) || t.IsImplicitlyDeclared || t.TypeKind == TypeKind.Delegate || t.IsAnonymousType) continue;
            if (types.Count >= MaxTypes) return await Finish(types, truncated: true);
            types.Add(Describe(t, solution, location, file));
        }
        return await Finish(types, truncated: false);

        async Task<CsTypesResponse> Finish(List<CsType> list, bool truncated) => new(list, await EntriesAsync(ct), truncated);
    }

    private async Task<List<CsEntry>> EntriesAsync(CancellationToken ct)
    {
        var list = new List<CsEntry>();
        foreach (var (entry, method) in await _graph.EntrySymbolsAsync())
        {
            ct.ThrowIfCancellationRequested();
            var apiController = method.ContainingType.GetAttributes().Concat(BaseAttributes(method.ContainingType)).Any(a => a.AttributeClass?.Name == "ApiControllerAttribute");
            var ret = Unwrap(method.ReturnType);
            list.Add(new CsEntry(
                entry.Id, method.ContainingType.ToDisplayString(Qualified), entry.Action, entry.Http, entry.File, entry.Line,
                method.Parameters.Select(p => Param(p, apiController && entry.Http is "POST" or "PUT" or "PATCH" or "DELETE")).ToList(),
                method.ReturnType.ToDisplayString(Short), ret.Refs, ret.Many));
        }
        return list;
    }

    private static IEnumerable<AttributeData> BaseAttributes(INamedTypeSymbol t)
    {
        for (var b = t.BaseType; b != null; b = b.BaseType)
            foreach (var a in b.GetAttributes()) yield return a;
    }

    private static bool IsGenerated(string path)
    {
        var p = path.Replace('\\', '/');
        return p.Contains("/obj/") || p.EndsWith(".g.cs", StringComparison.OrdinalIgnoreCase) || p.EndsWith(".designer.cs", StringComparison.OrdinalIgnoreCase) || p.EndsWith(".generated.cs", StringComparison.OrdinalIgnoreCase);
    }

    private CsType Describe(INamedTypeSymbol t, Solution solution, Location location, string file)
    {
        var tree = location.SourceTree!;
        var span = location.GetLineSpan();
        var project = solution.GetDocument(tree)?.Project.Name ?? t.ContainingAssembly?.Name ?? "";
        var kind = t.TypeKind switch
        {
            TypeKind.Interface => "interface",
            TypeKind.Enum => "enum",
            _ when t.IsRecord => "record",
            TypeKind.Struct => "struct",
            _ => "class",
        };
        var fields = new List<CsMember>();
        var methods = new List<CsMethod>();
        var enumMembers = new List<string>();
        foreach (var m in t.GetMembers())
        {
            if (m.IsImplicitlyDeclared || !m.Locations.Any(l => l.IsInSource)) continue;
            switch (m)
            {
                case IFieldSymbol f when t.TypeKind == TypeKind.Enum:
                    enumMembers.Add(f.Name);
                    break;
                case IFieldSymbol f when fields.Count < MaxMembers:
                    fields.Add(Member(f, f.Name, "field", f.Type, f.DeclaredAccessibility, f.IsStatic));
                    break;
                case IPropertySymbol p when !p.IsIndexer && p.ExplicitInterfaceImplementations.IsEmpty && fields.Count < MaxMembers:
                    fields.Add(Member(p, p.Name, "property", p.Type, p.DeclaredAccessibility, p.IsStatic));
                    break;
                case IMethodSymbol { MethodKind: MethodKind.Ordinary } method when methods.Count < MaxMembers:
                    methods.Add(Method(method));
                    break;
            }
        }
        // The constructor the container would use: the one with the most parameters (records keep their components as properties instead).
        var ctor = t.IsRecord || t.TypeKind is TypeKind.Interface or TypeKind.Enum
            ? null
            : t.InstanceConstructors.Where(c => !c.IsImplicitlyDeclared || c.Parameters.Length > 0).OrderByDescending(c => c.Parameters.Length).FirstOrDefault();
        return new CsType(
            t.ToDisplayString(Qualified), t.Name, t.ContainingNamespace?.IsGlobalNamespace == false ? t.ContainingNamespace.ToDisplayString() : "", project, kind, file,
            span.StartLinePosition.Line + 1, span.EndLinePosition.Line + 1,
            t.BaseType is { SpecialType: not (SpecialType.System_Object or SpecialType.System_ValueType or SpecialType.System_Enum) } b ? TypeName(b) : null,
            t.Interfaces.Select(TypeName).ToList(), t.GetAttributes().Select(AttributeName).ToList(), t.IsAbstract && t.TypeKind == TypeKind.Class, t.IsStatic,
            t.TypeParameters.Select(p => p.Name).ToList(), fields, methods,
            ctor?.Parameters.Select(p => Param(p, false)).ToList() ?? [], enumMembers);
    }

    /// <summary>A source type by its qualified name (what `refs` hold), anything else by its short name.</summary>
    private static string TypeName(INamedTypeSymbol t) => IsSource(t) ? t.OriginalDefinition.ToDisplayString(Qualified) : t.Name;

    private static string AttributeName(AttributeData a)
    {
        var n = a.AttributeClass?.Name ?? "";
        return n.EndsWith("Attribute", StringComparison.Ordinal) && n.Length > 9 ? n[..^9] : n;
    }

    private static CsMember Member(ISymbol s, string name, string kind, ITypeSymbol type, Accessibility access, bool isStatic)
    {
        var u = Unwrap(type);
        return new CsMember(name, kind, type.ToDisplayString(Short), u.Refs, u.Many, u.Nullable, Visibility(access), isStatic, s.Locations.First(l => l.IsInSource).GetLineSpan().StartLinePosition.Line + 1);
    }

    private static CsMethod Method(IMethodSymbol m)
    {
        var ret = Unwrap(m.ReturnType);
        var parameters = m.Parameters.Select(p => Param(p, false)).ToList();
        var returnText = m.ReturnType.ToDisplayString(Short);
        var span = m.Locations.First(l => l.IsInSource).GetLineSpan();
        var bodyEnd = m.DeclaringSyntaxReferences.FirstOrDefault()?.GetSyntax().GetLocation().GetLineSpan().EndLinePosition.Line + 1 ?? span.EndLinePosition.Line + 1;
        return new CsMethod(
            m.Name, $"({string.Join(", ", m.Parameters.Select(p => $"{p.Type.ToDisplayString(Short)} {p.Name}"))}): {returnText}", returnText, ret.Refs, ret.Many, parameters,
            Visibility(m.DeclaredAccessibility), m.IsStatic, m.IsAbstract, m.GetAttributes().Select(AttributeName).ToList(), span.StartLinePosition.Line + 1, bodyEnd);
    }

    private static readonly string[] BindingAttributes = ["FromBody", "FromQuery", "FromRoute", "FromForm", "FromHeader", "FromServices"];

    private static CsParam Param(IParameterSymbol p, bool inferBody)
    {
        var u = Unwrap(p.Type);
        var source = p.GetAttributes().Select(a => AttributeName(a)).FirstOrDefault(n => BindingAttributes.Contains(n));
        // [ApiController] binds a complex parameter of a POST/PUT/PATCH from the body when nothing else is written.
        if (source == null && inferBody && u.Refs.Count > 0) source = "FromBody";
        return new CsParam(p.Name, p.Type.ToDisplayString(Short), u.Refs, u.Many, u.Nullable, source);
    }

    private static string Visibility(Accessibility a) => a switch
    {
        Accessibility.Public => "public",
        Accessibility.Private => "private",
        Accessibility.Protected => "protected",
        Accessibility.Internal => "internal",
        Accessibility.ProtectedOrInternal => "protected internal",
        Accessibility.ProtectedAndInternal => "private protected",
        _ => "private",
    };

    private static bool IsSource(INamedTypeSymbol t) => t.Locations.Any(l => l.IsInSource);

    private sealed class Unwrapped
    {
        public readonly List<string> Refs = [];
        public bool Many;
        public bool Nullable;
    }

    /// <summary>The source types a declared type is made of: arrays, collections, Task, ActionResult, Nullable and any other generic are seen through.</summary>
    private static Unwrapped Unwrap(ITypeSymbol? type)
    {
        var result = new Unwrapped();
        Walk(type, result, 0);
        return result;
    }

    private static void Walk(ITypeSymbol? t, Unwrapped acc, int depth)
    {
        if (t == null || depth > 8) return;
        if (t.NullableAnnotation == NullableAnnotation.Annotated) acc.Nullable = true;
        switch (t)
        {
            case IArrayTypeSymbol a:
                acc.Many = true;
                Walk(a.ElementType, acc, depth + 1);
                return;
            case INamedTypeSymbol n:
                if (n.OriginalDefinition.SpecialType == SpecialType.System_Nullable_T)
                {
                    acc.Nullable = true;
                    Walk(n.TypeArguments.FirstOrDefault(), acc, depth + 1);
                    return;
                }
                if (IsSource(n))
                {
                    var name = n.OriginalDefinition.ToDisplayString(Qualified);
                    if (!acc.Refs.Contains(name)) acc.Refs.Add(name);
                }
                else if (IsEnumerable(n))
                {
                    acc.Many = true;
                }
                foreach (var arg in n.TypeArguments) Walk(arg, acc, depth + 1);
                return;
        }
    }

    private static bool IsEnumerable(INamedTypeSymbol n) =>
        n.SpecialType != SpecialType.System_String
        && (n.SpecialType is SpecialType.System_Collections_IEnumerable or SpecialType.System_Collections_Generic_IEnumerable_T
            || n.AllInterfaces.Any(i => i.SpecialType is SpecialType.System_Collections_IEnumerable or SpecialType.System_Collections_Generic_IEnumerable_T));
}
