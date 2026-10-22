namespace FlowAnalyzer;

/// <summary>One database card an entry point's flow reaches (the shape editor/extensions/flow-view/src/poly/model.ts calls TableUseFact).</summary>
public sealed record TableUseFact(string Entry, string Table, string? SchemaName, string Entity, bool Write, bool Guess, string Card, string From, string? File, int Line, List<string> Ops);

/// <summary>What the walk found so far; `Done` is false while some entry points have not been walked yet.</summary>
public sealed record TablesFact(List<TableUseFact> Uses, bool Done, int Checked, int Total, int Version);

/// <summary>
/// The table → endpoints index: walks the flow of each entry point and records the database cards it reaches. One entry point per
/// step, so the server can let other requests through between steps (Roslyn answers one request at a time). The walk starts over
/// when a refresh changed the solution (<see cref="FlowGraph.Version"/>).
/// </summary>
public sealed class TableWalk
{
    private const int MaxEntries = 3000;
    private const int MaxUses = 20_000;
    private const int Depth = 5;
    private const int MaxCancelled = 3;

    private readonly FlowGraph _graph;
    private int _version = -1;
    private List<EntryPoint> _entries = new();
    private int _next;
    private int _cancelled; // how many times in a row the walk of _entries[_next] was cancelled
    private List<TableUseFact> _uses = new();

    public TableWalk(FlowGraph graph) => _graph = graph;

    /// <summary>Walks the next entry point; true when there is nothing left to walk.</summary>
    public async Task<bool> StepAsync(CancellationToken ct)
    {
        if (_graph.Version != _version)
        {
            _version = _graph.Version;
            _entries = (await _graph.EntryPointsAsync()).Take(MaxEntries).ToList();
            _next = 0;
            _cancelled = 0;
            _uses = new();
        }
        if (_next >= _entries.Count || _uses.Count >= MaxUses) return true;
        // The entry is taken only once it is walked: a request that is cancelled half way (the client's timeout, the editor closing)
        // leaves it for the next step, instead of leaving its tables out of an index that then says it is done. A flow that is
        // cancelled MaxCancelled times in a row (longer than any request waits) is given up, as one that cannot be traced is, so
        // it cannot stop the walk for good.
        var entry = _entries[_next];
        try
        {
            if (await _graph.BuildAsync(entry.Id, Depth, ct) is { } root) Collect(entry.Id, root);
        }
        catch (OperationCanceledException) when (++_cancelled < MaxCancelled)
        {
            throw;
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            // one flow that cannot be traced must not lose the others
        }
        catch (OperationCanceledException)
        {
            _next++;
            _cancelled = 0;
            throw;
        }
        _next++;
        _cancelled = 0;
        return _next >= _entries.Count || _uses.Count >= MaxUses;
    }

    public TablesFact Snapshot() => new(_uses.ToList(), _next >= _entries.Count || _uses.Count >= MaxUses, _next, _entries.Count, _version);

    private void Collect(string entry, FlowNode root)
    {
        var seen = new HashSet<string>();
        void Visit(FlowNode n)
        {
            foreach (var c in n.Children)
            {
                if (c.EdgeKind == "db" && c.Node.Schema is { } s)
                {
                    if (seen.Add($"{s.Table}|{s.Writes}|{c.Node.Label}|{n.Label}"))
                        _uses.Add(new TableUseFact(entry, s.Table, s.DbSchemaName, s.Entity, s.Writes, c.Guess == true, c.Node.Label, n.Label, n.File, c.CallLine, s.Ops));
                }
                else Visit(c.Node);
            }
        }
        Visit(root);
    }
}
