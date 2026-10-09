using System.Text.Json;
using FlowAnalyzer;
using Microsoft.CodeAnalysis.MSBuild;

await Cli.RunAsync(args);

static class Cli
{
    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = false };

    public static async Task RunAsync(string[] args)
    {
        if (args.Length < 2)
        {
            Console.Error.WriteLine("usage: FlowAnalyzer serve <sln> [port] | dump <sln> <controller.action|docId> [depth] | list <sln>");
            return;
        }
        var graph = await LoadAsync(args[1]);

        switch (args[0])
        {
            case "list":
                foreach (var e in await graph.EntryPointsAsync())
                    Console.WriteLine($"{e.Http,-6} {e.Controller}.{e.Action}  {e.Id}");
                break;
            case "dump":
                var id = args[2].StartsWith("M:") ? args[2]
                    : (await graph.EntryPointsAsync()).First(e => $"{e.Controller}.{e.Action}" == args[2]).Id;
                var node = await graph.BuildAsync(id, args.Length > 3 ? int.Parse(args[3]) : 4);
                Print(node!, 0);
                break;
            case "callers":
                var m = (await graph.MethodsAsync(Path.GetFullPath(args[2]))).First(x => x.Name.EndsWith("." + args[3]));
                Print((await graph.CallersAsync(m.Id, args.Length > 4 ? int.Parse(args[4]) : 3))!, 0);
                break;
            case "serve":
                if (args.Length > 3) WatchParent(int.Parse(args[3]));
                await Server.RunAsync(graph, args.Length > 2 ? int.Parse(args[2]) : 5199, SourceRoot(graph));
                break;
        }
    }

    /// <summary>Common ancestor of all project folders — shared projects often live outside the .sln folder.</summary>
    static string SourceRoot(FlowGraph graph)
    {
        var dirs = graph.Solution.Projects.Select(p => Path.GetDirectoryName(p.FilePath)!).Distinct().ToList();
        var root = dirs[0];
        while (!dirs.All(d => (d + "/").StartsWith(root + "/"))) root = Path.GetDirectoryName(root)!;
        Console.Error.WriteLine($"[watch] {root}");
        return root;
    }

    /// <summary>Exit when the desktop app that spawned us is gone, even if it was killed without cleanup.</summary>
    static void WatchParent(int pid) => _ = Task.Run(async () =>
    {
        while (true)
        {
            await Task.Delay(2000);
            try { if (System.Diagnostics.Process.GetProcessById(pid).HasExited) Environment.Exit(0); }
            catch (ArgumentException) { Environment.Exit(0); }
        }
    });

    static void Print(FlowNode n, int indent, string edge = "")
    {
        Console.WriteLine($"{new string(' ', indent * 2)}{edge}[{n.Kind}] {n.Label}  ({Path.GetFileName(n.File)}:{n.StartLine}-{n.EndLine})");
        foreach (var c in n.Children) Print(c.Node, indent + 1, $"{c.EdgeKind}@{c.CallLine} → ");
    }

    static async Task<FlowGraph> LoadAsync(string sln)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var ws = MSBuildWorkspace.Create();
        ws.RegisterWorkspaceFailedHandler(e => Console.Error.WriteLine($"[workspace] {e.Diagnostic.Kind}: {e.Diagnostic.Message}"));
        var solution = await ws.OpenSolutionAsync(Path.GetFullPath(sln));
        Console.Error.WriteLine($"[load] {solution.Projects.Count()} proje, {sw.Elapsed.TotalSeconds:F1}s");
        return new FlowGraph(solution);
    }

    public static JsonSerializerOptions JsonOptions => Json;
}
