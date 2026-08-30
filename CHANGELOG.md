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

- `package-lock.json` now states the version this package actually is. Its two root version
  fields both read `1.1.1` while `package.json` read `1.1.3`, because the lock was never
  regenerated when the version was bumped through 1.1.2 and 1.1.3. Fixed by regenerating with
  `npm install --package-lock-only`, which changed exactly those two lines and nothing else: 798
  package entries before and after, and the two documents are identical once only those two
  fields are normalised, checked against a control that reports a difference when one nested
  dependency version is perturbed. No dependency was bumped. (#39)

  Nothing was broken by this and no release failed because of it. `npm ci` does not look at the
  root version field: run against the drifted pair it exited 0 and installed 797 packages, while
  the control on the same command, `package.json` asking for jest `^28.0.0` against a lock
  pinning `29.7.0`, exited 1 with `EUSAGE` and named the sync requirement. What it did mean is
  that the lock file inside the published 1.1.2 and 1.1.3 tarballs stated a version those
  packages were not.

- A new gate, `scripts/check-version-sync.sh`, fails when `package.json` and either of
  `package-lock.json`'s root version fields disagree. It runs on every push and pull request via
  the new `.github/workflows/version-sync.yml`, and again in `release.yml` before `npm ci` as the
  backstop on the one path that publishes. Shown in both directions on the same run: the real
  pre-fix pair read off `origin/main` exits 1, the fixed pair exits 0, and reintroducing the drift
  fails exactly one test in `test/scripts/check-version-sync.test.ts`, the regression lock, with
  the other 13 still green. It refuses to answer, exit 2, rather than passing when a version field
  is absent or not a string, because all three reading empty would otherwise compare equal and the
  gate would report OK forever. (#39)

  This is also the repo's first workflow that runs on anything other than a `v*` tag. Until now
  `release.yml` was the only workflow, so a pull request produced no checks at all and every gate
  the repo had fired for the first time during the publish itself. Lint, typecheck, the full test
  suite and the build followed shortly after in `.github/workflows/ci.yml` (`1b9fff2`, PR #42),
  which this sentence said was "still not wired up" until 2026-08-29.

- `npm run build` now fails when the icon copy produces nothing. It is
  `tsc && gulp build:icons && scripts/check-icons.sh`, and it was the first two of those only.
  `gulp build:icons` is `src('nodes/**/*.svg').pipe(dest('dist/nodes'))`; a glob with magic
  characters does not error when it matches nothing, so gulp copied zero files and exited 0, and
  the build exited 0 with it. A `v*` tag push is an irreversible public npm publish and it runs
  that build, so the release path could ship a package whose node has no icon and report success.
  The build passing told you the build ran, not that it produced anything. (#43)

  Shown in both directions on the same run, from a clean `dist` each time. With the glob pointed
  at `nodes/**/*.svg.notreal`, `npm run build` exits **1** and names the icon that was not copied,
  where before this change the identical tree exited **0** with zero svg under `dist/nodes`. With
  the glob untouched it exits **0** and copies 1 of 1. Restoring the glob returns it to 0, which
  is the control that separates a working gate from one that refuses everything.

  The assertion is on the output, not on gulp's exit code, because the exit code is the thing that
  was wrong. `scripts/check-icons.sh` compares the set of `*.svg` relative paths under `dist/nodes`
  against the set under `nodes`, so it also catches a stale output tree holding the same number of
  differently named files, which a bare count would pass. It refuses to answer, exit 2, rather than
  passing when there are no source icons, because zero output files equal zero source files and an
  unguarded comparison would report OK forever. Exit codes match the sibling gates: 0 agree,
  1 disagree, 2 could not answer.

  It runs in three places: `package.json`'s `build`, so every build including `prepublishOnly` and
  any build run by hand is covered; `.github/workflows/ci.yml`, which now calls the script instead
  of the inline block it carried, so the two cannot drift; and `.github/workflows/release.yml`
  immediately after its `Build` step, as the backstop on the one path that is irreversible, since a
  tag can be cut from a commit that never ran CI. Its behaviour is proven offline by
  `test/scripts/check-icons.test.ts` (14 tests), because a step in `release.yml` can only be
  exercised by pushing a tag and that publishes.

  Two other places in the build have the same shape, both measured on 2026-08-29 rather than
  assumed. Neither was fixed here; **both were fixed shortly afterwards under #45**, see the entry
  below. They are left described as they stood, because the point is that a glob which silently
  matches nothing is rarely alone:

  - **`tsconfig.json`'s `include` list.** `tsc` raises TS18003 only when **every** include matches
    nothing (measured: rc 2). One include matching nothing among several is silent (measured:
    rc 0). `nodes/**/*.json` matches zero files today, so that is a live instance with no
    consequence, and a rename of `nodes/` would silently compile `credentials/` alone.
  - **`npm pack` with `files: ["dist"]`.** With no `dist` directory at all, `npm pack --dry-run`
    exits **0** and builds a four file tarball carrying no code, against fourteen files when `dist`
    is present. On the release path this is now closed as a side effect, since `check-icons.sh`
    exits 2 when the output directory is absent, but `npm pack` run by hand is still not guarded.

  Two that are **not** the same shape, checked on the same sweep so the list is not one sided:
  `jest` exits 1 with "No tests found" when its pattern matches nothing (`passWithNoTests` is not
  set), and `eslint` exits 2 with "No files matching the pattern" on a directory holding nothing
  lintable. Both fail closed.

- The two remaining places the #43 entry above left open are now closed, with a gate each, and
  `tsconfig.json` no longer carries a pattern that matches nothing. (#45)

  **A tsconfig `include` matching nothing.** `tsc` raises TS18003 "No inputs were found" only when
  **every** include pattern matches nothing. One dead pattern among several is silent and the
  compile exits 0. Re-derived 2026-08-30 with all three arms on one invocation, rather than
  carried over from the #43 measurement: two real includes plus one bogus one gave **rc 0** and no
  output, a single bogus include gave **rc 2** and TS18003, and a single real include gave rc 0.
  The middle arm is what proves `tsc` can complain at all, and neither control alone separates the
  two cases. `tsconfig.json`'s `nodes/**/*.json` was the live instance, matching 0 files
  (`find nodes -name '*.json' -type f` returned 0, against a positive control of `nodes/**/*.ts`
  returning 2 through the same probe). It is removed, which changes nothing that is compiled:
  `tsc --listFilesOnly` reports the same 3 files before and after, and `resolveJsonModule` pulls an
  imported `.json` into the program without it being in `include`.

  The consequence that gate protects against is a rename or move of `nodes/`: `nodes/**/*.ts`
  would match nothing, `credentials/**/*.ts` would keep the input set non-empty so TS18003 never
  fires, and `tsc` would emit no node at all while exiting 0, leaving `package.json`'s `n8n.nodes`
  naming two files that do not exist.

  `scripts/check-tsconfig-includes.sh` asks TypeScript's own resolver rather than reimplementing
  its glob rules: `ts.getParsedCommandLineOfConfigFile` reads each config, jsonc comments and
  `extends` included, then each include pattern is put through `ts.parseJsonConfigFileContent` on
  its own carrying the config's effective `exclude`, and the resulting `fileNames` are counted. So
  a pattern whose every match is excluded counts as zero, which is correct. It **discovers** every
  `tsconfig*.json` in the repository root rather than holding a literal list, so a config added
  later is covered without editing it.

  **`npm pack` with no `dist`.** `scripts/check-pack-contents.sh` asserts the tarball **contents**,
  never `npm pack`'s exit code, because the exit code is the thing that is wrong. It requires every
  path under `package.json`'s `n8n.nodes` and `n8n.credentials` to appear in the manifest
  `npm pack --dry-run --json` produces, named rather than counted. "The tarball holds a `.js`"
  would not do: `index.js` is at the package root and npm always includes the file named by `main`,
  so that assertion passes on the four-entry tarball an unbuilt tree produces.

  Both gates were shown in **both directions on the same run**. `check-tsconfig-includes.sh` exits
  **1** on the tree carrying `nodes/**/*.json` and names it, and **0** once it is removed;
  reintroducing the pattern by hand into a copy of the tree returns it to 1. `check-pack-contents.sh`
  exits **0** on the built tree, reporting all 3 declared entry points present in a 14 file tarball,
  and **1** on the same tree with `dist` removed, naming all three missing paths against a listing of
  the 4 files that would actually ship. Each refuses to answer, **exit 2**, rather than passing when
  its input set is empty: no config declaring an `include`, and no declared entry point respectively,
  because in both cases the comparison would otherwise succeed while examining nothing. Exit codes
  match the sibling gates: 0 agree, 1 disagree, 2 could not answer.

  Between them they run in five places. `check-tsconfig-includes.sh` runs first in `package.json`'s
  `build`, so it fails in a second rather than after a full compile; in `ci.yml`'s `typecheck` job;
  and in `release.yml` right after `npm ci`. `check-pack-contents.sh` runs in `package.json`'s
  `prepublishOnly` after the build, which closes the last unguarded path the #43 entry named,
  `npm publish` run by hand from a tree that was never built; in `ci.yml`'s `build` job; and in
  `release.yml` after its `Build` step. Their behaviour is proven offline by
  `test/scripts/check-tsconfig-includes.test.ts` (18 tests) and
  `test/scripts/check-pack-contents.test.ts` (14 tests), because a step in `release.yml` can only
  be exercised by pushing a `v*` tag and that publishes.

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