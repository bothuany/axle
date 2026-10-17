using FlowAnalyzer;
using Microsoft.CodeAnalysis.MSBuild;

await Cli.RunAsync(args);

static class Cli
{
    const string Usage = "usage: FlowAnalyzer serve <sln|csproj> [port] [parent-pid] --token <hex> | dump <sln|csproj> <controller.action|docId> [depth] | callers <sln|csproj> <file> <method> [depth] | list <sln|csproj>";

    static int Fail(string message)
    {
        Console.Error.WriteLine(message);
        Environment.ExitCode = 2;
        return 2;
    }

    public static async Task RunAsync(string[] rawArgs)
    {
        // --token <hex> may sit anywhere; the rest stays positional.
        string? token = null;
        var args = new List<string>();
        for (var i = 0; i < rawArgs.Length; i++)
        {
            if (rawArgs[i] == "--token" && i + 1 < rawArgs.Length) token = rawArgs[++i];
            else if (rawArgs[i].StartsWith("--token=")) token = rawArgs[i]["--token=".Length..];
            else args.Add(rawArgs[i]);
        }

        // Say what is wrong before spending seconds loading a solution.
        var needed = args.FirstOrDefault() switch { "list" or "serve" => 2, "dump" => 3, "callers" => 4, _ => int.MaxValue };
        if (args.Count < needed) { Fail(Usage); return; }

        var port = 5199;
        var parentPid = 0;
        switch (args[0])
        {
            case "serve":
                if (string.IsNullOrEmpty(token)) { Fail("serve needs --token <hex>: every request must carry it in the x-flow-token header.\n" + Usage); return; }
                if (args.Count > 2 && (!int.TryParse(args[2], out port) || port is < 0 or > 65535)) { Fail($"Invalid port: {args[2]}"); return; }
                if (args.Count > 3 && !int.TryParse(args[3], out parentPid)) { Fail($"Invalid parent pid: {args[3]}"); return; }
                break;
            case "dump" when args.Count > 3 && !int.TryParse(args[3], out _):
                Fail($"Invalid depth: {args[3]}"); return;
            case "callers" when args.Count > 4 && !int.TryParse(args[4], out _):
                Fail($"Invalid depth: {args[4]}"); return;
        }

        var graph = await LoadAsync(args[1]);
        if (graph == null) return;

        switch (args[0])
        {
            case "list":
                foreach (var e in await graph.EntryPointsAsync())
                    Console.WriteLine($"{e.Http,-6} {e.Controller}.{e.Action}  {e.Id}");
                break;
            case "dump":
                var id = args[2].StartsWith("M:") ? args[2]
                    : (await graph.EntryPointsAsync()).FirstOrDefault(e => $"{e.Controller}.{e.Action}" == args[2])?.Id;
                var node = id == null ? null : await graph.BuildAsync(id, args.Count > 3 ? int.Parse(args[3]) : 4);
                if (node == null) { Console.Error.WriteLine($"No such entry point or method: {args[2]}"); Environment.ExitCode = 1; break; }
                Print(node, 0);
                break;
            case "callers":
                var m = (await graph.MethodsAsync(Path.GetFullPath(args[2]))).FirstOrDefault(x => x.Name.EndsWith("." + args[3]));
                var callers = m == null ? null : await graph.CallersAsync(m.Id, args.Count > 4 ? int.Parse(args[4]) : 3);
                if (callers == null) { Console.Error.WriteLine($"No such method: {args[3]} in {args[2]}"); Environment.ExitCode = 1; break; }
                Print(callers, 0);
                break;
            case "serve":
                if (parentPid > 0) WatchParent(parentPid);
                await Server.RunAsync(graph, port, token!, SourceDirs(graph));
                break;
        }
    }

    /// <summary>Every project folder (shared projects often live outside the .sln folder), without folders nested in another one.</summary>
    static List<string> SourceDirs(FlowGraph graph)
    {
        var dirs = graph.Solution.Projects.Select(p => Path.GetDirectoryName(p.FilePath)).OfType<string>().Distinct().ToList();
        return dirs.Where(d => !dirs.Any(o => o != d && Server.IsBelow(d, o))).ToList();
    }

    /// <summary>Exit when the editor that spawned us is gone, even if it was killed without cleanup.</summary>
    static void WatchParent(int pid) => _ = Task.Run(async () =>
    {
        while (true)
        {
            await Task.Delay(2000);
            try
            {
                using var parent = System.Diagnostics.Process.GetProcessById(pid);
                if (parent.HasExited) Environment.Exit(0);
            }
            catch (ArgumentException) { Environment.Exit(0); }
        }
    });

    static void Print(FlowNode n, int indent, string edge = "")
    {
        Console.WriteLine($"{new string(' ', indent * 2)}{edge}[{n.Kind}] {n.Label}  ({Path.GetFileName(n.File)}:{n.StartLine}-{n.EndLine})");
        foreach (var c in n.Children) Print(c.Node, indent + 1, $"{c.EdgeKind}@{c.CallLine} → ");
    }

    static async Task<FlowGraph?> LoadAsync(string sln)
    {
        var path = Path.GetFullPath(sln);
        if (!File.Exists(path)) { Fail($"Solution or project not found: {path}"); return null; }
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var ws = MSBuildWorkspace.Create();
        ws.RegisterWorkspaceFailedHandler(e => Console.Error.WriteLine($"[workspace] {e.Diagnostic.Kind}: {e.Diagnostic.Message}"));
        try
        {
            // `dotnet new webapi` makes a project and no solution: a project file is opened as a solution of its own
            // (with the projects it references), so such a repository traces like any other.
            var solution = IsProjectFile(path)
                ? (await ws.OpenProjectAsync(path)).Solution
                : await ws.OpenSolutionAsync(path);
            Console.Error.WriteLine($"[load] {solution.Projects.Count()} project(s), {sw.Elapsed.TotalSeconds:F1}s");
            return new FlowGraph(solution);
        }
        catch (Exception e)
        {
            Fail($"Cannot open {path}: {e.Message}");
            return null;
        }
    }

    static bool IsProjectFile(string path) =>
        path.EndsWith(".csproj", StringComparison.OrdinalIgnoreCase) || path.EndsWith(".fsproj", StringComparison.OrdinalIgnoreCase) || path.EndsWith(".vbproj", StringComparison.OrdinalIgnoreCase);
}
