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

## [1.1.3] - 2026-08-10

Prepared but **not yet published**. `package.json` declares 1.1.3 and npm `latest` is still 1.1.2;
the release happens when `v1.1.3` is tagged and pushed, which is a deliberate separate step.
Covers `c21d7e6..dd426b5`. Two user-facing fixes that were merged and sitting unpublished on
`main`, plus the gate that stops that recurring.

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
  (`5f8eaec`, #26 via PR #27)

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