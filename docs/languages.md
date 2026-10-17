# Languages

| | Axle from an endpoint | Axle at the cursor | Database schema cards |
|---|---|---|---|
| C# / .NET | ✓ ASP.NET (Roslyn, incl. MediatR and DI) from a `.sln`/`.slnx`, or a `.csproj` when there is no solution; needs the .NET 10 SDK | ✓ | ✓ EF Core |
| Java | ✓ Spring, JAX-RS, Servlets, Axis2, JSF, plus scheduled jobs and message listeners | ✓ | ✓ JPA entities and Spring Data repositories; JDBC (raw SQL) in progress |
| Python | ✓ FastAPI, Flask, Django / DRF | ✓ | ✓ Django ORM, SQLAlchemy |
| JavaScript / TypeScript | ✓ Express, NestJS, Next.js (app and pages routers) | ✓ | Prisma and TypeORM (untested) |
| Go | ✓ Gin, Echo, Fiber, chi, net/http | ✓ | not yet |
| PHP | ✓ Laravel routes and resources, Symfony `#[Route]` | ✓ | not yet |
| Ruby | ✓ Rails routes, `resources`, Sinatra | ✓ | not yet |
| Rust | ✓ axum, actix-web, Rocket | ✓ | not yet |
| Kotlin, Swift and others | not yet | only if you install that language's extension (Open VSX) and its server supports call hierarchy; not tested here | not yet |

**How it resolves a flow.** Entry points (routes, jobs, listeners) and most calls come from a build-free tree-sitter index, so a project opens instantly and needs no restore or compile. Calls the index cannot resolve, or only guessed by name, are asked to the language server of that file (go-to-definition, then go-to-implementation for interface methods) when one is running; no server, or no answer within 1.5 s, leaves the flow as the index drew it. Turn it off with `flow.lspResolution`. C# uses the Roslyn analyzer in `analyzer/` (it needs the project restored, and the .NET 10 SDK to run). Go, PHP, Ruby and Rust were checked on small sample projects only; the linking is name-based within a package or directory, so large codebases lean on their language server for the rest.

**What is indexed.** Every file of the workspace folder in an indexed language, except what git ignores (build output, generated code, a vendored checkout: the same files `git status` leaves out) and dependency and cache folders such as `node_modules`, `.venv` and `dist`. A folder that is not a git repository is indexed whole, minus those folders.

**Calls between services.** An HTTP client call whose path matches an endpoint in the same workspace (`fetch`, axios and `this.http` in JavaScript/TypeScript; `requests`, `httpx` and sessions in Python; `RestTemplate` and `WebClient`/`RestClient` in Java) continues the flow into that endpoint's handler, drawn as a dashed `HTTP?` edge. It is always a guess: the path is matched by its written segments (parameters, interpolations and concatenated variables match any one segment, a base URL held in a variable matches the end of the route), and which service actually answers is not known statically.
