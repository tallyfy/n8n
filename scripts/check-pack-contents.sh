#!/usr/bin/env bash
#
# Fails when the tarball npm would build does not contain the files this package declares
# as its entry points.
#
# Why this exists: `package.json` carries `"files": ["dist"]`, and `dist/` is a build
# output that is gitignored. `npm pack` on a tree that was never built does not complain
# about the missing directory. It builds a tarball out of what is there and exits 0.
#
# Measured 2026-08-30 on a clean checkout of this repository, both arms of the same probe:
#
#   no dist directory at all   ->  rc 0, entryCount 4
#                                  LICENSE, README.md, index.js, package.json
#   dist present               ->  rc 0, entryCount 9
#                                  the four above plus the built nodes and credential
#
# So npm would build and publish a package containing none of the code, and report success
# (tallyfy/n8n#45). Same shape as tallyfy/n8n#43, where `gulp build:icons` copied zero icons
# and exited 0.
#
# This asserts the tarball CONTENTS rather than `npm pack`'s exit code, because the exit
# code is the thing that is wrong. Asserting it would be asserting the defect.
#
# Note what is deliberately NOT asserted, because it would be a check that cannot fail:
#   - "the tarball holds at least one .js". `index.js` is at the package root, npm always
#     includes the file named by `main`, and it was present in the 4-entry unbuilt tarball
#     above. That assertion passes on a tree with no code in it.
#   - `main`, `package.json`, `README.md` and `LICENSE`. npm force-includes all four
#     whatever `files` says, so requiring them tests npm rather than this package.
#
# What IS asserted is every path under `n8n.nodes` and `n8n.credentials` in package.json.
# Those are the files n8n itself loads at runtime, they are the ones that vanish when the
# build has not run, and they are named rather than counted, so a broken version of this
# script cannot satisfy the assertion by returning a plausible number.
#
# The paths compare directly. `npm pack --json` reports each entry under `files[].path`
# without the `package/` prefix the tarball itself uses, and `n8n.nodes` entries are already
# repository-relative, so `dist/nodes/Tallyfy/Tallyfy.node.js` on one side is the same
# string as on the other (verified against a real pack, and covered by
# test/scripts/check-pack-contents.test.ts).
#
# `--ignore-scripts` is passed to the inner `npm pack`. This repository has no `prepack` and
# no `prepare` script today, so it changes nothing that is measured: the file list comes
# from `files` and the working tree. It is there so that adding one later cannot make this
# check re-enter itself when it runs from `prepublishOnly`. Every place this is wired runs
# it AFTER the build, so it never depends on a lifecycle script to produce `dist`.
#
# Used in three places, which is the point:
#   - package.json "prepublishOnly", after the build, so `npm publish` run by hand from a
#     tree that was never built cannot ship an empty package. That was the one path
#     tallyfy/n8n#45 recorded as still unguarded
#   - .github/workflows/ci.yml, so a pull request goes red on the commit that breaks it
#   - .github/workflows/release.yml, as the backstop on the one path that is irreversible,
#     the same argument that file already makes for check-changelog.sh, check-version-sync.sh
#     and check-icons.sh
# and its behaviour is proven offline by test/scripts/check-pack-contents.test.ts.
#
# Usage: scripts/check-pack-contents.sh [package-dir]
#        default: the repository root
#
# Exit codes follow scripts/check-changelog.sh, scripts/check-version-sync.sh and
# scripts/check-icons.sh: 0 every declared entry point is in the tarball, 1 at least one is
# missing, 2 the check itself could not answer. 2 is reserved deliberately, so a check that
# could not run is never mistaken for a clean verdict in either direction.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pkg_dir="${1:-$repo_root}"

if [ ! -d "$pkg_dir" ]; then
	echo "check-pack-contents: BROKEN - no such package directory: $pkg_dir" >&2
	exit 2
fi

if [ ! -f "$pkg_dir/package.json" ]; then
	echo "check-pack-contents: BROKEN - no package.json in $pkg_dir" >&2
	exit 2
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Parsed as JSON rather than grepped, so a path that happens to appear elsewhere in the file
# cannot be mistaken for a declared entry point. Non-string entries are dropped here and
# caught by the emptiness guard below rather than being compared as "undefined".
declared_rc=0
node -e '
	const fs = require("fs");
	const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
	const n8n = pkg.n8n || {};
	const lists = [n8n.nodes, n8n.credentials];
	const out = [];
	for (const list of lists) {
		if (!Array.isArray(list)) continue;
		for (const p of list) if (typeof p === "string" && p.length > 0) out.push(p);
	}
	process.stdout.write(out.join("\n") + (out.length ? "\n" : ""));
' "$pkg_dir/package.json" > "$work/declared.txt" 2> "$work/declared.err" || declared_rc=$?

if [ "$declared_rc" -ne 0 ]; then
	echo "check-pack-contents: BROKEN - could not read package.json (node exit $declared_rc)" >&2
	cat "$work/declared.err" >&2
	exit 2
fi

declared_count="$(grep -c . "$work/declared.txt" || true)"

# The vacuity refusal, and it is the whole reason this script exists rather than a bare
# "did npm pack succeed" test. With nothing declared, every declared path is trivially
# present in any tarball, including an empty one, and the check reports OK forever. A gate
# that cannot fail is not a gate, and that is precisely the shape being fixed here, so this
# refuses to answer instead of passing.
if [ "$declared_count" -eq 0 ]; then
	cat >&2 <<MSG
check-pack-contents: BROKEN - package.json declares no n8n.nodes or n8n.credentials paths

This is reported as a broken check rather than a pass. With nothing declared, the
"every declared path is in the tarball" test is satisfied by any tarball at all,
including one carrying no code, which is the exact failure this check exists to catch.

Either the "n8n" block was removed or renamed, or this was pointed at the wrong package.
MSG
	exit 2
fi

# `npm pack --dry-run` writes no file. --json puts the manifest on stdout; the human summary
# npm normally prints goes to stderr and is kept for the failure message.
pack_rc=0
(cd "$pkg_dir" && npm pack --dry-run --json --ignore-scripts) > "$work/pack.json" 2> "$work/pack.err" || pack_rc=$?

if [ "$pack_rc" -ne 0 ]; then
	cat >&2 <<MSG
check-pack-contents: BROKEN - npm pack --dry-run failed (exit $pack_rc) in $pkg_dir

$(cat "$work/pack.err")
MSG
	exit 2
fi

# Two things are read out of npm's manifest: the entry paths, and entryCount. entryCount is
# npm's own count of the same set, so requiring it to equal the number of paths returned is
# an assertion a malformed or truncated manifest cannot satisfy. A check whose every arm
# asserts the same shape cannot tell a working probe from a broken one.
paths_rc=0
node -e '
	const fs = require("fs");
	const raw = fs.readFileSync(process.argv[1], "utf8");
	const parsed = JSON.parse(raw);
	const first = Array.isArray(parsed) ? parsed[0] : parsed;
	if (!first || !Array.isArray(first.files)) {
		process.stderr.write("npm pack --json returned no files array\n");
		process.exit(3);
	}
	const paths = first.files.map((f) => f && f.path).filter((p) => typeof p === "string");
	if (paths.length !== first.files.length) {
		process.stderr.write("npm pack --json returned an entry with no path string\n");
		process.exit(4);
	}
	const declaredCount = typeof first.entryCount === "number" ? first.entryCount : -1;
	if (declaredCount !== paths.length) {
		process.stderr.write(
			"npm pack --json says entryCount " + declaredCount + " but listed " + paths.length + " path(s)\n",
		);
		process.exit(5);
	}
	process.stdout.write(paths.join("\n") + (paths.length ? "\n" : ""));
' "$work/pack.json" > "$work/packed.txt" 2> "$work/packed.err" || paths_rc=$?

if [ "$paths_rc" -ne 0 ]; then
	cat >&2 <<MSG
check-pack-contents: BROKEN - could not read the file list npm pack produced (node exit $paths_rc)

$(cat "$work/packed.err")

This is reported as a broken check rather than a pass, because an unreadable manifest
proves nothing about what would ship.
MSG
	exit 2
fi

packed_count="$(grep -c . "$work/packed.txt" || true)"

# A tarball with no entries at all is a broken measurement rather than a mismatch: npm
# always includes package.json, so zero means the manifest was not what this expected.
if [ "$packed_count" -eq 0 ]; then
	echo "check-pack-contents: BROKEN - npm pack listed no files at all in $pkg_dir" >&2
	exit 2
fi

LC_ALL=C sort "$work/declared.txt" > "$work/declared.sorted"
LC_ALL=C sort "$work/packed.txt" > "$work/packed.sorted"
LC_ALL=C comm -23 "$work/declared.sorted" "$work/packed.sorted" > "$work/missing.txt"

missing_count="$(grep -c . "$work/missing.txt" || true)"

if [ "$missing_count" -eq 0 ]; then
	echo "check-pack-contents: OK - all $declared_count declared entry point(s) are in the $packed_count-file tarball"
	exit 0
fi

{
	echo "check-pack-contents: FAIL - the tarball npm would build is missing $missing_count of $declared_count declared entry point(s)"
	echo
	echo "  declared in package.json but NOT in the tarball:"
	sed 's|^|    |' "$work/missing.txt"
	echo
	echo "  what the tarball would actually contain ($packed_count file(s)):"
	sed 's|^|    |' "$work/packed.txt"
	cat <<'MSG'

`npm pack` does not fail on a missing build output. "files" names dist, dist is gitignored,
and packing a tree that was never built produces a tarball holding only the metadata npm
always includes, with exit code 0 (tallyfy/n8n#45).

The usual cause is that the build has not run in this tree:

  npm run build

If it has run, then tsc produced no output for these paths. Check that tsconfig.json's
include patterns still match where the sources live, which scripts/check-tsconfig-includes.sh
reports on directly, and that package.json's "n8n" block still names where tsc puts them.
MSG
} >&2
exit 1
