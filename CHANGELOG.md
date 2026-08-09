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