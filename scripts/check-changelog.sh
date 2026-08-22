#!/usr/bin/env bash
#
# Fails when CHANGELOG.md has no heading for the version being released.
#
# Why this exists: 1.1.0, 1.1.1 and 1.1.2 all shipped to npm with no CHANGELOG
# entry, because the publish procedure was written down in two places and only
# one of them mentioned the CHANGELOG (tallyfy/n8n#18). Nothing enforced either,
# so the step only one document mentioned is the step that stopped happening.
#
# Used in two places, which is the point:
#   - .github/workflows/release.yml, so a v* tag cannot publish without an entry
#   - test/scripts/check-changelog.test.ts, so `npm test` goes red as soon as
#     package.json is bumped without one, long before anyone reaches for a tag
#
# Usage: scripts/check-changelog.sh <version> [changelog-path]
#        version may be given as "1.2.3" or "v1.2.3"

set -euo pipefail

version="${1:-}"
if [ -z "$version" ]; then
	echo "usage: $0 <version> [changelog-path]" >&2
	exit 2
fi
version="${version#v}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
changelog="${2:-$repo_root/CHANGELOG.md}"

if [ ! -f "$changelog" ]; then
	echo "check-changelog: no such file: $changelog" >&2
	exit 2
fi

# Match the Keep a Changelog heading form "## [1.2.3] - 2026-01-01" by exact
# prefix rather than by regex, so no version character needs escaping and the
# result is identical under BSD and GNU userland. index(...) == 1 anchors it to
# the start of the line, so a mention of the version in prose does not count -
# only a real heading does.
#
# The heading alone is NOT enough, and asserting only the heading is how this
# check could pass while the thing it exists to protect was broken. Until
# 2026-08-22 it stopped at the heading, so a bare "## [1.1.4]" with nothing
# underneath satisfied it and the release shipped with its notes still filed
# under the previous version (tallyfy/n8n#35). Measured both directions before
# the change: a correct heading with an empty body exited 0, and a missing
# heading exited 1, so the gate was alive and simply blind to the case that
# mattered. So this also walks the section and requires real content in it.
#
# "Content" is any non-blank line that is not itself a "###" sub-heading. A
# bullet is deliberately NOT required: the sections in this file mix prose with
# bullets, and a rule that demanded a leading "-" would reject a legitimately
# written release. Skipping "###" is what stops a heading followed by a bare
# "### Fixed" from counting, since a label with nothing under it is the same
# empty section wearing a hat.
#
# awk exit codes here are 0 ok, 1 heading present but empty, 3 no heading. 3
# rather than 2 on purpose: awk uses 2 for its own errors, so overloading it
# would make a broken invocation indistinguishable from a clean "no heading"
# verdict. Anything else is treated as the script itself failing and exits 2,
# which is the code this script already reserves for "called wrongly".
awk_rc=0
awk -v want="## [$version]" '
	index($0, want) == 1 { found = 1; next }
	!found { next }
	index($0, "## ") == 1 { exit }
	index($0, "#") == 1 { next }
	/[^[:space:]]/ { body = 1; exit }
	END { exit(found ? (body ? 0 : 1) : 3) }
' "$changelog" || awk_rc=$?

if [ "$awk_rc" -eq 0 ]; then
	echo "check-changelog: OK - $changelog has a heading for $version, with entries under it"
	exit 0
fi

if [ "$awk_rc" -eq 1 ]; then
	cat >&2 <<MSG
check-changelog: FAIL - $changelog has a heading for $version but nothing under it

An empty section is not a release note. Move the entries for this release under
its own heading, in the form used by the rest of the file:

  ## [$version] - $(date -u +%Y-%m-%d)

  ### Fixed
  - ...

Between releases this repo accumulates entries under "## [Unreleased]". Cutting
a release means renaming that heading to this version and opening a fresh empty
"## [Unreleased]" above it - not adding a second, empty heading and leaving the
entries where they were (tallyfy/n8n#35).
MSG
	exit 1
fi

if [ "$awk_rc" -ne 3 ]; then
	echo "check-changelog: BROKEN - the section scan failed on $changelog (awk exit $awk_rc)" >&2
	exit 2
fi

cat >&2 <<MSG
check-changelog: FAIL - $changelog has no heading for $version

Add one before releasing, in the form used by the rest of the file:

  ## [$version] - $(date -u +%Y-%m-%d)

  ### Fixed
  - ...

Releasing without it is how 1.1.0, 1.1.1 and 1.1.2 ended up unrecorded.
MSG
exit 1
