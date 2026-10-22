#!/usr/bin/env bash
# A `curl` for the release job's Linux build (.github/workflows/release.yml puts it first on PATH as `curl`).
#
# VS Code's deb step fetches Chromium's dpkg-shlibdeps.pl from raw.githubusercontent.com with a plain `curl`, and that host
# answers GitHub's runners "429: Too Many Requests" (with or without a token), which curl then saves as the script. A call whose
# only URL is raw.githubusercontent.com/<owner>/<repo>/<ref>/<path> is sent to the API's contents endpoint instead, with the job's
# read-only GITHUB_TOKEN, retries, and --fail, so an error page is never saved as the file. <ref> may be a branch, a tag or a
# commit, or refs/heads/<branch> or refs/tags/<tag>. The token goes to api.github.com only: a call with any other URL in it, or a
# raw URL that cannot be read with certainty, runs unchanged (curl drops a custom Authorization header on a redirect to another
# host, so --location does not pass it on either).
#
# INSILODE_REAL_CURL names the curl to run (default /usr/bin/curl); test/update/release.test.mjs passes a stand-in.
set -u
real="${INSILODE_REAL_CURL:-/usr/bin/curl}"
raw='https://raw.githubusercontent.com/'

# Prints the contents-API URL for a raw.githubusercontent.com URL; fails when the URL is not one it can read with certainty.
api_url() {
	local rest="${1#"$raw"}"
	rest="${rest%%[?#]*}"
	local owner="${rest%%/*}"
	rest="${rest#*/}"
	local repo="${rest%%/*}"
	rest="${rest#*/}"
	local ref
	case "$rest" in
	refs/heads/* | refs/tags/*)
		rest="${rest#refs/*/}"
		;;
	refs/*)
		return 1
		;;
	esac
	ref="${rest%%/*}"
	case "$rest" in
	*/*) rest="${rest#*/}" ;;
	*) return 1 ;;
	esac
	if [ -z "$owner" ] || [ -z "$repo" ] || [ -z "$ref" ] || [ -z "$rest" ]; then
		return 1
	fi
	printf 'https://api.github.com/repos/%s/%s/contents/%s?ref=%s' "$owner" "$repo" "$rest" "$ref"
}

urls=0
target=-1
api=''
i=0
args=("$@")
for arg in "${args[@]}"; do
	case "$arg" in
	"$raw"* | --url="$raw"*)
		urls=$((urls + 1))
		if api=$(api_url "${arg#--url=}"); then
			target=$i
		fi
		;;
	http://* | https://* | --url=*)
		urls=$((urls + 1))
		;;
	esac
	i=$((i + 1))
done

if [ "$urls" -ne 1 ] || [ "$target" -lt 0 ]; then
	exec "$real" "$@"
fi

case "${args[$target]}" in
--url=*) args[target]="--url=$api" ;;
*) args[target]="$api" ;;
esac
extra=(--fail --location --retry 5 --retry-delay 15 --retry-all-errors -H 'Accept: application/vnd.github.raw')
if [ -n "${GITHUB_TOKEN:-}" ]; then
	extra+=(-H "Authorization: Bearer $GITHUB_TOKEN")
fi
exec "$real" "${args[@]}" "${extra[@]}"
