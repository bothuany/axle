using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace FlowAnalyzer;

public static class Server
{
    // Deep trees at the depth clamp nest several JSON levels per call hop; the default limit of 64 is too small for them.
    private const int MaxJsonDepth = 256;
    private const int MaxFlowDepth = 8;

    /// <summary>`port` 0 lets the OS pick one; the bound port is printed on stdout once the server is listening.</summary>
    public static async Task RunAsync(FlowGraph graph, int port, string token, IReadOnlyList<string> sourceDirs)
    {
        // The content root is the install folder, not the cwd: an appsettings.json next to the user's solution must not reconfigure Kestrel.
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { ContentRootPath = AppContext.BaseDirectory });
        builder.WebHost.UseUrls($"http://127.0.0.1:{port}");
        // Hosting logs go to stderr: stdout carries exactly one line, the one that names the bound port.
        builder.Logging.ClearProviders();
        builder.Logging.SetMinimumLevel(LogLevel.Warning);
        builder.Logging.AddConsole(o => o.LogToStandardErrorThreshold = LogLevel.Trace);
        builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.MaxDepth = MaxJsonDepth);
        var app = builder.Build();

        var boundPort = port;
        var tokenBytes = Encoding.UTF8.GetBytes(token);

        // The only client is the editor's extension host on this machine. A web page must not be able to reach the
        // analyzer through the browser: browsers always attach Origin to cross-site requests, the Host check stops DNS
        // rebinding, and the token (handed to the child at spawn) keeps every other local process out.
        app.Use(async (context, next) =>
        {
            if (context.Request.Headers.ContainsKey("Origin"))
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                return;
            }
            var host = context.Request.Host;
            if (host.Port != boundPort || (host.Host != "127.0.0.1" && host.Host != "localhost"))
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                return;
            }
            var presented = Encoding.UTF8.GetBytes(context.Request.Headers["x-flow-token"].ToString());
            if (!CryptographicOperations.FixedTimeEquals(presented, tokenBytes))
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return;
            }
            await next();
        });

        var gate = new SemaphoreSlim(1, 1); // the Roslyn solution is swapped on refresh; serialize access
        async Task<IResult> Locked(Func<Task<IResult>> f, CancellationToken ct)
        {
            await gate.WaitAsync(ct);
            try { return await f(); } finally { gate.Release(); }
        }

        app.MapGet("/api/entrypoints", (CancellationToken ct) => Locked(async () => Results.Ok(await graph.EntryPointsAsync()), ct));
        app.MapGet("/api/graph", (string id, int? depth, CancellationToken ct) => Locked(async () =>
        {
            var node = await graph.BuildAsync(id, Math.Clamp(depth ?? 4, 1, MaxFlowDepth), ct);
            return node == null ? Results.NotFound() : Results.Ok(node);
        }, ct));
        // Every source type with its members, and every controller action with its types: the type model. Cached until a refresh changes the solution.
        var catalog = new TypeCatalog(graph);
        app.MapGet("/api/types", (int? limit, CancellationToken ct) => Locked(async () => Results.Ok(await catalog.GetAsync(Math.Clamp(limit ?? TypeCatalog.MaxTypes, 1, TypeCatalog.MaxTypes), ct)), ct));
        // Which tables the entry points reach, and which entities map to which tables: the table → endpoints index. The walk goes one entry
        // point per turn at the gate, so a flow the canvas asks for in the meantime waits for one step, not for the whole walk.
        var tables = new TableWalk(graph);
        app.MapGet("/api/tables", async (int? budgetMs, CancellationToken ct) =>
        {
            var deadline = DateTime.UtcNow.AddMilliseconds(Math.Clamp(budgetMs ?? 5000, 200, 20_000));
            var done = false;
            while (!done && DateTime.UtcNow < deadline)
            {
                await gate.WaitAsync(ct);
                try { done = await tables.StepAsync(ct); } finally { gate.Release(); }
            }
            await gate.WaitAsync(ct);
            try { return Results.Ok(tables.Snapshot()); } finally { gate.Release(); }
        });
        app.MapGet("/api/entities", (CancellationToken ct) => Locked(async () => Results.Ok(new EntitiesFact(graph.Version, await graph.EntitiesAsync())), ct));
        // An EF migration, read from its file alone (no gate: it touches no solution state). Only files inside a project folder.
        app.MapGet("/api/migration", (string file) =>
        {
            var full = Path.GetFullPath(file);
            if (!full.EndsWith(".cs", StringComparison.OrdinalIgnoreCase) || !File.Exists(full) || !sourceDirs.Any(d => IsBelow(full, d))) return Results.NotFound();
            return Results.Ok(MigrationReader.Read(full));
        });
        app.MapGet("/api/impact", (string id, CancellationToken ct) => Locked(async () => Results.Ok(await graph.ImpactAsync(id, ct: ct)), ct));
        app.MapGet("/api/methods", (string file, CancellationToken ct) => Locked(async () => Results.Ok(await graph.MethodsAsync(file)), ct));
        app.MapGet("/api/callers", (string id, int? depth, CancellationToken ct) => Locked(async () =>
        {
            var node = await graph.CallersAsync(id, Math.Clamp(depth ?? 3, 1, MaxFlowDepth), ct);
            return node == null ? Results.NotFound() : Results.Ok(node);
        }, ct));

        // Editing help for the card editor: POST with a JSON body (the card's text can be large and is not a URL). They read the
        // immutable solution snapshot, so they do not wait for the gate that a flow walk or a refresh holds.
        var assist = new Assist(graph);
        const long MaxBody = 8 * 1024 * 1024;
        async Task<IResult> Assisted<T>(HttpRequest request, Func<CardRequest, Task<T>> answer)
        {
            if (request.ContentLength > MaxBody) return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
            CardRequest? body;
            try { body = await request.ReadFromJsonAsync<CardRequest>(request.HttpContext.RequestAborted); }
            catch (Exception e) when (e is System.Text.Json.JsonException or InvalidOperationException or BadHttpRequestException) { return Results.BadRequest(); }
            return body == null ? Results.BadRequest() : Results.Json(await answer(body));
        }
        app.MapPost("/api/assist/complete", (HttpRequest request) => Assisted(request, b => assist.CompleteAsync(b, request.HttpContext.RequestAborted)));
        app.MapPost("/api/assist/signature", (HttpRequest request) => Assisted(request, b => assist.SignatureAsync(b, request.HttpContext.RequestAborted)));
        app.MapPost("/api/assist/hover", (HttpRequest request) => Assisted(request, b => assist.HoverAsync(b, request.HttpContext.RequestAborted)));
        app.MapPost("/api/assist/definition", (HttpRequest request) => Assisted(request, b => assist.DefinitionAsync(b, request.HttpContext.RequestAborted)));

        try
        {
            await app.StartAsync();
        }
        catch (Exception e)
        {
            Console.Error.WriteLine($"Cannot listen on 127.0.0.1:{port}: {e.Message}");
            Environment.ExitCode = 2;
            return;
        }
        var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()?.Addresses.FirstOrDefault();
        if (address != null && Uri.TryCreate(address, UriKind.Absolute, out var uri)) boundPort = uri.Port;

        WatchSources(graph, sourceDirs, gate);
        _ = Task.Run(assist.WarmAsync);

        Console.Error.WriteLine($"[serve] http://127.0.0.1:{boundPort}");
        Console.Out.WriteLine($"listening on http://127.0.0.1:{boundPort}");
        Console.Out.Flush();
        await app.WaitForShutdownAsync();
    }

    private static bool IsSource(string? path)
    {
        // Build output is not source: a build rewrites obj/ and bin/ all the time. (Windows paths use \.)
        var normalized = path?.Replace('\\', '/');
        return normalized != null && normalized.EndsWith(".cs", StringComparison.OrdinalIgnoreCase) && !normalized.Contains("/obj/") && !normalized.Contains("/bin/");
    }

    /// <summary>
    /// Keeps the Roslyn snapshot in sync with disk. Debounced, and applied under the same gate as requests.
    /// One watcher per project folder (never a shared ancestor, which can be a drive root or the home folder).
    /// Rider saves atomically (temp file + rename), so Renamed counts with its new path and its old one.
    /// </summary>
    private static void WatchSources(FlowGraph graph, IReadOnlyList<string> dirs, SemaphoreSlim gate)
    {
        var pending = new HashSet<string>();
        var resyncAll = false;
        var sync = new object();
        Timer? timer = null;

        async Task RefreshAsync()
        {
            string[] batch;
            bool resync;
            lock (sync) { batch = pending.ToArray(); pending.Clear(); resync = resyncAll; resyncAll = false; timer?.Dispose(); timer = null; }
            await gate.WaitAsync();
            try
            {
                if (resync)
                {
                    // The watcher lost events: everything the snapshot knows may be stale, and new files may be missing.
                    var options = new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true };
                    var all = new HashSet<string>(graph.DocumentFiles());
                    foreach (var dir in dirs)
                        foreach (var file in Directory.EnumerateFiles(dir, "*.cs", options))
                            if (IsSource(file)) all.Add(Path.GetFullPath(file));
                    all.UnionWith(batch);
                    batch = all.ToArray();
                }
                var n = await graph.RefreshAsync(batch);
                if (n > 0) Console.Error.WriteLine($"[watch] refreshed {n} file(s)");
            }
            finally { gate.Release(); }
        }

        // A timer callback that throws takes the whole process down: log the failure and keep serving.
        void Schedule() => timer ??= new Timer(async _ =>
        {
            try { await RefreshAsync(); }
            catch (Exception e) { Console.Error.WriteLine($"[watch] refresh failed: {e.Message}"); }
        }, null, 300, Timeout.Infinite);

        void Queue(string? path)
        {
            if (!IsSource(path)) return;
            lock (sync)
            {
                pending.Add(Path.GetFullPath(path!));
                Schedule();
            }
        }

        // A watcher that overflows its buffer has missed changes: re-read everything instead of waiting for a restart.
        void Overflow(Exception e)
        {
            Console.Error.WriteLine($"[watch] watcher error, resyncing: {e.Message}");
            lock (sync)
            {
                resyncAll = true;
                Schedule();
            }
        }

        // Nested project folders are already covered by the outer watcher.
        foreach (var dir in dirs.Where(d => Directory.Exists(d) && !dirs.Any(o => o != d && IsBelow(d, o))))
        {
            var w = new FileSystemWatcher(dir, "*.cs") { IncludeSubdirectories = true, NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.Size };
            w.Changed += (_, e) => Queue(e.FullPath);
            w.Created += (_, e) => Queue(e.FullPath);
            w.Deleted += (_, e) => Queue(e.FullPath);
            w.Renamed += (_, e) => { Queue(e.OldFullPath); Queue(e.FullPath); };
            w.Error += (_, e) => Overflow(e.GetException());
            w.EnableRaisingEvents = true;
            _watchers.Add(w);
            Console.Error.WriteLine($"[watch] {dir}");
        }
    }

    internal static bool IsBelow(string dir, string root)
    {
        var relative = Path.GetRelativePath(root, dir);
        return relative == "." || (!relative.StartsWith("..") && !Path.IsPathRooted(relative));
    }

    /// <summary>Kept for the life of the process: a watcher that is garbage-collected stops watching.</summary>
    private static readonly List<FileSystemWatcher> _watchers = new();
}
