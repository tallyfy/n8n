# Changelog

All notable changes to the n8n-nodes-tallyfy project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Every release needs a heading here before it can be published.
`.github/workflows/release.yml` runs `scripts/check-changelog.sh` and fails the run when the
pushed tag has no matching heading, and `npm test` fails the same way as soon as `package.json`
is bumped without one.

## Release history note: 1.1.0 and 1.1.1

Both were published to npm by hand during the period when CI could not publish, and neither is
recorded below. They are left unrecorded on purpose: 1.1.2 supersedes both in behaviour, is npm
`latest`, and is the version the droplet installs, so reconstructing them buys nothing.

- **1.1.1**, npm 2026-07-26, **has no git tag at all**. It was published from an untagged tree at
  commit `ae00eae`, and covered `bfd4241..ae00eae` (the `v1.1.0` tag through the version bump).
  Its substance was one commit, `85f7d3a`: kick-off / prerun choice-field encoding on
  `process:launch` (#6), the forward-compatible `issue` process-status enum (#1), and the live-API
  jest layer.
- **1.1.0**, npm 2026-07-23, is tagged `v1.1.0` (`bfd4241`), but that tag's `Release` run failed
  and the version was hand-published the next day.

No `v1.1.1` tag will be created. Pushing a `v*` tag is this repo's publish trigger, so tagging a
historical commit would fire the release workflow against an old tree, and even a failed run signs
a permanent public provenance statement into the sigstore transparency log.

## Changelog discipline: where work in progress goes

**Between releases, entries go under `## [Unreleased]` below, never under the last released
version's heading.** Cutting a release means renaming that heading to `## [X.Y.Z] - YYYY-MM-DD`
and opening a fresh, empty `## [Unreleased]` above it. Nothing has to be hunted down and moved,
so nothing can be left behind.

This is what the preamble above has always claimed - Keep a Changelog prescribes `[Unreleased]` -
but the file did not actually have one until 2026-08-22, and `main` accumulated under the last
released heading instead. That put the `#30` fix under `## [1.1.3]`, a version tagged and
published a day before the fix landed (tallyfy/n8n#35). Both conventions were half-adopted at
once, which is the part that made it wrong rather than either convention on its own.

`## [Unreleased]` is invisible to the release gate by construction: `scripts/check-changelog.sh`
is only ever asked about a semantic version, from a `v*` tag or from `package.json`, and
"Unreleased" is never either. So it cannot accidentally satisfy a release that has not written
its own notes, and an empty `[Unreleased]` never blocks one. Both are covered by
`test/scripts/check-changelog.test.ts`.

## [Unreleased]

Not published. `package.json` still declares `1.1.3`, which is already tagged and on npm, so
everything here is ahead of the last release. `git log v1.1.3..origin/main` is the check that
says what that is; a `package.json` versus `npm view` comparison reads as "they agree, nothing
to publish" and is wrong for exactly this state.

The next release needs its own new heading (**1.1.4** - `1.1.3` cannot be reused, the tag
exists) and its own tag. Nobody has decided to cut it yet.

### Fixed
- A kick-off choice **option ID** carrying surrounding whitespace now resolves the same way on
  all three field types, matching how the text passes already behaved. `" 2 "` against an option
  `{id: 2, ...}` used to throw on `dropdown` (`no dropdown option matches " 2 "`), resolve on
  `multi-select` (its input is trimmed before either pass runs), and pass straight through
  unresolved on `radio` (a value api-v2 then rejects) - one caller, one padded id, three different
  answers depending on the field type. `resolveChoiceOption` now trims the id arm itself, once,
  so every caller gets the same answer regardless of whether it happened to trim before calling
  in. `radio`'s existing behaviour on a genuinely unmatched value, raw passthrough and no throw,
  is unchanged. This one **does** affect users today: the realistic trigger is a caller building a
  kick-off value by string concatenation and leaving a space in. (`d23d0ea`, #30 via PR #33)

  Filed under `## [1.1.3]` when it landed, which was wrong - `d23d0ea` is not an ancestor of the
  `v1.1.3` tag (control on the same invocation: `8169358`, PR #29, is). Moved here 2026-08-22.

### Changed
- The release gate now checks that a version's CHANGELOG section has entries under it, not only
  that its heading exists. `scripts/check-changelog.sh` stopped at the heading, so a bare
  `## [1.1.4]` with nothing beneath it passed, and the release would have shipped with its notes
  still filed under the previous version. Measured in both directions before the fix: an empty
  section under a correct heading exited 0, and a missing heading exited 1, so the gate was alive
  and blind only to the case that mattered. (#35)

## [1.1.3] - 2026-08-10

✅ **PUBLISHED 2026-08-21** (tag `v1.1.3` at `e1094fea`, by the owner directly, `#21` closed the
same day). This section said "Prepared but **not yet published**... npm `latest` is still 1.1.2"
until 2026-08-22, and that was already a day stale when a session next read it - `npm view
n8n-nodes-tallyfy version` and the registry `dist-tags.latest` both read `1.1.3`. The heading date
above is left as **2026-08-10**, when the version was first declared on `main` (#24/PR #25), on
purpose, rather than silently rewritten to the real release date - see the entries this section
already has below for why a number gets corrected in place with a note rather than overwritten.
Covers `c21d7e6..e1094fea`, which is every entry below (the `c21d7e6..8169358` this line used to
give stopped two docs-only commits short of what the tag actually points at).

⚠️ **This section is CLOSED. Nothing may be added to it.** Everything here shipped in the
`v1.1.3` tag; work that has not shipped goes under `## [Unreleased]` above, per the discipline
entry there. From 2026-08-21 to 2026-08-22 `main` did accumulate under this heading, which is how
the `#30` fix ended up filed against a release that does not contain it (tallyfy/n8n#35), and the
paragraph here used to describe that as the convention and point at a "CHANGELOG-discipline entry
below" that did not exist - grepping the file for it returned only the reference itself. The
convention is now written down, above, and this heading is no longer where work in progress goes.

Do not restate the number of fixes here. It has now decayed twice: this paragraph said "two" while
three were listed, was corrected to three in `d68dfe5`, and was wrong again within two days when
PR #29 landed. Read the list.

### Fixed
- A seat-limit refusal now explains itself. When api-v2 answers `409 SEAT_POOL_EXHAUSTED`, the node
  surfaces a sentence naming the pool that is actually full and what an admin can do about it,
  instead of a bare "409 - Conflict". (`d2224ba`, #12 via PR #13)

  The wording is byte-identical to the Zapier and Workato connectors, so one customer reaching
  Tallyfy through two tools does not get two descriptions of the same billing state. Re-verified
  2026-08-10 by executing `tallyfy/middleware`'s `seatPoolExhaustedMessage` and substituting into
  the template literal read straight out of `Tallyfy.node.ts`, across four payload shapes (both
  fields present, `pool_type` missing, `message` missing, both missing): all four SHA-256 identical,
  with a negative control confirming the comparison could report a difference.

  ⚠️ **Not reachable in production yet.** api-v2 does not emit this shape until
  `allocated_seats_model_active` is flipped (tallyfy/api-v2#9143, still open), so this message
  cannot fire for a customer today. It ships now so it is in place when that lands.
- Kick-off `radio` values now match a template option when they differ only by letter case or
  surrounding whitespace, and the option's canonical text is sent. Dropdown and multi-select have
  behaved this way since 1.1.2; radio was still comparing literally, so a case-different radio
  value was rejected here while the CLI, MCP and Celigo accepted it. This one **does** affect users
  today. (`dd426b5`, #22 via PR #23)
- Kick-off `dropdown` and `multi-select` values now also accept an option's **ID**, not only its
  text, as `radio` already did. Passing `2` where the template's option is named "Gold" used to
  resolve for radio and throw for dropdown, so the same id gave two different answers depending on
  the field type. The option's own canonical value is still what gets sent, and a value matching
  neither an option text nor an id still throws. This one **does** affect users today.
  (`dd976e8`, #26 via PR #27)

  ⚠️ This cited `5f8eaec` until 2026-08-22, which is the PR's own branch commit and is **not on
  `main` at all** (`git branch -r --contains 5f8eaec` returns only `origin/fix/178-option-id-parity`).
  The repo squash-merges, so the SHA that landed is `dd976e8` and it IS in the tag. Noticed while
  running `--is-ancestor` over every commit this section cites for tallyfy/n8n#35: a branch SHA
  answers "not in the release" for the same reason a genuinely unreleased commit does, so the
  probe cannot tell them apart on its own and the fix here was real while this one was a
  mis-citation. Cite the landed commit, not the branch commit.
- A kick-off choice whose value matches one option's **text** and a different option's **ID** now
  resolves to the text match, every time, rather than to whichever of the two the template happened
  to list first. `encodeKickoffValue` ran its exact-text arm and its option-ID arm inside a single
  `find`, so both arms were evaluated against option A before option B was considered at all. With
  options `[{id: 9, text: "Gold"}, {id: 1, text: "9"}]` and the value `"9"`, the node sent Gold.

  This one **does** affect users today, and it is the worst failure mode in this release, because
  nothing reports it: api-v2 cross-checks id against text, both candidate pairs are internally
  consistent, so it accepts either encoding and the caller silently gets the wrong option. All three
  choice branches now run a complete exact-text pass, then a complete case-insensitive trimmed pass,
  then the ID pass, through one shared `resolveChoiceOption`. Verified by running the old and new
  encoders side by side over 33 unambiguous cases for byte-identical output, with a control over the
  colliding set where the two must and do disagree, so the agreement is not vacuous. Wire encodings
  are untouched. (`8169358`, PR #29)

### Changed
- The release workflow fails when the tag being pushed has no matching CHANGELOG heading, and
  `npm test` fails the same way as soon as `package.json` is bumped without one. 1.1.0, 1.1.1 and
  1.1.2 all shipped unrecorded because the step appeared in only one of the two publishing
  procedures, and nothing enforced either. (`aa343a8`, #19 via PR #20)
- The `formField:updateValue` live tripwire now says what its red run means, so a deliberate signal
  is not mistaken for a regression. (`a26e3b2`)

## [1.1.2] - 2026-08-08

First release published by CI, via npm trusted publishing (OIDC) with SLSA provenance. Covers
`ae00eae..c21d7e6`.

### Fixed
- Kick-off (prerun) dropdown and multi-select values now match a template option when they differ
  only by letter case or surrounding whitespace, and the option's own canonical text is sent rather
  than the raw input. A value matching no option still throws and lists the valid choices, so
  nothing is dropped silently. Brings the node to parity with Zapier, Workato, Celigo, the Tallyfy
  CLI and the MCP server. (`47c0225`, middleware #178)

### Changed
- The Form Field ID help text and the `formField:updateValue` handler now document the
  CaptureValue ID precondition on run-level fields, and a live tripwire pins the current api-v2
  behaviour so the node side is not blamed for a server-side gap. The run-level fix itself belongs
  in api-v2 and is still open. (`6d8dfcd`, #9)
- The release workflow gates the publish on the test suite. (`27c1d6f`, #4)
- Publishing moved from a long-lived `NPM_TOKEN` to npm trusted publishing (OIDC). The workflow
  now holds no publish credential and the repo has no secrets. (`2f5d678`, #15 via PR #16)
- Added `.github/CODEOWNERS`. (`aa22467`, #11)

## [1.0.0] - 2025-08-02

### Added
- Initial release of the Tallyfy node for n8n
- Support for Blueprint (Process Template) operations:
  - Get, Get Many, Create, Update, Delete
- Support for Process (Run) operations:
  - Launch, Get, Get Many, Update, Delete
- Support for Task operations:
  - Complete, Get, Get Many, Create, Update
- Support for Comment operations:
  - Create, Update, Delete
- Support for User operations:
  - Get Current, Get, Get Many, Invite
- Support for Guest operations:
  - Create, Get, Get Many, Update, Delete
- Authentication via Personal Access Token
- Automatic inclusion of required X-Tallyfy-Client header
- Comprehensive error handling
- Pagination support for list operations
- Filtering and sorting capabilities
- Full TypeScript implementation
- MIT License