#!/usr/bin/env bash
# Runs inside the container (scripts/docker-e2e.mjs starts it).
#   /src     the repository, read-only          /ctl/files  NUL-separated list of the files to take from it
#   /work    a named volume: the copy of Axle, the VS Code checkout and its build (kept between runs)
#   /out     the results, screenshots and logs  /probe      a probe script, with `probe <file>`
#   axle-e2e run [run.mjs options]     the desktop scenarios          axle-e2e probe <file> [args]   one Playwright script
# What is rebuilt depends on what changed since the last run, so a probe on an unchanged tree starts in seconds:
#   nothing changed                      nothing is built
#   ui/, protocol/ or an extension       the canvas and the extensions (build:canvas, build:extensions): seconds
#   the C# analyzer, a package file      the whole `npm run setup`
#   a patch or scripts/setup.mjs         a new VS Code checkout (20 to 40 minutes)
set -euo pipefail

mode="${1:-run}"
shift || true
cd /work/axle

started=$SECONDS
stage() { echo "[docker-e2e] $1 ($((SECONDS - started)) s since start)"; }

stage "copying the repository into the volume"
# -i lists what rsync actually changed: that decides what has to be rebuilt.
changed="$(rsync -a -i --from0 --files-from=/ctl/files /src/ /work/axle/ | grep '^>f' | sed 's/^[^ ]* //' || true)"
touched() { printf '%s\n' "$changed" | grep -qE "$1"; }
# A Windows checkout has CRLF line ends; git apply needs the patches the way upstream has them.
for p in editor/patches/*.patch; do tr -d '\r' < "$p" > "$p.lf" && mv "$p.lf" "$p"; done

# The VS Code checkout is patched once; a changed patch or setup script means a new checkout.
stamp="$(cat editor/patches/* scripts/setup.mjs scripts/lib.mjs | tr -d '\r' | sha256sum | cut -c1-16)"
full=no
if [ "$(cat .docker-stamp 2>/dev/null || true)" != "$stamp" ]; then
	full=yes
	if [ -d editor/vscode ]; then
		stage "the patches or the setup script changed: building a new VS Code checkout"
		find editor/vscode -mindepth 1 -maxdepth 1 -exec rm -rf {} +
	fi
elif touched '^(analyzer/|global\.json|package(-lock)?\.json|(ui|editor/extensions/[^/]+)/package(-lock)?\.json)'; then
	full=yes
fi

if [ "$full" = yes ]; then
	stage "npm run setup (the first run takes 20 to 40 minutes)"
	npm run setup > /out/setup.log 2>&1 || { tail -40 /out/setup.log; echo "[docker-e2e] setup failed; the whole log is setup.log in the output folder"; exit 3; }
	echo "$stamp" > .docker-stamp
elif touched '^(ui|protocol|editor/extensions)/'; then
	stage "rebuilding the canvas and the extensions (what changed)"
	{ npm run build:canvas && npm run build:extensions; } > /out/rebuild.log 2>&1 || { tail -40 /out/rebuild.log; echo "[docker-e2e] rebuild failed (rebuild.log)"; exit 3; }
else
	stage "nothing to rebuild"
fi

if [ ! -d test/e2e-desktop/node_modules/playwright-core ] || touched '^test/e2e-desktop/package(-lock)?\.json'; then
	(cd test/e2e-desktop && npm ci --no-audit --no-fund > /out/npm-ci.log 2>&1) || { tail -20 /out/npm-ci.log; exit 3; }
fi

# Only here, inside the container, is the machine one the tests may take over (test/e2e-desktop/lib/isolation.mjs).
export AXLE_E2E_ISOLATED=1
export AXLE_E2E_SOURCE=/work/axle/editor/vscode
export AXLE_E2E_OUT=/out
xvfb=(xvfb-run -a --server-args="-screen 0 1920x1080x24")

stage "starting"
status=0
case "$mode" in
	run) "${xvfb[@]}" node test/e2e-desktop/run.mjs --label docker --out /out --source editor/vscode "$@" || status=$? ;;
	probe) file="$1"; shift; "${xvfb[@]}" node "/probe/$file" "$@" || status=$? ;;
	*) echo "unknown mode $mode"; exit 2 ;;
esac
stage "done"
exit $status
