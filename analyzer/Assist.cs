using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.Completion;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.FindSymbols;
using Microsoft.CodeAnalysis.Tags;
using Microsoft.CodeAnalysis.Text;

namespace FlowAnalyzer;

/// <summary>
/// What the canvas asks while a card is edited: the card's lines <c>StartLine..EndLine</c> of <c>File</c> are replaced by
/// <c>Text</c> (in memory only: nothing is written to disk, nothing reaches the editor's buffer) and the question is asked
/// at <c>Line</c>/<c>Column</c> of that text (1-based, Monaco's). Without <c>Text</c> the file is asked as it is: <c>StartLine</c> and
/// <c>EndLine</c> are the line, <c>Line</c> is 1 (a card that is only read).
/// </summary>
public sealed record CardRequest(string File, int StartLine, int EndLine, string? Original, string? Text, int Line, int Column, string? Trigger);

public sealed record WireRange(int StartLineNumber, int StartColumn, int EndLineNumber, int EndColumn);
public sealed record WireDoc(string Value, bool Markdown);
public sealed record WireItem(string Label, int Kind, string? Detail, WireDoc? Documentation, string SortText, string FilterText, bool? Preselect, string InsertText, bool Snippet, WireRange? Insert, WireRange? Replace, int[]? Tags);
public sealed record Completions(List<WireItem> Items, bool Incomplete, string? Message);
public sealed record ParamInfo(string Label, WireDoc? Documentation);
public sealed record SigInfo(string Label, WireDoc? Documentation, List<ParamInfo> Parameters);
public sealed record Signatures(int ActiveSignature, int ActiveParameter, List<SigInfo> Items);
public sealed record Hovered(List<string> Contents, WireRange? Range);
public sealed record Place(string File, int Line, int Column, int? CardLine, int? CardColumn, string Label);
public sealed record Definitions(List<Place> Places, string? Message);

/// <summary>
/// Completion, signature help, hover and go-to-definition for the C# a card shows, answered by Roslyn's own services against the
/// solution snapshot with the card's text put in. The snapshot is immutable: nothing here takes the analyzer's gate, so a long
/// flow walk never holds a completion back.
/// </summary>
public sealed class Assist
{
    private const int MaxText = 4_000_000;
    private static readonly TimeSpan Budget = TimeSpan.FromSeconds(6);

    private readonly FlowGraph _graph;

    public Assist(FlowGraph graph) => _graph = graph;

    private sealed record Forked(Solution Base, Document Doc, SourceText Text, int RegionStart, int OldLines, int NewLines, string Eol);

    private readonly ConcurrentDictionary<string, Forked> _forks = new();

    private static string Key(string path) => path.Replace('\\', '/').ToLowerInvariant();

    private Document? DocumentOf(Solution solution, string file) =>
        solution.GetDocumentIdsWithFilePath(file).Select(solution.GetDocument).FirstOrDefault(d => d != null)
        ?? solution.Projects.SelectMany(p => p.Documents).FirstOrDefault(d => d.FilePath != null && Key(d.FilePath) == Key(file));

    private static string Normalize(string s) => s.Replace("\r\n", "\n");

    /// <summary>The document with the card's text put in, or why that is not possible.</summary>
    private async Task<(Forked? Fork, string? Message)> ForkAsync(CardRequest r, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(r.File) || r.StartLine < 1 || r.EndLine < r.StartLine || r.Line < 1 || r.Column < 1 || (r.Text?.Length ?? 0) > MaxText)
            return (null, "Malformed request.");
        var solution = _graph.Solution;
        var doc = DocumentOf(solution, r.File);
        if (doc == null) return (null, "This file is not part of the loaded solution.");
        var textHash = Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes((r.Text == null ? "~" : "=" + r.Text) + "\u001f" + r.Original)));
        var key = $"{Key(r.File)}|{r.StartLine}|{r.EndLine}|{textHash}";
        if (_forks.TryGetValue(key, out var hit) && ReferenceEquals(hit.Base, solution)) return (hit, null);

        var text = await doc.GetTextAsync(ct);
        if (r.EndLine > text.Lines.Count) return (null, "The file got shorter since this card was drawn.");
        var first = text.Lines[r.StartLine - 1];
        var last = text.Lines[r.EndLine - 1];
        var region = TextSpan.FromBounds(first.Start, last.End);
        if (r.Original != null && Normalize(text.ToString(region)) != Normalize(r.Original))
            return (null, "This method changed on disk since the card was opened. Completion is paused; save or discard the card first.");
        var eol = text.Lines.Count > 1 && text.Lines[0].EndIncludingLineBreak - text.Lines[0].End == 2 ? "\r\n" : "\n";
        var oldLines = r.EndLine - r.StartLine + 1;
        var forkedText = text;
        var newLines = oldLines;
        if (r.Text != null)
        {
            forkedText = text.WithChanges(new TextChange(region, Normalize(r.Text).Replace("\n", eol)));
            newLines = Normalize(r.Text).Split('\n').Length;
        }
        var forked = r.Text != null ? doc.WithText(forkedText) : doc;
        var result = new Forked(solution, forked, forkedText, first.Start, oldLines, newLines, eol);
        if (_forks.Count > 8) _forks.Clear();
        _forks[key] = result;
        return (result, null);
    }

    /// <summary>Position in the forked text of the card's (line, column).</summary>
    private static int PositionOf(Forked f, CardRequest r)
    {
        var line = r.StartLine - 1 + (r.Line - 1);
        if (line >= f.Text.Lines.Count) return -1;
        var l = f.Text.Lines[line];
        return Math.Min(l.Start + r.Column - 1, l.End);
    }

    private static WireRange? CardRange(Forked f, CardRequest r, TextSpan span)
    {
        var a = f.Text.Lines.GetLinePosition(span.Start);
        var b = f.Text.Lines.GetLinePosition(span.End);
        var top = r.StartLine - 1;
        var bottom = top + f.NewLines - 1;
        if (a.Line < top || b.Line > bottom) return null;
        return new WireRange(a.Line - top + 1, a.Character + 1, b.Line - top + 1, b.Character + 1);
    }

    private async Task<T> Timed<T>(CancellationToken ct, Func<CancellationToken, Task<T>> work, Func<string, T> failed)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(Budget);
        try { return await work(cts.Token); }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested) { return failed("C# analysis took too long; try again in a moment."); }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            Console.Error.WriteLine($"[assist] failed: {e}");
            return failed($"C# analysis failed: {e.Message}");
        }
    }

    // ---- completion ---------------------------------------------------------------------------------

    private static int Kind(System.Collections.Immutable.ImmutableArray<string> tags)
    {
        foreach (var t in tags)
        {
            switch (t)
            {
                case WellKnownTags.Method: case WellKnownTags.ExtensionMethod: return 1;
                case WellKnownTags.Class: return 6;
                case WellKnownTags.Structure: return 21;
                case WellKnownTags.Interface: return 7;
                case WellKnownTags.Enum: return 12;
                case WellKnownTags.EnumMember: return 19;
                case WellKnownTags.Delegate: return 2;
                case WellKnownTags.Field: return 4;
                case WellKnownTags.Local: case WellKnownTags.Parameter: case WellKnownTags.RangeVariable: return 5;
                case WellKnownTags.Property: return 9;
                case WellKnownTags.Event: return 22;
                case WellKnownTags.Constant: return 20;
                case WellKnownTags.Namespace: case WellKnownTags.Module: return 8;
                case WellKnownTags.Keyword: case WellKnownTags.Intrinsic: return 13;
                case WellKnownTags.Snippet: return 14;
                case WellKnownTags.TypeParameter: return 24;
            }
        }
        return 0;
    }

    private static string DocMarkdown(string text) => "```csharp\n" + text + "\n```";

    public Task<Completions> CompleteAsync(CardRequest r, CancellationToken ct) =>
        Timed(ct, async token =>
        {
            var (f, message) = await ForkAsync(r, token);
            if (f == null) return new Completions([], false, message);
            var pos = PositionOf(f, r);
            if (pos < 0) return new Completions([], false, null);
            var service = CompletionService.GetService(f.Doc);
            if (service == null) return new Completions([], false, "Roslyn's completion service is not available (the analyzer lacks the C# Features assembly).");
            var list = await service.GetCompletionsAsync(f.Doc, pos, CompletionTrigger.Invoke, cancellationToken: token);
            if (list == null || list.ItemsList.Count == 0) return new Completions([], false, null);

            // What is typed already: only items that can match it get their description (one Roslyn call each).
            var lineText = f.Text.Lines.GetLineFromPosition(pos).ToString();
            var col = pos - f.Text.Lines.GetLineFromPosition(pos).Start;
            var start = col;
            while (start > 0 && (char.IsLetterOrDigit(lineText[start - 1]) || lineText[start - 1] == '_')) start--;
            var prefix = lineText[start..col];

            var items = new List<(CompletionItem Item, int Rank)>();
            foreach (var item in list.ItemsList)
            {
                if (item.IsComplexTextEdit) continue; // overrides, partial methods: they need the edit Roslyn computes on commit
                var filter = item.FilterText;
                var rank = prefix.Length == 0 ? 1
                    : filter.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) ? 0
                    : filter.Contains(prefix, StringComparison.OrdinalIgnoreCase) ? 1 : 2;
                items.Add((item, rank));
            }
            var describe = items.Where(x => x.Rank < 2).OrderBy(x => x.Rank).ThenBy(x => x.Item.SortText, StringComparer.Ordinal).Take(40).Select(x => x.Item).ToHashSet();
            var details = new ConcurrentDictionary<CompletionItem, string>();
            using var budget = CancellationTokenSource.CreateLinkedTokenSource(token);
            budget.CancelAfter(TimeSpan.FromMilliseconds(1500));
            try
            {
                await Parallel.ForEachAsync(describe, new ParallelOptions { MaxDegreeOfParallelism = 4, CancellationToken = budget.Token }, async (item, t) =>
                {
                    var d = await service.GetDescriptionAsync(f.Doc, item, t);
                    if (d != null && d.Text.Length > 0) details[item] = d.Text;
                });
            }
            catch (OperationCanceledException) when (!token.IsCancellationRequested) { /* the rest simply has no description */ }

            var wire = new List<WireItem>(items.Count);
            foreach (var (item, _) in items)
            {
                var insert = item.Properties.TryGetValue("InsertionText", out var ins) && !string.IsNullOrEmpty(ins) ? ins : item.DisplayText;
                details.TryGetValue(item, out var full);
                var firstLine = full?.Split('\n')[0].Trim();
                var range = CardRange(f, r, item.Span);
                wire.Add(new WireItem(
                    item.DisplayText + item.DisplayTextSuffix, Kind(item.Tags),
                    firstLine is { Length: > 200 } ? firstLine[..200] + "…" : firstLine,
                    full == null ? null : new WireDoc(DocMarkdown(full.Trim()), true),
                    string.IsNullOrEmpty(item.SortText) ? item.DisplayText : item.SortText,
                    string.IsNullOrEmpty(item.FilterText) ? item.DisplayText : item.FilterText,
                    item.Rules.MatchPriority == MatchPriority.Preselect ? true : null,
                    insert, false, range, range, item.Tags.Contains("Deprecated") ? [1] : null));
            }
            // The descriptions only cover what matches what is typed now: ask again as the word grows.
            return new Completions(wire, describe.Count < items.Count(x => x.Rank < 2) || prefix.Length == 0, null);
        }, m => new Completions([], false, m));

    // ---- signature help -----------------------------------------------------------------------------

    private static string? Summary(ISymbol s)
    {
        string? xml;
        try { xml = s.GetDocumentationCommentXml(expandIncludes: false); } catch { return null; }
        if (string.IsNullOrWhiteSpace(xml)) return null;
        var m = Regex.Match(xml, @"<summary>(.*?)</summary>", RegexOptions.Singleline);
        if (!m.Success) return null;
        var text = Regex.Replace(m.Groups[1].Value, @"<see\s+(?:cref|langword)=""(?:\w:)?([^""]+)""\s*/>", "$1");
        text = Regex.Replace(text, "<[^>]+>", "");
        text = Regex.Replace(text, @"\s+", " ").Trim();
        return text.Length == 0 ? null : text;
    }

    private static string ParamLabel(IParameterSymbol p, SemanticModel model, int pos)
    {
        var s = (p.IsParams ? "params " : "") + p.Type.ToMinimalDisplayString(model, pos) + " " + p.Name;
        if (p.HasExplicitDefaultValue) s += " = " + (p.ExplicitDefaultValue is null ? (p.Type.IsValueType ? "default" : "null") : p.ExplicitDefaultValue is string str ? "\"" + str + "\"" : p.ExplicitDefaultValue is bool b ? (b ? "true" : "false") : p.ExplicitDefaultValue.ToString());
        return s;
    }

    private static SigInfo Describe(IMethodSymbol m, SemanticModel model, int pos)
    {
        var ps = m.Parameters.Select(p => new ParamInfo(ParamLabel(p, model, pos), null)).ToList();
        var name = m.MethodKind == MethodKind.Constructor ? m.ContainingType.Name : m.Name;
        var ret = m.MethodKind == MethodKind.Constructor ? "" : m.ReturnType.ToMinimalDisplayString(model, pos) + " ";
        var summary = Summary(m);
        return new SigInfo($"{ret}{name}({string.Join(", ", ps.Select(p => p.Label))})", summary == null ? null : new WireDoc(summary, false), ps);
    }

    public Task<Signatures?> SignatureAsync(CardRequest r, CancellationToken ct) =>
        Timed<Signatures?>(ct, async token =>
        {
            var (f, _) = await ForkAsync(r, token);
            if (f == null) return null;
            var pos = PositionOf(f, r);
            if (pos < 0) return null;
            var root = await f.Doc.GetSyntaxRootAsync(token);
            var model = await f.Doc.GetSemanticModelAsync(token);
            if (root == null || model == null) return null;
            var token0 = root.FindToken(Math.Max(0, pos - 1));
            // The innermost call whose parentheses hold the cursor; `repo.Find(` has no close paren yet.
            foreach (var node in token0.Parent!.AncestorsAndSelf())
            {
                ArgumentListSyntax? args = node switch
                {
                    InvocationExpressionSyntax i => i.ArgumentList,
                    ObjectCreationExpressionSyntax o => o.ArgumentList,
                    ImplicitObjectCreationExpressionSyntax io => io.ArgumentList,
                    _ => null,
                };
                if (args == null || args.OpenParenToken.IsMissing) continue;
                if (pos < args.OpenParenToken.Span.End || (!args.CloseParenToken.IsMissing && pos > args.CloseParenToken.SpanStart)) continue;

                var methods = new List<IMethodSymbol>();
                var info = model.GetSymbolInfo(node, token);
                if (node is InvocationExpressionSyntax inv)
                {
                    methods.AddRange(model.GetMemberGroup(inv.Expression, token).OfType<IMethodSymbol>());
                }
                else
                {
                    var type = model.GetTypeInfo(node, token).Type as INamedTypeSymbol ?? (info.Symbol as IMethodSymbol)?.ContainingType;
                    if (type != null) methods.AddRange(type.Constructors.Where(c => !c.IsStatic));
                }
                var resolved = info.Symbol as IMethodSymbol;
                foreach (var c in info.CandidateSymbols.OfType<IMethodSymbol>())
                    if (!methods.Contains(c, SymbolEqualityComparer.Default)) methods.Add(c);
                if (resolved != null && !methods.Contains(resolved, SymbolEqualityComparer.Default)) methods.Add(resolved);
                // Only what the cursor's place can call; the nearest-looking (fewest parameters) first.
                methods = methods.Where(m => model.Compilation.IsSymbolAccessibleWithin(m, model.GetEnclosingSymbol(pos, token)?.ContainingType ?? m.ContainingType)).OrderBy(m => m.Parameters.Length).ToList();
                if (methods.Count == 0) continue;

                // Which argument the cursor is in: the separators before it; a named argument names its parameter.
                var active = args.Arguments.GetSeparators().Count(s => s.SpanStart < pos);
                var current = args.Arguments.FirstOrDefault(a => a.FullSpan.Contains(pos) || (a.Span.End == pos));
                var sigs = methods.Select(m => Describe(m, model, pos)).ToList();
                var idx = resolved != null ? methods.FindIndex(m => SymbolEqualityComparer.Default.Equals(m.OriginalDefinition, resolved.OriginalDefinition)) : -1;
                if (idx < 0) idx = Math.Max(0, methods.FindIndex(m => m.Parameters.Length > active || m.Parameters.LastOrDefault()?.IsParams == true));
                var chosen = methods[idx];
                var param = current?.NameColon is { } nc ? chosen.Parameters.ToList().FindIndex(p => p.Name == nc.Name.Identifier.ValueText) : -1;
                return new Signatures(idx, param >= 0 ? param : Math.Min(active, Math.Max(0, chosen.Parameters.Length - 1)), sigs);
            }
            return null;
        }, _ => null);

    // ---- hover --------------------------------------------------------------------------------------

    public Task<Hovered?> HoverAsync(CardRequest r, CancellationToken ct) =>
        Timed<Hovered?>(ct, async token =>
        {
            var (f, _) = await ForkAsync(r, token);
            if (f == null) return null;
            var pos = PositionOf(f, r);
            if (pos < 0) return null;
            var symbol = await SymbolFinder.FindSymbolAtPositionAsync(f.Doc, pos, token);
            if (symbol == null) return null;
            var model = await f.Doc.GetSemanticModelAsync(token);
            var shown = model == null ? symbol.ToDisplayString() : symbol.ToMinimalDisplayString(model, pos);
            var contents = new List<string> { DocMarkdown($"({symbol.Kind.ToString().ToLowerInvariant()}) {shown}") };
            if (Summary(symbol) is { } s) contents.Add(s);
            var root = await f.Doc.GetSyntaxRootAsync(token);
            var tok = root?.FindToken(pos);
            return new Hovered(contents, tok is { } t && t.Span.Length > 0 ? CardRange(f, r, t.Span) : null);
        }, _ => null);

    // ---- definition ---------------------------------------------------------------------------------

    private Place? PlaceOf(Location loc, Forked f, CardRequest r, ISymbol symbol)
    {
        var tree = loc.SourceTree;
        if (tree?.FilePath == null) return null;
        var span = loc.GetLineSpan();
        var line = span.StartLinePosition.Line;      // 0-based, in the tree's own text
        var column = span.StartLinePosition.Character;
        var label = symbol.ToDisplayString(SymbolDisplayFormat.CSharpShortErrorMessageFormat);
        if (Key(tree.FilePath) != Key(r.File))
            return new Place(tree.FilePath, line + 1, column + 1, null, null, label);
        // Same file: the tree is the forked one (the card's text in it), so lines below the card are shifted by what the edit added.
        var top = r.StartLine - 1;
        var cardEnd = top + f.NewLines - 1;
        if (line >= top && line <= cardEnd)
            return new Place(tree.FilePath, line + 1, column + 1, line - top + 1, column + 1, label);
        var fileLine = line > cardEnd ? line - (f.NewLines - f.OldLines) : line;
        return new Place(tree.FilePath, fileLine + 1, column + 1, null, null, label);
    }

    public Task<Definitions> DefinitionAsync(CardRequest r, CancellationToken ct) =>
        Timed(ct, async token =>
        {
            var (f, message) = await ForkAsync(r, token);
            if (f == null) return new Definitions([], message);
            var pos = PositionOf(f, r);
            if (pos < 0) return new Definitions([], null);
            var symbol = await SymbolFinder.FindSymbolAtPositionAsync(f.Doc, pos, token);
            if (symbol == null) return new Definitions([], "No definition found.");
            // `var x` and an alias name the type they stand for; a constructor call goes to the constructor, else its type.
            symbol = symbol.OriginalDefinition;
            var places = new List<Place>();
            var fromSource = symbol.Locations.Where(l => l.IsInSource).ToList();

            // A member without a body: what runs is an implementation, so those come first.
            if (symbol is IMethodSymbol or IPropertySymbol or IEventSymbol && (symbol.ContainingType?.TypeKind == TypeKind.Interface || symbol.IsAbstract))
            {
                var impls = await SymbolFinder.FindImplementationsAsync(symbol, f.Doc.Project.Solution, cancellationToken: token);
                var overrides = symbol.IsAbstract ? await SymbolFinder.FindOverridesAsync(symbol, f.Doc.Project.Solution, cancellationToken: token) : [];
                foreach (var s in impls.Concat(overrides))
                    foreach (var l in s.OriginalDefinition.Locations.Where(l => l.IsInSource).Take(1))
                        if (PlaceOf(l, f, r, s) is { } p && !places.Any(x => x.File == p.File && x.Line == p.Line)) places.Add(p);
            }
            foreach (var l in fromSource)
                if (PlaceOf(l, f, r, symbol) is { } p && !places.Any(x => x.File == p.File && x.Line == p.Line)) places.Add(p);

            if (places.Count == 0)
            {
                var where = symbol.ContainingAssembly?.Name;
                return new Definitions([], $"{symbol.ToDisplayString(SymbolDisplayFormat.CSharpShortErrorMessageFormat)} is defined in {where ?? "a library"}: there is no source to open.");
            }
            return new Definitions(places, null);
        }, m => new Definitions([], m));

    /// <summary>The first request pays for loading Roslyn's completion providers: do it before anyone waits for it.</summary>
    public async Task WarmAsync()
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        try
        {
            var doc = _graph.Solution.Projects.SelectMany(p => p.Documents).FirstOrDefault(d => d.FilePath != null);
            if (doc == null) return;
            var service = CompletionService.GetService(doc);
            if (service == null) { Console.Error.WriteLine("[assist] CompletionService is not available: completion will answer nothing."); return; }
            var text = await doc.GetTextAsync();
            await service.GetCompletionsAsync(doc, 0, CompletionTrigger.Invoke);
            await doc.GetSemanticModelAsync();
            Console.Error.WriteLine($"[assist] warm in {sw.ElapsedMilliseconds} ms ({text.Length} chars)");
        }
        catch (Exception e) { Console.Error.WriteLine($"[assist] warm-up failed: {e.Message}"); }
    }
}
