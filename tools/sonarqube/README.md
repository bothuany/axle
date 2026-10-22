# Local SonarQube

```bash
npm run sonar:up      # SonarQube Community in Docker on http://localhost:9000
npm run sonar         # scan the TypeScript/JavaScript side (project `insilode`)
npm run sonar -- --dotnet   # also the C# analyzer (project `insilode-analyzer`)
npm run sonar:down
```

Once per machine: open http://localhost:9000, log in as `admin` / `admin`, set a new password, then create a
token under **My Account > Security** and put it in `SONAR_TOKEN` or in `tools/sonarqube/.token` (git-ignored).

What is scanned and excluded is in `sonar-project.properties` at the repo root. The extension tsconfigs extend the
VS Code checkout, so run `npm run setup` first for full type-aware TypeScript rules.
