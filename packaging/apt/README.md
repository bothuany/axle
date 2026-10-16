# Hosting a signed APT repository for Axle

Not set up yet. Until then, Linux users install the `.deb` from the release (see `docs/building.md`). This page describes how to
host an APT repository so that `sudo apt install axle` works and `apt upgrade` picks up new releases.

## The shape

- **Where:** GitHub Pages of a separate repository, for example `bothuany/apt` served at `https://bothuany.github.io/apt`.
  An APT repository is only static files, so any static host or bucket works too. Keep the `.deb` files out of git
  history if you can: each one is over 100 MB, which is GitHub's per-file limit. Two ways round it are a Pages
  deployment built by an Actions workflow (`actions/deploy-pages`), so nothing is committed, or a bucket such as
  Cloudflare R2 or S3.
- **Layout:** a single suite `stable` with one component, `main`, and the architecture `amd64`:

  ```
  dists/stable/InRelease                      signed index (inline signature)
  dists/stable/Release, Release.gpg           the same with a detached signature, for older apt
  dists/stable/main/binary-amd64/Packages(.gz)
  pool/main/a/axle/axle_<version>_amd64.deb
  axle.asc                                    the public key users install
  ```

- **Tool:** [`aptly`](https://www.aptly.info/) or `reprepro` builds and signs this tree from the `.deb` files. A small
  `dpkg-scanpackages` + `apt-ftparchive release` + `gpg --clearsign` script also works for a single package.

## The signing key

1. Generate a dedicated key that is used for nothing else:

   ```bash
   gpg --quick-generate-key "Axle APT repository <bothuany@users.noreply.github.com>" ed25519 sign 3y
   ```

2. Export the public key as `axle.asc` and publish it at the repository root. Users trust it for this repository only,
   through `Signed-By:`. Do not ask them to add it to the global `trusted.gpg`.
3. Export the private key (`gpg --armor --export-secret-keys`) into an Actions secret, for example `APT_SIGNING_KEY`,
   plus `APT_SIGNING_PASSPHRASE` if it has one. Keep an offline copy. Rotating the key means every user must fetch
   the new `axle.asc`, so give it a long expiry and extend it before it lapses.

## Publishing a release

Add a job to `.github/workflows/release.yml` that runs after `packages` on a tag. It should:

1. download `axle_<version>_amd64.deb` from the release,
2. import the signing key from the secret,
3. add the package to the repository (`aptly repo add`, then `aptly publish update stable`, or the script above).
   Keep earlier versions in `pool/` so that a downgrade stays possible,
4. push the result to the hosting repository or bucket with a token scoped to that repository only.

`Version:` in the package is Axle's version from `package.json` (scripts/package.mjs sets it), so every tag must raise
it, or apt will not see the release as an upgrade.

## What users run

```bash
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://bothuany.github.io/apt/axle.asc | sudo tee /etc/apt/keyrings/axle.asc >/dev/null
sudo tee /etc/apt/sources.list.d/axle.sources >/dev/null <<'EOF'
Types: deb
URIs: https://bothuany.github.io/apt
Suites: stable
Components: main
Architectures: amd64
Signed-By: /etc/apt/keyrings/axle.asc
EOF
sudo apt update && sudo apt install axle
```

The `.deb` deliberately does not add this source itself. VS Code's maintainer scripts register Microsoft's repository,
and Axle's (in `packaging/linux/deb`) replace them so that installing Axle never touches the machine's apt sources.
Once the repository exists, the `postinst` could offer to add it, as VS Code's does for its own.
