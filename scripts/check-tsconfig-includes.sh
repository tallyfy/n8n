#!/usr/bin/env bash
#
# Fails when a tsconfig "include" pattern matches no files at all.
#
# Why this exists: `tsc` raises TS18003 "No inputs were found in config file" only when
# EVERY include pattern matches nothing. One dead pattern among several is completely
# silent, and the compile exits 0.
#
# Measured 2026-08-30 with a three-arm fixture, all three arms on the same invocation:
#
#   two real includes plus one bogus one   ->  rc 0, no output
#   a single bogus include, the control    ->  rc 2, error TS18003
#   a single real include, the control     ->  rc 0, no output
#
# So the middle arm proves tsc CAN complain, and the first proves it does not when a
# sibling pattern keeps the input set non-empty. Neither control alone separates the two.
#
# The live instance in this repository, measured the same day: `tsconfig.json` carried
# `nodes/**/*.json`, which matched 0 files (`find nodes -name '*.json' -type f` returned 0,
# against a positive control of `nodes/**/*.ts` returning 2 and `credentials/**/*.ts`
# returning 1 through the same probe). That one was harmless, since `resolveJsonModule`
# pulls an imported .json into the program without it being in `include`. It was removed in
# the same change that added this script, so this check is green on a correct tree rather
# than red from the day it landed.
#
# The instance that WOULD have a consequence is a rename or a move of `nodes/`:
# `nodes/**/*.ts` would silently match nothing, `credentials/**/*.ts` would keep the input
# set non-empty so TS18003 never fires, and `tsc` would emit no node at all while exiting 0.
# `package.json`'s `n8n.nodes` would then point at two files that do not exist, and the
# build would report success. That is the same shape as tallyfy/n8n#43, where
# `gulp build:icons` copied zero icons and exited 0 (tallyfy/n8n#45).
#
# scripts/check-icons.sh covers part of that by accident: it exits 2 when `nodes/` is
# absent. It does not cover a `nodes/` that still exists and holds no `.ts`, and when it
# does fire it names the icons rather than the missing sources.
#
# How the patterns are resolved. TypeScript's own resolver is asked, never a reimplemented
# glob: `ts.getParsedCommandLineOfConfigFile` reads the config (jsonc comments and all) and
# resolves `extends`, then each include pattern is put through
# `ts.parseJsonConfigFileContent` on its own, carrying the config's effective `exclude`, and
# the resulting `fileNames` are counted. A pattern whose every match is excluded therefore
# counts as 0, which is correct: it contributes nothing to the compile.
#
# Which configs are checked. Every `tsconfig*.json` in the repository root, DISCOVERED
# rather than listed, so a config added later is covered without editing this script. A
# guard holding a literal list silently stops covering everything the day someone adds the
# next item and nothing goes red to say so. The discovery is paired with a count assertion
# below, because a sweep that discovers nothing passes every assertion made about it.
#
# Used in three places, which is the point:
#   - package.json "build", so `npm run build` itself fails, including the `prepublishOnly`
#     build and any build a person runs by hand. It runs BEFORE tsc there, so a config that
#     describes a partly-empty input set fails in a second rather than after a full compile
#   - .github/workflows/ci.yml, so a pull request goes red on the commit that breaks it
#   - .github/workflows/release.yml, as the backstop on the one path that is irreversible,
#     the same argument that file already makes for check-changelog.sh, check-version-sync.sh
#     and check-icons.sh
# and its behaviour is proven offline by test/scripts/check-tsconfig-includes.test.ts.
#
# Usage: scripts/check-tsconfig-includes.sh [tsconfig-path ...]
#        default: every tsconfig*.json in the repository root
#
# Exit codes follow scripts/check-changelog.sh, scripts/check-version-sync.sh and
# scripts/check-icons.sh: 0 every pattern matches at least one file, 1 at least one matches
# nothing, 2 the check itself could not answer. 2 is reserved deliberately, so a check that
# could not run is never mistaken for a clean verdict in either direction.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Written to a file rather than held in a shell array, because /bin/bash on macOS is 3.2 and
# expanding an empty array there under `set -u` aborts with "unbound variable" before the
# emptiness can be reported. A file also keeps the count and the list in one place.
if [ "$#" -gt 0 ]; then
	printf '%s\n' "$@" > "$work/configs.txt"
else
	find "$repo_root" -maxdepth 1 -type f -name 'tsconfig*.json' -print \
		| LC_ALL=C sort > "$work/configs.txt"
fi

config_count="$(grep -c . "$work/configs.txt" || true)"

# The first vacuity refusal. With no configs discovered there is nothing to check, and a
# loop over an empty set satisfies every assertion made about it. A gate over an empty set
# is indistinguishable from a passing gate, so this refuses to answer instead of passing.
if [ "$config_count" -eq 0 ]; then
	cat >&2 <<MSG
check-tsconfig-includes: BROKEN - found no tsconfig*.json in $repo_root

This is reported as a broken check rather than a pass. A loop over zero configs would
otherwise complete without finding anything wrong and report OK.

Either the configs were renamed or moved, or this was pointed at the wrong directory.
MSG
	exit 2
fi

# Made absolute here, before anything changes directory. The node call below runs from the
# repository root so that `require("typescript")` resolves against this package's own
# node_modules whatever directory the caller happened to be standing in, and a relative
# argument resolved after that cd would silently name a different file.
: > "$work/configs.abs.txt"
while IFS= read -r cfg; do
	case "$cfg" in
		/*) printf '%s\n' "$cfg" >> "$work/configs.abs.txt" ;;
		*) printf '%s\n' "$PWD/$cfg" >> "$work/configs.abs.txt" ;;
	esac
done < "$work/configs.txt"

# Rebuilt as positional parameters rather than interpolated with $(cat), so a path
# containing a space is one argument rather than two. The original "$@" was written to a
# file above and is not needed again.
set --
while IFS= read -r cfg; do
	if [ ! -f "$cfg" ]; then
		echo "check-tsconfig-includes: BROKEN - no such config file: $cfg" >&2
		exit 2
	fi
	set -- "$@" "$cfg"
done < "$work/configs.abs.txt"

# TypeScript's own resolver answers, so this agrees with the compiler by construction rather
# than by a glob implementation that has to be kept in step with it. One TSV line per
# include pattern: PATTERN <config> <pattern> <count>. A config carrying no `include` at all
# is legitimate (it may use `files`), so it is reported as NOINCLUDE and counted separately
# rather than failed.
node_rc=0
cd "$repo_root"
node -e '
	const ts = require("typescript");
	const path = require("path");
	const out = [];
	for (const raw of process.argv.slice(1)) {
		const configPath = path.resolve(raw);
		const base = path.dirname(configPath);
		let fatal = null;
		const host = Object.assign({}, ts.sys, {
			onUnRecoverableConfigFileDiagnostic: (d) => {
				fatal = ts.flattenDiagnosticMessageText(d.messageText, " ");
			},
		});
		const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, host);
		if (fatal !== null || !parsed) {
			process.stderr.write("cannot parse " + configPath + ": " + (fatal || "unknown") + "\n");
			process.exit(3);
		}
		const include = parsed.raw && parsed.raw.include;
		const exclude = (parsed.raw && parsed.raw.exclude) || undefined;
		if (!Array.isArray(include) || include.length === 0) {
			out.push(["NOINCLUDE", raw, "-", "-"].join("\t"));
			continue;
		}
		for (const pattern of include) {
			const one = ts.parseJsonConfigFileContent(
				{ compilerOptions: {}, include: [pattern], exclude },
				ts.sys,
				base,
			);
			out.push(["PATTERN", raw, String(pattern), String(one.fileNames.length)].join("\t"));
		}
	}
	process.stdout.write(out.join("\n") + "\n");
' "$@" > "$work/patterns.tsv" 2> "$work/node.err" || node_rc=$?

if [ "$node_rc" -ne 0 ]; then
	cat >&2 <<MSG
check-tsconfig-includes: BROKEN - could not resolve the include patterns (node exit $node_rc)

$(cat "$work/node.err")

This check asks the TypeScript compiler's own resolver, so it needs the local install.
If the message above is about a missing "typescript" module, the dependencies are not
installed:

  npm ci
MSG
	exit 2
fi

pattern_count="$(grep -c '^PATTERN	' "$work/patterns.tsv" || true)"

# The second vacuity refusal, and it is the one that matters. Every config could parse fine
# and declare no `include` at all, in which case the comparison below runs over zero
# patterns, finds no empty one, and reports OK while proving nothing.
if [ "$pattern_count" -eq 0 ]; then
	cat >&2 <<MSG
check-tsconfig-includes: BROKEN - $config_count config(s) declare no "include" pattern at all

$(sed 's/^/  /' "$work/patterns.tsv")

This is reported as a broken check rather than a pass. Zero patterns cannot contain an
empty one, so the comparison would succeed while examining nothing.
MSG
	exit 2
fi

awk -F'\t' '$1 == "PATTERN" && $4 == "0"' "$work/patterns.tsv" > "$work/empty.tsv"
empty_count="$(grep -c . "$work/empty.tsv" || true)"

if [ "$empty_count" -eq 0 ]; then
	echo "check-tsconfig-includes: OK - all $pattern_count include pattern(s) across $config_count config(s) match at least one file"
	exit 0
fi

{
	echo "check-tsconfig-includes: FAIL - $empty_count include pattern(s) match no files"
	echo
	awk -F'\t' -v root="$repo_root/" '$1 == "PATTERN" && $4 == "0" {
		c = $2; sub("^" root, "", c); printf "  %s: include %s matches 0 files\n", c, $3
	}' "$work/patterns.tsv"
	echo
	echo "  for context, every pattern and its match count:"
	awk -F'\t' -v root="$repo_root/" '$1 == "PATTERN" {
		c = $2; sub("^" root, "", c); printf "    %-20s %-24s %s\n", c, $3, $4
	}' "$work/patterns.tsv"
	cat <<'MSG'

tsc raises TS18003 only when EVERY include matches nothing, so one dead pattern among
several compiles silently and exits 0 (tallyfy/n8n#45). That is fine when the pattern is
merely redundant and serious when it is the one naming the sources: the other patterns keep
the input set non-empty, tsc emits nothing for the dead one, and the build reports success
on output that is not there.

Either the files moved, in which case fix the pattern, or the pattern is genuinely
redundant, in which case delete it. Do not leave it in place: a pattern that matches
nothing today is a pattern that cannot tell you when it stops matching something.
MSG
} >&2
exit 1
