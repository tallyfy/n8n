#!/usr/bin/env bash
#
# Fails when package.json and package-lock.json disagree about this package's own version.
#
# A lock file records the root version twice, at the top level and again under
# packages[""]. Both must equal package.json's "version".
#
# Why this exists: main carried version 1.1.3 in package.json and 1.1.1 in both of the
# lock file's root fields, because the lock was never regenerated when the version was
# bumped through 1.1.2 and 1.1.3 (tallyfy/n8n#39). Nothing noticed for two releases.
#
# What this drift does and does not do, measured before this gate was written, so nobody
# has to guess at how urgent a red run here is:
#   - It does NOT fail `npm ci`. npm ci's sync check compares DEPENDENCIES only. Run
#     against the drifted pair it exited 0 and installed 797 packages. The control on the
#     same command, package.json asking for jest ^28.0.0 against a lock pinning 29.7.0,
#     exited 1 with EUSAGE "can only install packages when your package.json and
#     package-lock.json ... are in sync". So the two separate, and the root version field
#     is outside what npm validates.
#   - It DOES mean the lock file published inside the npm tarball states a version the
#     package is not, and that `npm ci` and a fresh `npm install` describe the tree
#     differently. That is a correctness and provenance problem rather than a build
#     breaker.
#
# Used in two places, which is the point:
#   - .github/workflows/version-sync.yml, so a push or pull request goes red on the
#     commit that introduces the drift
#   - .github/workflows/release.yml, so a v* tag cannot publish an unsynced lock file
# and its behaviour is proven offline by test/scripts/check-version-sync.test.ts.
#
# Usage: scripts/check-version-sync.sh [package.json-path] [package-lock.json-path]
#
# Exit codes follow scripts/check-changelog.sh: 0 the versions agree, 1 they disagree,
# 2 the check itself could not run. 2 is reserved deliberately, so a broken invocation
# can never be mistaken for a clean verdict in either direction.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pkg="${1:-$repo_root/package.json}"
lock="${2:-$repo_root/package-lock.json}"

for f in "$pkg" "$lock"; do
	if [ ! -f "$f" ]; then
		echo "check-version-sync: no such file: $f" >&2
		exit 2
	fi
done

# Parsed as JSON rather than grepped, so a version that happens to appear in a
# dependency's entry cannot be mistaken for the root one. A field that is absent, or
# present but not a string, prints as an empty line and is caught by the emptiness guard
# below rather than being compared.
read_rc=0
values="$(node -e '
	const fs = require("fs");
	const read = p => JSON.parse(fs.readFileSync(p, "utf8"));
	const pkg = read(process.argv[1]);
	const lock = read(process.argv[2]);
	const str = v => (typeof v === "string" ? v : "");
	const root = (lock && lock.packages && lock.packages[""]) || {};
	process.stdout.write([str(pkg.version), str(lock.version), str(root.version)].join("\n") + "\n");
' "$pkg" "$lock" 2>&1)" || read_rc=$?

if [ "$read_rc" -ne 0 ]; then
	echo "check-version-sync: BROKEN - could not read the version fields (node exit $read_rc)" >&2
	echo "$values" >&2
	exit 2
fi

pkg_version="$(printf '%s\n' "$values" | sed -n 1p)"
lock_version="$(printf '%s\n' "$values" | sed -n 2p)"
lock_root_version="$(printf '%s\n' "$values" | sed -n 3p)"

# The emptiness guard, and it is load-bearing rather than defensive. Without it a rename
# of any of these fields, or a lock file written by some future tool that omits them,
# makes all three read as the empty string, and "" = "" = "" satisfies the comparison
# below. The gate would then report OK forever, which is the one failure mode a gate must
# not have. Proven to fire by test/scripts/check-version-sync.test.ts.
missing=""
if [ -z "$pkg_version" ]; then
	missing="${missing}  - $pkg is missing a string \"version\"
"
fi
if [ -z "$lock_version" ]; then
	missing="${missing}  - $lock is missing a string \"version\"
"
fi
if [ -z "$lock_root_version" ]; then
	missing="${missing}  - $lock is missing a string packages[\"\"].version
"
fi

if [ -n "$missing" ]; then
	cat >&2 <<MSG
check-version-sync: BROKEN - a version field this check compares is absent or not a string

$missing
This is reported as a broken check rather than a pass. All three fields reading empty
would otherwise compare equal to each other and the check would report OK.
MSG
	exit 2
fi

if [ "$pkg_version" = "$lock_version" ] && [ "$pkg_version" = "$lock_root_version" ]; then
	echo "check-version-sync: OK - package.json and package-lock.json both say $pkg_version"
	exit 0
fi

cat >&2 <<MSG
check-version-sync: FAIL - package.json and package-lock.json disagree about the version

  package.json                        version = $pkg_version
  package-lock.json                   version = $lock_version
  package-lock.json  packages[""].version = $lock_root_version

Regenerate the lock file rather than editing the version strings by hand, so any other
drift is corrected in the same pass:

  npm install --package-lock-only

Then read the diff. If it changes anything beyond these two version fields, that is a
dependency change and belongs in its own commit with its own reasoning.
MSG
exit 1
