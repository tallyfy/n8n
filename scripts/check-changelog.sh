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
if awk -v want="## [$version]" 'index($0, want) == 1 { found = 1; exit } END { exit(found ? 0 : 1) }' "$changelog"; then
	echo "check-changelog: OK - $changelog has a heading for $version"
	exit 0
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
