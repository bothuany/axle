using System.Collections.Concurrent;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.FindSymbols;
using Microsoft.CodeAnalysis.Text;

namespace FlowAnalyzer;

public sealed record FlowNode(
    string Key,
    string? SymbolId,
    string Label,
    string Sub,
    string Kind,          // controller | handler | method | db | ambiguous | external
    string? File,
    int StartLine,        // 1-based, inclusive
    int EndLine,
    string? Code,
    List<FlowEdge> Children)
{
    /// <summary>Database cards: the table, its columns and what the query does with it.</summary>
    public DbSchema? Schema { get; init; }
}

public sealed record FlowEdge(int CallLine, string EdgeKind, FlowNode Node); // call | mediator | impl | db

public sealed record MethodInfo(string Id, string Name, int Line, int StartLine, int EndLine, bool IsEntry);

public sealed record EntryPoint(string Id, string Controller, string Action, string Http, string File, int Line);

/// <summary>
/// Builds a left-to-right call tree from a method, following MediatR Send → Handler and
/// interface → implementation hops through the Roslyn semantic model.
/// </summary>
public sealed class FlowGraph
{
    private Solution _solution;
    private readonly ConcurrentDictionary<ProjectId, Compilation> _compilations = new();
    private List<INamedTypeSymbol>? _sourceTypes;

    private readonly SchemaReader _schema;

    public FlowGraph(Solution solution)
    {
        _solution = solution;
        _schema = new SchemaReader(SourceTypesAsync, async tree => (await CompilationsAsync()).FirstOrDefault(c => c.SyntaxTrees.Contains(tree))?.GetSemanticModel(tree));
    }

    public Solution Solution => _solution;

    private async Task<IReadOnlyList<Compilation>> CompilationsAsync()
    {
        foreach (var p in _solution.Projects)
            if (!_compilations.ContainsKey(p.Id))
                _compilations[p.Id] = (await p.GetCompilationAsync())!;
        return _solution.Projects.Select(p => _compilations[p.Id]).ToList();
    }

    private async Task<List<INamedTypeSymbol>> SourceTypesAsync()
    {
        if (_sourceTypes != null) return _sourceTypes;
        var seen = new HashSet<string>();
        var list = new List<INamedTypeSymbol>();
        foreach (var c in await CompilationsAsync())
            foreach (var t in AllTypes(c.Assembly.GlobalNamespace))
                if (t.Locations.Any(l => l.IsInSource) && seen.Add(t.ToDisplayString() + "|" + t.Locations[0].SourceTree?.FilePath))
                    list.Add(t);
        return _sourceTypes = list;
    }

    private static IEnumerable<INamedTypeSymbol> AllTypes(INamespaceSymbol ns)
    {
        foreach (var t in ns.GetTypeMembers())
            foreach (var x in WithNested(t)) yield return x;
        foreach (var child in ns.GetNamespaceMembers())
            foreach (var x in AllTypes(child)) yield return x;
    }

    private static IEnumerable<INamedTypeSymbol> WithNested(INamedTypeSymbol t)
    {
        yield return t;
        foreach (var n in t.GetTypeMembers())
            foreach (var x in WithNested(n)) yield return x;
    }

    public async Task<List<EntryPoint>> EntryPointsAsync()
    {
        var result = new List<EntryPoint>();
        foreach (var t in await SourceTypesAsync())
        {
            if (t.IsAbstract || !InheritsFrom(t, "ControllerBase")) continue;
            foreach (var m in t.GetMembers().OfType<IMethodSymbol>())
            {
                if (m.MethodKind != MethodKind.Ordinary || m.DeclaredAccessibility != Accessibility.Public) continue;
                var http = m.GetAttributes().Select(a => a.AttributeClass?.Name ?? "")
                    .FirstOrDefault(n => n.StartsWith("Http") && n.EndsWith("Attribute"));
                if (http == null) continue;
                var loc = m.Locations.First(l => l.IsInSource);
                result.Add(new EntryPoint(
                    DocumentationCommentId.CreateDeclarationId(m)!,
                    t.Name, m.Name, http[4..^9].ToUpperInvariant(),
                    loc.SourceTree!.FilePath, loc.GetLineSpan().StartLinePosition.Line + 1));
            }
        }
        return result.OrderBy(e => e.Controller).ThenBy(e => e.Line).ToList();
    }

    public async Task<IMethodSymbol?> ResolveAsync(string id)
    {
        foreach (var c in await CompilationsAsync())
            if (DocumentationCommentId.GetFirstSymbolForDeclarationId(id, c) is IMethodSymbol m && m.Locations.Any(l => l.IsInSource))
                return m;
        return null;
    }

    public async Task<FlowNode?> BuildAsync(string id, int maxDepth)
    {
        var root = await ResolveAsync(id);
        if (root == null) return null;
        var counter = 0;
        return await NodeAsync(root, null, maxDepth, new HashSet<string>(), () => $"n{counter++}");
    }

    private async Task<FlowNode> NodeAsync(IMethodSymbol method, string? labelOverride, int depth, HashSet<string> path, Func<string> nextKey)
    {
        method = method.OriginalDefinition;
        var symbolId = DocumentationCommentId.CreateDeclarationId(method);
        var syntaxRef = method.DeclaringSyntaxReferences.FirstOrDefault();
        var syntax = syntaxRef != null ? await syntaxRef.GetSyntaxAsync() : null;
        var tree = syntax?.SyntaxTree;
        var text = tree != null ? await tree.GetTextAsync() : null;

        string? code = null;
        int start = 0, end = 0;
        if (syntax != null && text != null)
        {
            // Skip [Attributes] so the card starts at the signature; doc comments are trivia and already excluded.
            var first = syntax.ChildNodesAndTokens().FirstOrDefault(x => !x.IsKind(SyntaxKind.AttributeList));
            var bodySpan = first.IsNode || first.IsToken ? TextSpan.FromBounds(first.SpanStart, syntax.Span.End) : syntax.Span;
            var lines = text.Lines.GetLinePositionSpan(bodySpan);
            start = lines.Start.Line + 1;
            end = lines.End.Line + 1;
            var span = TextSpan.FromBounds(text.Lines[start - 1].Start, text.Lines[end - 1].End);
            code = text.ToString(span);
        }

        var (label, sub, kind) = Describe(method);
        var node = new FlowNode(nextKey(), symbolId, labelOverride ?? label, sub, kind, tree?.FilePath, start, end, code, new List<FlowEdge>());
        if (syntax == null || tree == null || depth <= 0 || symbolId == null || !path.Add(symbolId)) return node;

        try
        {
            var doc = _solution.GetDocument(tree);
            var model = doc != null ? await doc.GetSemanticModelAsync() : null;
            if (model == null) return node;

            var seenTargets = new HashSet<string>();
            foreach (var inv in syntax.DescendantNodes().OfType<InvocationExpressionSyntax>().OrderBy(i => i.SpanStart))
            {
                var callLine = text!.Lines.GetLineFromPosition(inv.SpanStart).LineNumber + 1;
                var target = model.GetSymbolInfo(inv).Symbol as IMethodSymbol
                             ?? model.GetSymbolInfo(inv).CandidateSymbols.OfType<IMethodSymbol>().FirstOrDefault();
                if (target == null) continue;
                var reduced = target.ReducedFrom ?? target;

                // MediatR: _mediator.Send(new XQuery()) → handler of XQuery
                if (IsMediatorSend(reduced) && inv.ArgumentList.Arguments.Count > 0)
                {
                    var reqType = model.GetTypeInfo(inv.ArgumentList.Arguments[0].Expression).Type;
                    if (reqType != null && seenTargets.Add("req:" + reqType.ToDisplayString()))
                    {
                        foreach (var handle in await HandlersForAsync(reqType))
                            node.Children.Add(new FlowEdge(callLine, "mediator",
                                await NodeAsync(handle, $"{reqType.Name} ▸ Handler", depth - 1, path, nextKey)));
                    }
                    continue;
                }

                if (!reduced.Locations.Any(l => l.IsInSource))
                {
                    var db = DbTouch(inv, model);
                    if (db != null && seenTargets.Add("db:" + db.Value.Label))
                    {
                        var schema = await _schema.ForAsync(db.Value.Context, db.Value.Member, db.Value.Ops, db.Value.SetTypes);
                        var dbSub = schema == null ? db.Value.Context.Name : $"{(schema.DbSchemaName != null ? schema.DbSchemaName + "." : "")}{schema.Table}";
                        node.Children.Add(new FlowEdge(callLine, "db",
                            new FlowNode(nextKey(), null, db.Value.Label, dbSub, "db", schema?.File, schema?.Line ?? 0, schema?.Line ?? 0, null, new()) { Schema = schema }));
                    }
                    continue;
                }

                var def = reduced.OriginalDefinition;
                var defId = DocumentationCommentId.CreateDeclarationId(def);
                if (defId == null || !seenTargets.Add(defId)) continue;

                if (def.ContainingType.TypeKind == TypeKind.Interface || def.IsAbstract)
                {
                    var impls = (await SymbolFinder.FindImplementationsAsync(def, _solution))
                        .Concat(def.IsAbstract ? await SymbolFinder.FindOverridesAsync(def, _solution) : [])
                        .OfType<IMethodSymbol>().Where(m => m.Locations.Any(l => l.IsInSource))
                        .GroupBy(m => DocumentationCommentId.CreateDeclarationId(m.OriginalDefinition)).Select(g => g.First())
                        .ToList();
                    if (impls.Count == 1)
                    {
                        node.Children.Add(new FlowEdge(callLine, "impl",
                            await NodeAsync(impls[0], null, depth - 1, path, nextKey)));
                    }
                    else if (impls.Count > 1)
                    {
                        var amb = new FlowNode(nextKey(), defId, $"{def.ContainingType.Name}.{def.Name}",
                            $"{impls.Count} implementasyon", "ambiguous", null, 0, 0, null, new());
                        foreach (var impl in impls)
                            amb.Children.Add(new FlowEdge(0, "impl", await NodeAsync(impl, null, depth - 1, path, nextKey)));
                        node.Children.Add(new FlowEdge(callLine, "impl", amb));
                    }
                    else
                    {
                        node.Children.Add(new FlowEdge(callLine, "call",
                            new FlowNode(nextKey(), defId, $"{def.ContainingType.Name}.{def.Name}", "no implementation found", "external", null, 0, 0, null, new())));
                    }
                    continue;
                }

                node.Children.Add(new FlowEdge(callLine, "call", await NodeAsync(def, null, depth - 1, path, nextKey)));
            }
        }
        finally
        {
            path.Remove(symbolId);
        }
        return node;
    }

    /// <summary>Methods declared in a file — for CodeLens and "flow at cursor".</summary>
    public async Task<List<MethodInfo>> MethodsAsync(string file)
    {
        var result = new List<MethodInfo>();
        var doc = _solution.GetDocumentIdsWithFilePath(file).Select(_solution.GetDocument).FirstOrDefault(d => d != null);
        if (doc == null) return result;
        var model = await doc.GetSemanticModelAsync();
        var root = await doc.GetSyntaxRootAsync();
        if (model == null || root == null) return result;
        foreach (var decl in root.DescendantNodes().OfType<MethodDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(decl) is not IMethodSymbol m) continue;
            var id = DocumentationCommentId.CreateDeclarationId(m);
            if (id == null) continue;
            var span = decl.SyntaxTree.GetLineSpan(decl.Span);
            var nameLine = decl.SyntaxTree.GetLineSpan(decl.Identifier.Span).StartLinePosition.Line + 1;
            var isEntry = InheritsFrom(m.ContainingType, "ControllerBase") &&
                          m.GetAttributes().Any(a => a.AttributeClass?.Name.StartsWith("Http") == true);
            result.Add(new MethodInfo(id, $"{m.ContainingType.Name}.{m.Name}", nameLine, span.StartLinePosition.Line + 1, span.EndLinePosition.Line + 1, isEntry));
        }
        return result;
    }

    /// <summary>
    /// Reverse flow: who calls this method, recursively. Follows interface/override declarations and
    /// MediatR (a handler's callers are the methods that create its request).
    /// </summary>
    public async Task<FlowNode?> CallersAsync(string id, int maxDepth)
    {
        var root = await ResolveAsync(id);
        if (root == null) return null;
        var counter = 0;
        Func<string> nextKey = () => $"c{counter++}";
        return await CallerNodeAsync(root, maxDepth, new HashSet<string>(), nextKey);
    }

    private async Task<FlowNode> CallerNodeAsync(IMethodSymbol method, int depth, HashSet<string> path, Func<string> nextKey)
    {
        var node = await NodeAsync(method, null, 0, new HashSet<string>(), nextKey);
        var id = DocumentationCommentId.CreateDeclarationId(method.OriginalDefinition);
        if (depth <= 0 || id == null || !path.Add(id)) return node;
        try
        {
            foreach (var (caller, line, kind) in (await CallSitesAsync(method.OriginalDefinition)).Take(12))
                node.Children.Add(new FlowEdge(line, kind, await CallerNodeAsync(caller, depth - 1, path, nextKey)));
        }
        finally { path.Remove(id); }
        return node;
    }

    /// <summary>Endpoints (controller actions) that can reach this method, walking callers breadth-first.</summary>
    public async Task<List<string>> ImpactAsync(string id, int maxDepth = 8)
    {
        var start = await ResolveAsync(id);
        if (start == null) return new();
        var endpoints = new SortedSet<string>();
        var seen = new HashSet<string>();
        var frontier = new List<IMethodSymbol> { start.OriginalDefinition };
        for (var depth = 0; depth <= maxDepth && frontier.Count > 0 && seen.Count < 400; depth++)
        {
            var next = new List<IMethodSymbol>();
            foreach (var m in frontier)
            {
                var mid = DocumentationCommentId.CreateDeclarationId(m);
                if (mid == null || !seen.Add(mid)) continue;
                if (InheritsFrom(m.ContainingType, "ControllerBase") && m.GetAttributes().Any(a => a.AttributeClass?.Name.StartsWith("Http") == true))
                {
                    endpoints.Add($"{m.ContainingType.Name.Replace("Controller", "")}.{m.Name}");
                    continue;
                }
                foreach (var (caller, _, _) in await CallSitesAsync(m)) next.Add(caller);
            }
            frontier = next;
        }
        return endpoints.ToList();
    }

    private async Task<List<(IMethodSymbol caller, int line, string kind)>> CallSitesAsync(IMethodSymbol method)
    {
        var sites = new List<(IMethodSymbol, int, string)>();
        var seen = new HashSet<string>();
        void Add(IMethodSymbol? caller, Location loc, string kind)
        {
            if (caller == null || !caller.Locations.Any(l => l.IsInSource) || !loc.IsInSource) return;
            caller = caller.OriginalDefinition;
            var cid = DocumentationCommentId.CreateDeclarationId(caller);
            if (cid == null || !seen.Add(cid)) return;
            sites.Add((caller, loc.GetLineSpan().StartLinePosition.Line + 1, kind));
        }

        // The method itself plus what it implements/overrides: callers through an interface still reach it.
        var targets = new List<(IMethodSymbol, string)> { (method, "call") };
        foreach (var iface in method.ContainingType.AllInterfaces)
            foreach (var member in iface.GetMembers(method.Name).OfType<IMethodSymbol>())
                if (SymbolEqualityComparer.Default.Equals(method.ContainingType.FindImplementationForInterfaceMember(member), method))
                    targets.Add((member, "impl"));
        for (var o = method.OverriddenMethod; o != null; o = o.OverriddenMethod) targets.Add((o, "impl"));

        foreach (var (target, kind) in targets)
            foreach (var c in await SymbolFinder.FindCallersAsync(target, _solution))
                foreach (var loc in c.Locations)
                    Add(await EnclosingMethodAsync(loc) ?? c.CallingSymbol as IMethodSymbol, loc, kind);

        // MediatR: Handle(XQuery) is "called" wherever an XQuery is created.
        var handlerOf = method.Name == "Handle"
            ? method.ContainingType.AllInterfaces.FirstOrDefault(i => i.Name is "IRequestHandler" or "INotificationHandler")
            : null;
        if (handlerOf != null)
        {
            var requestType = handlerOf.TypeArguments[0];
            foreach (var r in await SymbolFinder.FindReferencesAsync(requestType, _solution))
                foreach (var loc in r.Locations)
                {
                    var tree = loc.Location.SourceTree;
                    var nodeAt = tree == null ? null : (await tree.GetRootAsync()).FindNode(loc.Location.SourceSpan);
                    if (nodeAt?.FirstAncestorOrSelf<ObjectCreationExpressionSyntax>() == null) continue;
                    Add(await EnclosingMethodAsync(loc.Location), loc.Location, "mediator");
                }
        }
        return sites;
    }

    private async Task<IMethodSymbol?> EnclosingMethodAsync(Location loc)
    {
        var tree = loc.SourceTree;
        var doc = tree == null ? null : _solution.GetDocument(tree);
        if (doc == null) return null;
        var model = await doc.GetSemanticModelAsync();
        var decl = (await tree!.GetRootAsync()).FindNode(loc.SourceSpan).FirstAncestorOrSelf<MethodDeclarationSyntax>();
        return decl == null ? null : model?.GetDeclaredSymbol(decl) as IMethodSymbol;
    }

    private static (string label, string sub, string kind) Describe(IMethodSymbol m)
    {
        var t = m.ContainingType;
        if (InheritsFrom(t, "ControllerBase")) return ($"{t.Name}.{m.Name}", t.ContainingNamespace.ToDisplayString(), "controller");
        var handlerOf = t.AllInterfaces.FirstOrDefault(i => i.Name == "IRequestHandler");
        if (handlerOf != null && m.Name == "Handle") return ($"{handlerOf.TypeArguments[0].Name} ▸ {t.Name}", "MediatR handler", "handler");
        return ($"{t.Name}.{m.Name}", t.ContainingNamespace.ToDisplayString(), "method");
    }

    private static bool IsMediatorSend(IMethodSymbol m) =>
        m.Name is "Send" or "Publish" &&
        m.ContainingType.Name is "IMediator" or "ISender" or "IPublisher" or "Mediator";

    private async Task<List<IMethodSymbol>> HandlersForAsync(ITypeSymbol requestType)
    {
        var result = new List<IMethodSymbol>();
        foreach (var t in await SourceTypesAsync())
        {
            var iface = t.AllInterfaces.FirstOrDefault(i =>
                i.Name is "IRequestHandler" or "INotificationHandler" &&
                SameType(i.TypeArguments[0], requestType));
            if (iface == null) continue;
            var handle = t.GetMembers("Handle").OfType<IMethodSymbol>().FirstOrDefault(m => m.Locations.Any(l => l.IsInSource));
            if (handle != null) result.Add(handle);
        }
        return result;
    }

    /// <summary>Returns "DbContext.DbSet" when an external call chain hangs off an EF DbContext.</summary>
    /// <summary>
    /// An EF call: the DbContext it goes through, the DbSet member (or Set&lt;T&gt;), and the operators on
    /// the way, in the order they run (Where, Select, FirstOrDefaultAsync…).
    /// </summary>
    private static (string Label, ITypeSymbol Context, string? Member, List<string> Ops, List<ITypeSymbol> SetTypes)? DbTouch(InvocationExpressionSyntax inv, SemanticModel model)
    {
        ExpressionSyntax? e = inv.Expression;
        string? lastMember = null;
        var ops = new List<string>();
        var setTypes = new List<ITypeSymbol>();
        while (e != null)
        {
            var type = model.GetTypeInfo(e).Type;
            if (type != null && InheritsFrom(type, "DbContext"))
            {
                ops.Reverse();
                // _db.SaveChangesAsync(): the call itself is on the context.
                if (lastMember == null && ops.Count == 0 && inv.Expression is MemberAccessExpressionSyntax self) ops.Add(self.Name.Identifier.Text);
                return (lastMember != null ? $"{type.Name}.{lastMember}" : type.Name, type, lastMember, ops, setTypes);
            }
            switch (e)
            {
                case MemberAccessExpressionSyntax ma:
                    if (ma.Expression is not InvocationExpressionSyntax) lastMember = ma.Name.Identifier.Text;
                    if (ma.Parent is InvocationExpressionSyntax) ops.Add(ma.Name.Identifier.Text);
                    if (ma.Name is GenericNameSyntax { Identifier.Text: "Set" } gn && gn.TypeArgumentList.Arguments.Count == 1 && model.GetTypeInfo(gn.TypeArgumentList.Arguments[0]).Type is { } st)
                        setTypes.Add(st);
                    e = ma.Expression;
                    break;
                case InvocationExpressionSyntax i: e = i.Expression; break;
                case ConditionalAccessExpressionSyntax ca: e = ca.Expression; break;
                case ParenthesizedExpressionSyntax p: e = p.Expression; break;
                default: e = null; break;
            }
        }
        return null;
    }

    // Symbols from different project compilations are distinct instances; compare by identity string.
    private static bool SameType(ITypeSymbol a, ITypeSymbol b) =>
        a.OriginalDefinition.ToDisplayString() == b.OriginalDefinition.ToDisplayString() &&
        a.ContainingAssembly?.Name == b.ContainingAssembly?.Name;

    private static bool InheritsFrom(ITypeSymbol? t, string name)
    {
        for (; t != null; t = t.BaseType)
            if (t.Name == name) return true;
        return false;
    }

    /// <summary>Re-reads files changed outside Flow (agent, Rider, git) so cards and saves see current disk text.</summary>
    public async Task<int> RefreshAsync(IEnumerable<string> files)
    {
        var count = 0;
        foreach (var file in files.Distinct())
        {
            var ids = _solution.GetDocumentIdsWithFilePath(file);
            if (ids.IsEmpty || !File.Exists(file)) continue;
            SourceText disk;
            try
            {
                await using var stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                disk = SourceText.From(stream);
            }
            catch (IOException) { continue; } // mid-write; the next event will catch it
            foreach (var id in ids)
                _solution = _solution.WithDocumentText(id, disk);
            count++;
        }
        if (count > 0)
        {
            _compilations.Clear();
            _sourceTypes = null;
        }
        return count;
    }

    /// <summary>
    /// Replaces lines [startLine, endLine] of a file. Reads the file fresh from disk so edits made in
    /// another editor survive; refuses (returns false) when those lines no longer match what the UI showed.
    /// </summary>
    public async Task<bool> SaveAsync(string file, int startLine, int endLine, string original, string newCode)
    {
        var docIds = _solution.GetDocumentIdsWithFilePath(file);
        if (docIds.IsEmpty) throw new InvalidOperationException("File is not part of the solution: " + file);

        SourceText disk;
        await using (var stream = File.OpenRead(file))
            disk = SourceText.From(stream);
        if (endLine > disk.Lines.Count) return false;
        var span = TextSpan.FromBounds(disk.Lines[startLine - 1].Start, disk.Lines[endLine - 1].End);
        if (disk.ToString(span) != original) return false;

        var updated = disk.WithChanges(new TextChange(span, newCode));
        await File.WriteAllTextAsync(file, updated.ToString(), disk.Encoding ?? new System.Text.UTF8Encoding(false));
        foreach (var id in docIds)
            _solution = _solution.WithDocumentText(id, updated);
        _compilations.Clear();
        _sourceTypes = null;
        return true;
    }
}
