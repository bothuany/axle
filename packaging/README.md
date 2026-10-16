# Package-manager distribution

What `release.yml` builds on a `v*` tag is attached to the GitHub release (see `.github/workflows/release.yml`). The files
here hand those release files to package managers. **None of them is published yet.**

| | File | Where it goes | Status |
|---|---|---|---|
| Windows | `winget/manifests/b/bothuany/Axle/<version>/` | a pull request to [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs) | written, not submitted |
| macOS | `homebrew/axle.rb` | `Casks/axle.rb` in a new repository `bothuany/homebrew-tap` | written, the tap repository does not exist |
| Linux | `apt/README.md` | a signed APT repository | described, not set up |
| Linux | `linux/deb/` | used by `scripts/package.mjs`: the `.deb`'s maintainer scripts | in use |

## Each release

1. Raise `version` in `package.json`, then tag and push it (`git tag v<version> && git push origin v<version>`). The
   workflow checks that the two match.
2. When the workflow is done, the release carries `SHA256SUMS.txt`.
3. **winget:** copy the folder to the new version. Set `PackageVersion`, `InstallerUrl`, `ReleaseNotesUrl` and
   `InstallerSha256` (the `.exe` line, in upper or lower case), then check the manifest with
   `winget validate --manifest <folder>`. Submit it with `wingetcreate submit <folder>`, or as a pull request to
   winget-pkgs under `manifests/b/bothuany/Axle/<version>/`. For later versions, `wingetcreate update bothuany.Axle
   --version <v> --urls <exe url> --submit` does all of this in one step. After the first merge, `winget install
   bothuany.Axle` works and `winget upgrade` picks up each new version as soon as its manifest is merged.
4. **Homebrew:** in the tap, set `version` and the two `sha256` values (the `darwin-arm64.zip` and `darwin-x64.zip`
   lines), then run `brew audit --cask --online bothuany/tap/axle` and `brew style`. `brew upgrade` picks it up after
   that. A release job could do this with a token for the tap repository; `brew bump-cask-pr` is the manual route.
5. **APT:** see `apt/README.md`.

## Not signed yet

- **Windows:** the installer has no Authenticode signature, so SmartScreen warns before it runs. winget accepts unsigned
  installers, but Defender's SmartScreen still shows its prompt.
- **macOS:** the app has an ad hoc signature, not a Developer ID one, and it is not notarized. Gatekeeper blocks the
  first launch until the user allows it. Third-party taps accept such casks; homebrew-core does not. Signing needs an
  Apple Developer account, the certificate and an app-specific password in Actions secrets, then `codesign` with the
  hardened runtime and VS Code's entitlements (`build/azure-pipelines/darwin/*.plist`) and `xcrun notarytool submit
  --wait` + `stapler staple` in `scripts/package.mjs` in place of the ad hoc step.
- **Linux:** the `.deb` itself is not signed, which is normal. An APT repository signs its index instead (`apt/README.md`).

## Still named like Code - OSS

`product.json` (in `editor/patches/flow-core.patch`) still carries Code - OSS's `darwinBundleIdentifier`
(`com.visualstudio.code.oss`), `linuxDesktopName` (`com.visualstudio.CodeOSS`) and `linuxIconName` (`code-oss`).
On macOS this means Axle shares its preferences domain with a Code - OSS app. On Linux, the `.deb` installs
`/usr/share/applications/com.visualstudio.CodeOSS.desktop` and `/usr/share/pixmaps/code-oss.png`, which clash with a
Code - OSS package. Changing them is a change to the core patch, so every existing checkout has to run
`npm run setup` again afterwards.
