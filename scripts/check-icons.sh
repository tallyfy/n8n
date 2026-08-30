#!/usr/bin/env bash
#
# Fails when the icon copy step produced a different set of icons from the one on disk.
#
# Why this exists: `npm run build` is `tsc && gulp build:icons`, and `gulp build:icons` is
# `src('nodes/**/*.svg').pipe(dest('dist/nodes'))`. That glob contains magic characters,
# so gulp does NOT error when it matches nothing. It copies zero files and exits 0
# (tallyfy/n8n#43). A `v*` tag push in this repo is an irreversible public npm publish and
# it runs that build, so the release path could ship a package whose node has no icon and
# report success. The build passing told you the build ran, not that it produced anything.
#
# Measured 2026-08-29 before this script existed: with the glob pointed at
# `nodes/**/*.svg.notreal` and `dist` removed first, `npm run build` exited 0 with 0 svg
# files under dist/nodes.
#
# So this asserts the OUTPUT rather than gulp's exit code, which is the thing that was
# wrong. Two assertions, one verdict:
#   - the number of *.svg files under the output directory equals the number under the
#     source directory
#   - every source-relative path is present in the output. gulp's `src` base is the source
#     directory, so nodes/Tallyfy/tallyfy.svg lands at dist/nodes/Tallyfy/tallyfy.svg and
#     the two relative path sets are directly comparable (verified against a real build).
#     The count alone would pass a stale output tree that happens to hold the same number
#     of different files.
#
# Used in three places, which is the point:
#   - package.json "build", so `npm run build` itself fails, including the `prepublishOnly`
#     build and any build a person runs by hand
#   - .github/workflows/ci.yml, so a pull request goes red on the commit that breaks it
#   - .github/workflows/release.yml, as the backstop on the one path that is irreversible,
#     the same argument that file already makes for duplicating check-version-sync.sh
# and its behaviour is proven offline by test/scripts/check-icons.test.ts.
#
# Usage: scripts/check-icons.sh [source-dir] [output-dir]
#        defaults: <repo>/nodes and <repo>/dist/nodes
#
# Exit codes follow scripts/check-changelog.sh and scripts/check-version-sync.sh: 0 the two
# sets agree, 1 they disagree, 2 the check itself could not answer. 2 is reserved
# deliberately, so a check that could not run is never mistaken for a clean verdict in
# either direction.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src_dir="${1:-$repo_root/nodes}"
out_dir="${2:-$repo_root/dist/nodes}"

if [ ! -d "$src_dir" ]; then
	echo "check-icons: BROKEN - no such source directory: $src_dir" >&2
	exit 2
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Relative paths, sorted under a fixed collation so the comparison is identical on macOS
# and on the Linux runner. Written to files rather than piped into a count, because reading
# an exit status off a pipeline gives you the last command's status, not find's.
find_rc=0
(cd "$src_dir" && find . -type f -name '*.svg' -print) | LC_ALL=C sort > "$work/src.txt" || find_rc=$?
if [ "$find_rc" -ne 0 ]; then
	echo "check-icons: BROKEN - could not list $src_dir (find exit $find_rc)" >&2
	exit 2
fi

src_count="$(wc -l < "$work/src.txt" | tr -d ' ')"

# The vacuity refusal, and it is the whole reason this script exists rather than a bare
# equality test. With no source icons, 0 output files equals 0 source files and an
# unguarded comparison reports OK forever. A gate that cannot fail is not a gate, and that
# is precisely the shape being fixed here, so this refuses to answer instead of passing.
if [ "$src_count" -eq 0 ]; then
	cat >&2 <<MSG
check-icons: BROKEN - found no *.svg under $src_dir, so there is nothing to compare

This is reported as a broken check rather than a pass. Zero output files would otherwise
equal zero source files and the comparison would succeed while proving nothing.

Either the icons were deleted, or this was pointed at the wrong directory.
MSG
	exit 2
fi

# A missing output directory means the build has not run, which is a different statement
# from "the copy produced nothing", and reporting it as the latter sends someone to debug
# gulp when they simply never built. Still non-zero, so a workflow step still goes red.
if [ ! -d "$out_dir" ]; then
	cat >&2 <<MSG
check-icons: BROKEN - no such output directory: $out_dir

There are $src_count icon(s) under $src_dir and no build output to compare them against.
Run the build first:

  npm run build
MSG
	exit 2
fi

(cd "$out_dir" && find . -type f -name '*.svg' -print) | LC_ALL=C sort > "$work/out.txt" || find_rc=$?
if [ "$find_rc" -ne 0 ]; then
	echo "check-icons: BROKEN - could not list $out_dir (find exit $find_rc)" >&2
	exit 2
fi

out_count="$(wc -l < "$work/out.txt" | tr -d ' ')"

if [ "$src_count" -eq "$out_count" ] && cmp -s "$work/src.txt" "$work/out.txt"; then
	echo "check-icons: OK - all $src_count icon(s) under $src_dir are present under $out_dir"
	exit 0
fi

missing="$(LC_ALL=C comm -23 "$work/src.txt" "$work/out.txt" || true)"
extra="$(LC_ALL=C comm -13 "$work/src.txt" "$work/out.txt" || true)"

{
	echo "check-icons: FAIL - the icon copy did not reproduce the source set"
	echo
	echo "  icons under $src_dir: $src_count"
	echo "  icons under $out_dir: $out_count"
	if [ -n "$missing" ]; then
		echo
		echo "  in the source but NOT copied:"
		printf '%s\n' "$missing" | sed 's|^\./|    |'
	fi
	if [ -n "$extra" ]; then
		echo
		echo "  in the output but not in the source, so the output tree is stale:"
		printf '%s\n' "$extra" | sed 's|^\./|    |'
	fi
	cat <<'MSG'

`gulp build:icons` copies nodes/**/*.svg into dist/nodes. That glob does not error when it
matches nothing, so gulp reports success either way and only this comparison can tell the
two apart (tallyfy/n8n#43).

Check that the glob in gulpfile.js still matches where the icons actually live. If the
output tree is merely stale, rebuild it from scratch:

  rm -rf dist && npm run build
MSG
} >&2
exit 1
