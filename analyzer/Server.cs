using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.FileProviders;

namespace FlowAnalyzer;

public static class Server
{
    public sealed record SaveRequest(string File, int StartLine, int EndLine, string Original, string Code);

    public static async Task RunAsync(FlowGraph graph, int port, string solutionDir)
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls($"http://127.0.0.1:{port}");
        builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));
        var app = builder.Build();
        app.UseCors();

        var gate = new SemaphoreSlim(1, 1); // Roslyn solution is swapped on save; serialize access
        async Task<IResult> Locked(Func<Task<IResult>> f)
        {
            await gate.WaitAsync();
            try { return await f(); } finally { gate.Release(); }
        }

        WatchSources(graph, solutionDir, gate);

        app.MapGet("/api/entrypoints", () => Locked(async () => Results.Ok(await graph.EntryPointsAsync())));
        app.MapGet("/api/graph", (string id, int? depth) => Locked(async () =>
        {
            var node = await graph.BuildAsync(id, depth ?? 4);
            return node == null ? Results.NotFound() : Results.Ok(node);
        }));
        app.MapGet("/api/impact", (string id) => Locked(async () => Results.Ok(await graph.ImpactAsync(id))));
        app.MapGet("/api/methods", (string file) => Locked(async () => Results.Ok(await graph.MethodsAsync(file))));
        app.MapGet("/api/callers", (string id, int? depth) => Locked(async () =>
        {
            var node = await graph.CallersAsync(id, depth ?? 3);
            return node == null ? Results.NotFound() : Results.Ok(node);
        }));
        app.MapPost("/api/save", (SaveRequest req) => Locked(async () =>
        {
            return await graph.SaveAsync(req.File, req.StartLine, req.EndLine, req.Original, req.Code)
                ? Results.Ok()
                : Results.Conflict("The file changed outside Flow. The flow was reloaded; apply your change again.");
        }));

        var dist = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../ui/dist"));
        if (Directory.Exists(dist))
        {
            var fp = new PhysicalFileProvider(dist);
            app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = fp });
            app.UseStaticFiles(new StaticFileOptions { FileProvider = fp });
        }

        Console.Error.WriteLine($"[serve] http://127.0.0.1:{port}");
        await app.RunAsync();
    }

    /// <summary>
    /// Keeps the Roslyn snapshot in sync with disk. Debounced, and applied under the same gate as requests.
    /// Rider saves atomically (temp file + rename), so Renamed counts with its new path.
    /// </summary>
    private static void WatchSources(FlowGraph graph, string dir, SemaphoreSlim gate)
    {
        var pending = new HashSet<string>();
        var sync = new object();
        Timer? timer = null;
        void Queue(string? path)
        {
            if (path == null || !path.EndsWith(".cs", StringComparison.OrdinalIgnoreCase) || path.Contains("/obj/") || path.Contains("/bin/")) return;
            lock (sync)
            {
                pending.Add(Path.GetFullPath(path));
                timer ??= new Timer(async _ =>
                {
                    string[] batch;
                    lock (sync) { batch = pending.ToArray(); pending.Clear(); timer?.Dispose(); timer = null; }
                    await gate.WaitAsync();
                    try
                    {
                        var n = await graph.RefreshAsync(batch);
                        if (n > 0) Console.Error.WriteLine($"[watch] {n} dosya yenilendi");
                    }
                    finally { gate.Release(); }
                }, null, 300, Timeout.Infinite);
            }
        }

        var w = new FileSystemWatcher(dir, "*.cs") { IncludeSubdirectories = true, NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.Size };
        w.Changed += (_, e) => Queue(e.FullPath);
        w.Created += (_, e) => Queue(e.FullPath);
        w.Renamed += (_, e) => Queue(e.FullPath);
        w.EnableRaisingEvents = true;
        GC.KeepAlive(w);
        _watchers.Add(w);
    }

    private static readonly List<FileSystemWatcher> _watchers = new();
}
