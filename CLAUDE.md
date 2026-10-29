# n8n - Tallyfy Custom Nodes

> **NEVER use auto memory** (`~/.claude/projects/*/memory/`) — store all knowledge in CLAUDE.md files.

## Overview

Custom n8n community node package providing 96 Tallyfy API operations across 12 resources plus a
Trigger node, for workflow automation. Published on npm as `n8n-nodes-tallyfy` **v1.1.3** (npm
`latest` since 2026-08-21; installed via `npm install n8n-nodes-tallyfy`). ⚠️ **This line said
`v1.1.2`/"since 2026-08-08" until 2026-08-22, and was already a day stale when read at the start
of a session that day** - the owner tagged and published 1.1.3 on 2026-08-21, `#21` closed the
same day, and `npm view n8n-nodes-tallyfy version` / the registry `dist-tags.latest` both read
`1.1.3` when re-checked 2026-08-22. Re-derive rather than trusting this line too: it will decay
the same way. **1.1.2 was the first release published by CI** rather than by hand, via npm
trusted publishing (OIDC) with SLSA provenance; 1.1.3 confirms the CI path is durable, not a
one-off.
**Reading of 2026-10-23 (#53, PR #56):** 104 operations across 13 resources, with the Scheduled
Job resource, counted from the operation lists in `nodes/Tallyfy/Tallyfy.node.ts` (96 across 12 on
`main` at `ef45a28` by the same count).

> ✅ **RELEASED in v1.1.2 on 2026-08-08.** This block said "Unreleased on `main`" from 2026-07-28
> until then. `47c0225` (**`tallyfy/middleware#178`**, still OPEN - lenient kick-off choice match: `encodeKickoffValue` matches a
> dropdown or multi-select template option differing only by letter case or surrounding whitespace,
> then sends the option's own canonical text via a `canonicalChoiceEq` fallback before the fail-loud
> throw; parity with Zapier/Workato/Celigo/CLI/MCP) and `6d8dfcd` (**#9** formField `updateValue`
> run-level null precondition) both shipped in it.
>
> ⚠️ **The release recipe in this block was wrong and is why those fixes sat for eleven days.** It
> said to bump `package.json` then run `npm publish --otp=XXXXXX`, presenting a manual 2FA publish as
> the only route. The real blocker was never the OTP: it was that CI could not publish at all, and
> the reason was misdiagnosed for weeks as a missing `NPM_TOKEN`. **Releases now go through CI.** The
> whole procedure is: bump `version` in `package.json`, **rename `## [Unreleased]` in `CHANGELOG.md`
> to `## [X.Y.Z] - YYYY-MM-DD` and open a fresh empty `## [Unreleased]` above it**, commit to
> `main`, then `git tag vX.Y.Z && git push origin vX.Y.Z`. The tag push is the trigger and there is
> no manual publish step.
>
> ⚠️ **The CHANGELOG step is enforced since 2026-08-09 and is not optional.** `scripts/check-changelog.sh`
> runs first in `release.yml`, before `npm ci`, and fails the run when the pushed tag has no matching
> heading, or has one with nothing under it (the empty-section half added 2026-08-22, #35).
> `npm test` fails the same way as soon as `package.json` is bumped without one, so the
> mistake surfaces at commit time rather than at tag time. It was added because 1.1.0, 1.1.1 and
> 1.1.2 all shipped with no entry: the procedure was written in two places and only the middleware
> runbook mentioned the CHANGELOG, so the step only one document mentioned is the one that stopped
> happening (#18, PR #20). Do not describe the procedure anywhere without that step.

## Working conventions

- **Claude may merge PRs and push directly to `main` in this repo (owner decision 2026-08-04).** This is one of only two repos in the Tallyfy
  estate where that covers **code**, not just documentation; everywhere else code needs a PR.
  **The reason it is safe, and the only reason: pushing to a BRANCH publishes nothing.**
  `.github/workflows/release.yml` is the only workflow that PUBLISHES anything, and it triggers on
  `push: tags: ['v*']`, never on a branch.
  Tallyfy's own n8n instance is deployed from the private repo `tallyfy/n8n-internal`, never from
  here (see "Tallyfy's own n8n instance" below).

  ⚠️ **"a commit landing on `main` starts zero workflow runs" was TRUE until 2026-08-28 and is now
  FALSE. Do not read a workflow run on your own SHA as evidence that something published.**
  `.github/workflows/version-sync.yml` (#39) runs on every push to `main` and on every pull
  request. It checks out the repo, installs nothing, and runs one script that compares the version
  in `package.json` against the two root version fields in `package-lock.json`. It publishes
  nothing and writes nothing. ⚠️ **As of 2026-08-29 there are TWO such workflows, not one.**
  `.github/workflows/ci.yml` (`tallyfy/work-queue#1174`) also runs on every push to `main` and every
  pull request, with four jobs: `lint`, `typecheck`, `test`, `build`. It installs dependencies and
  builds into `dist/`, and it publishes nothing and writes nothing to the repo either. **The permission's justification is unchanged**, because the
  justification is that no branch push PUBLISHES, not that no branch push runs anything at all.

  **The confirmation command changed with it, and the old one now fails toward alarm.** It was
  `gh run list --repo tallyfy/n8n --limit 5 --json headSha,workflowName`, expecting your SHA
  absent, which from 2026-08-28 reads as "something ran, so my push was not inert" on every single
  push. ⚠️ **Expect TWO runs from 2026-08-29, `Version sync` AND `CI`. This said "expect one run
  named `Version sync`" until then, so following it now reads as an unexplained extra run, which is
  the same fail-toward-alarm decay the sentence above is about.** What has not changed is the thing
  actually being asserted: there is no `Release` row.

  ```bash
  SHA=$(git -C ~/GitHub/n8n rev-parse HEAD)
  gh run list --repo tallyfy/n8n --limit 20 --json headSha,workflowName,conclusion \
    --jq "[.[] | select(.headSha == \"$SHA\") | {workflowName, conclusion}]"
  ```
  A `Release` row against a branch push is the thing that would mean this permission has to be
  re-examined. A `Version sync` or `CI` row is normal and is not a publish.
  **If that ever changes — any publish step wired to `main`, or the release workflow retriggered
  from a branch — this permission has to be re-examined, because the change would silently remove
  its only justification.**
  What still applies in full: every PR auto-closes a scoped issue, every PR body opens in plain
  English, and you assert only what you measured.

  ⚠️ **The permission covers BRANCHES. A TAG push is a production release.** `git push origin vX.Y.Z`
  publishes to npm, immediately and irreversibly, with no approval gate. Proven 2026-08-08: tag
  `v1.1.2` published `n8n-nodes-tallyfy@1.1.2` to the public registry. Never push a `v*` tag to
  "see whether the workflow works" — and note that even a FAILED run is not a no-op, because it
  signs a provenance statement into the public sigstore transparency log before npm can reject it
  (the `v1.1.0` run did exactly that, `logIndex 2217293290`).

  *(History, because it cost eleven days and the misdiagnosis is the reusable part: this file used
  to say the `NPM_TOKEN` secret was "not configured" and the release was a manual two-step. Both
  were false. The secret had existed since 2026-07-22 and the real gate was npm refusing a token
  publish without 2FA bypass. Chasing "provision the token" was the wrong fix twice over, since npm
  removes direct publishing from bypass-2FA tokens around Jan 2027. The answer was to remove the
  credential entirely.)*

## Development (modernized 2026-07 — tallyfy/n8n#4)

- **Toolchain**: `n8n-workflow` ^2.16.0 (dev + peer), `engines.node` >=20.15, ESLint 8 + `@typescript-eslint` 8 + `eslint-plugin-n8n-nodes-base` 1.16.7 (+ `jsonc-eslint-parser` for linting package.json). `npm run build` and `npm run lint` are both green. ⚠️ **This said `npm run build` is "(tsc + gulp icons)" until 2026-08-30 and it has not been those two alone since #43.** It is now four steps in this order: `scripts/check-tsconfig-includes.sh && tsc && gulp build:icons && scripts/check-icons.sh`. The include check runs **first** on purpose, so a config that has stopped naming the sources fails in a second rather than after a full compile that would have exited 0 anyway (#45). Derive it rather than trusting this line: `jq -r .scripts.build package.json`.
  **Reading of 2026-10-18 (#4, the `@n8n/node-cli` re-scaffold):** the package is built with `@n8n/node-cli` 0.52.5, pinned exactly because a new release can add lint rules. `npm run build` is `scripts/check-tsconfig-includes.sh && n8n-node build && scripts/check-icons.sh`; `n8n-node build` clears `dist`, runs `tsc`, then copies every `*.png` and `*.svg` outside `dist` and `node_modules` to the same relative path under `dist`. `npm run lint` is `n8n-node lint`: ESLint 9 over the whole repository with `@n8n/eslint-plugin-community-nodes` plus `eslint-plugin-n8n-nodes-base`. `package.json` sets `n8n.strict: true`, so `eslint.config.mjs` must stay byte-for-byte n8n's default (whitespace aside): measured, a config adding one rule override made `npm run lint` exit 1 with "Strict mode violation". Do not add rules or ignores there; that one edit would make the package ineligible for verification. ESLint 8, `@typescript-eslint/*` as direct dependencies, `jsonc-eslint-parser`, gulp, `gulpfile.js`, `build.sh` and `.eslintrc.json` are gone. `n8n-workflow` is `~2.43.5` as a dev dependency (the n8n stable line on that date) and `*` as the peer dependency, which n8n's `valid-peer-dependencies` rule requires. Layout follows the node-cli templates: `nodes/Tallyfy/`, `nodes/TallyfyTrigger/` (moved out of `nodes/Tallyfy/`), a codex `*.node.json` beside each node, and the shared icon in `icons/tallyfy.svg`. The template's `release` script and `prepublishOnly: n8n-node prerelease` were NOT adopted: `n8n-node prerelease` exits 1 unless `RELEASE_MODE` is set, which would break the `npm publish` in `release.yml`, and `n8n-node release` is a second release path that bypasses the CHANGELOG gate.
- **n8n-workflow 2.x API note**: `NodeConnectionType` is type-only in 2.x; `inputs`/`outputs` use the literal `['main']` form (same runtime value as the old enum). Since 2026-10-18 they use `NodeConnectionTypes.Main` from `n8n-workflow` instead, because `@n8n/community-nodes/node-connection-type-literal` rejects the literal; the runtime value is still `'main'`.
  **Reading of 2026-10-23 (#52): that change sets the minimum n8n to 1.85.0.** The node reads `NodeConnectionTypes` at runtime from the `n8n-workflow` inside the n8n it runs in, and the peer range `*` warns nobody. `n8n-workflow` first exports it in its own 1.83.0 (1.82.0 has only the `NodeConnectionType` enum), and n8n 1.85.0 is the first n8n that depends on `n8n-workflow` 1.83.0; n8n 1.83.x ships 1.81.x and n8n 1.84.x ships 1.82.0. n8n and `n8n-workflow` are numbered separately, so never read one version as the other. Derived from the registry: the `n8n-workflow` dependency of every published n8n version, checked against the cut in both directions, with cuts at 1.83.0 and 1.86.0 as the failing controls. README and the 1.2.0 CHANGELOG entry state it. Re-derive it if the node ever imports another runtime value from `n8n-workflow`, since that value's first release could raise the floor again.
- **Tallyfy Trigger node versions** (dated 2026-10-23, #59): the trigger is `version: [1, 2]` with
  `defaultVersion: 2`, using n8n's light versioning. Mode is defined twice under the same name, one
  copy shown for `'@version': [1]` with default Polling and one for `'@version': [{ _cnd: { gte: 2 } }]`
  with default Instant, and the runtime fallbacks read `defaultMode(typeVersion)`. Never change a
  default in place: n8n stores a parameter only when it differs from its default, so a saved node
  has no value for it and would silently take the new one on upgrade. Add a version instead.
  `test/nodes/TallyfyTrigger.node.test.ts` resolves both versions through n8n-workflow's own
  `NodeHelpers.getNodeParameters`, the function n8n uses to fill and strip defaults.
- **Deferred lint rules**: `.eslintrc.json` disables six `n8n-nodes-base` rules that would force user-visible UI/behavior changes (option-sorting, maxValue removal, color widget, error classes) plus the URL-mangling `cred-class-field-documentation-url-miscased`. Re-enable during the `@n8n/node-cli` verified-node re-scaffold (issue #4 phase 2).
  **Done 2026-10-18 (#4), and `.eslintrc.json` is gone.** Five of the seven are on and satisfied: the three sorting rules, `node-param-color-type-unused` and `node-execute-block-wrong-error-thrown`. The other two stay off because n8n's own default config switches them off and strict mode forbids changing it: `node-param-type-options-max-value-present` and `cred-class-field-documentation-url-miscased`. The sorting rules print "[autofixable]" but applied no fix when run with `--fix` (measured); the 20 lists were reordered by script into the exact order each report named, and a line-multiset comparison showed nothing but order changed. The "Create one off task" action could not get its hyphen back: `node-param-operation-option-action-miscased` rejects any hyphen, so it now reads "Create a standalone task". Test files carry a file-level ESLint directive for the runtime-sandbox rules (restricted imports and globals, `child_process`, raw rethrows), because `n8n-node lint` lints `test/` too; n8n's scan does not lint `test/` and ignores inline directives, so nothing under `nodes/` or `credentials/` may carry one.
- **Tests**: `npm test` runs Jest. 113 tests declared across 5 files, re-derived 2026-08-22: `test/credentials/TallyfyApi.credentials.test.ts` (5), `test/live/Tallyfy.live.test.ts` (20), `test/nodes/Tallyfy.node.test.ts` (61), `test/nodes/TallyfyTrigger.node.test.ts` (11), `test/scripts/check-changelog.test.ts` (16). The live file is gated behind `TALLYFY_LIVE=1` (`const d = LIVE ? describe : describe.skip`), so a plain `npm test` skips its 20 and reports **93 passed, 20 skipped** (observed, not inferred). Re-derive rather than trusting this count, since it decays the moment a test is added or removed: `grep -rcE '^[[:space:]]*it\(' test/**/*.test.ts`. ⚠️ **127 declared across 6 files as of 2026-08-28**, after `test/scripts/check-version-sync.test.ts` (14) was added by #39; a plain `npm test` now reports **107 passed, 20 skipped** (observed, not inferred). ⚠️ **141 declared across 7 files as of 2026-08-29**, after `test/scripts/check-icons.test.ts` (14) was added by #43; a plain `npm test` now reports **121 passed, 20 skipped** (observed, not inferred). ⚠️ **173 declared across 9 files as of 2026-08-30**, after `test/scripts/check-tsconfig-includes.test.ts` (18) and `test/scripts/check-pack-contents.test.ts` (14) were added by #45; a plain `npm test` now reports **153 passed, 20 skipped** (observed, not inferred). The 2026-08-22 figures above are correct for their date and are deliberately left as written rather than overwritten, which is the same reason the note below exists. ⚠️ **This bullet read 103 / 57 / 10 until 2026-08-22 and had already decayed on its own**: `Tallyfy.node.test.ts` had gained four tests that were never folded back in, so only 6 of the 10-test delta is the check-changelog work of #35. Exactly the decay the sentence above warns about, in the sentence that warns about it. **Reading of 2026-10-18 (#4):** Jest reports **200 tests, 180 passed, 20 skipped** across the same 9 files, observed on CI run `39146631983` at `d23180c`. `main` at `1a3f747` reported 158 passed, 20 skipped, 178 total the same day, so five tests had been added since the 2026-08-30 reading without being recorded here. The re-scaffold added 22: 15 in `Tallyfy.node.test.ts` (from 10 lines, one of them an `it.each` over six error sites, which is why a line count of `it(` undercounts), 5 in `TallyfyTrigger.node.test.ts` and 2 in `check-tsconfig-includes.test.ts`.
  **Reading of 2026-10-23 (#53, #55, PR #56):** Jest reports **257 tests, 233 passed, 24 skipped** across 10 files, observed locally on ak-imac at `4f19c9e`. New: `test/nodes/ScheduledJob.node.test.ts`, a `#55` paging block in `Tallyfy.node.test.ts`, and four live tests (Scheduled Job lifecycle and Return All on blueprints), which is why 24 are skipped rather than 20.
- **n8n's verification scan** (dated 2026-10-18, #4). `npx @n8n/scan-community-package
  n8n-nodes-tallyfy` takes a PUBLISHED name only: it checks npm provenance, downloads the source
  at the commit the provenance names from GitHub, and lints `package.json` plus
  `{nodes,credentials}/**` from that source and `**/*.js` plus `package.json` from the tarball,
  with inline ESLint directives ignored. It prints a failure but exits 0, so read its text, never
  its exit code. Run against the published 1.1.3 on 2026-10-18 it failed with 41 errors in the
  source and 1 in the tarball, all fixed by the re-scaffold. To check an unpublished tree, import
  the scanner's own `analyzePackage(dir, patterns)` and `SOURCE_FILE_PATTERNS` from
  `@n8n/scan-community-package/scanner/scanner.mjs` (installed in a scratch directory, not here)
  and run it on the repository and on an extracted `npm pack` tarball with
  `['**/*.js', 'package.json']`. Control it by running the same harness on `git archive v1.1.3`,
  which must reproduce the 41 errors, and by planting `require("fs")` in a copy of the tarball's
  `dist`, which must fail the tarball leg.
- **Loading the package in a real n8n** (dated 2026-10-18, #4). Run `n8nio/n8n:2.43.7` in Docker
  with the extracted `npm pack` output copied to `<home>/.n8n/nodes/node_modules/n8n-nodes-tallyfy`
  and `<home>` mounted at `/home/node`; n8n then loads it as an installed community package (its log
  says "Loaded all credentials and nodes from n8n-nodes-tallyfy" with 1 credential and 2 nodes).
  Two traps, both measured: `/healthz` answers 200 while n8n is still migrating, so wait for
  `/healthz/readiness` to answer 200 AND the log line "Editor is now accessible"; and
  `/types/nodes.json` answers `Unauthorized` until an owner exists, so create one on the throwaway
  instance with `POST /rest/owner/setup` and fetch with that cookie. Result that day: the branch
  registered `n8n-nodes-tallyfy.tallyfy`, `.tallyfyTrigger` and the AI tool variant `.tallyfyTool`
  (output `ai_tool`), the published 1.1.3 registered only the first two, and each served its own
  icon path with the other path and a fabricated one answering 404.
- **Pull request and push gates** (`.github/workflows/ci.yml`, added 2026-08-29,
  `tallyfy/work-queue#1174`): four jobs on every `pull_request` and every push to `main`, named
  `lint`, `typecheck`, `test` and `build`. They run the same commands `release.yml` runs, on the
  same Node version, so green here means those four steps in the publish are green for the same
  commit. Before this, lint, the typecheck, the jest suite and the build all fired for the FIRST
  time during the publish itself, which is irreversible.
  **None of them is a required status check.** `main` has no branch protection at all: `gh api
  repos/tallyfy/n8n/branches/main/protection` returns `404 Branch not protected`, which is a
  different message from the `404 Branch not found` a fabricated branch returns. So these report
  and cannot block, and that is a deliberate open question rather than an oversight (stated in
  PR #42, not decided).
  Two things worth knowing about them:
  (1) `typecheck` runs `scripts/check-tsconfig-includes.sh` first (added 2026-08-30, #45), then
  `tsc --noEmit` over **both** `tsconfig.json` and `tsconfig.jest.json`, and
  asserts the number of test files the second one covers. `tsconfig.jest.json` had an `include` of
  `test/**/*.ts` that was **dead** until 2026-08-29: the base tsconfig's `exclude` of `test` and
  `**/*.test.ts` is inherited and beats include, so tsc checked 3 files and never looked at a test
  file. Overriding `exclude` there took it to 11. Do not remove that override.
  (2) `build` compares the icons in `dist/nodes` against the icons in `nodes/`. `gulp build:icons`
  uses a glob with magic characters, so it does **not** error on an empty match: it copies zero
  files and exits 0. Measured 2026-08-29 with the glob deliberately pointed at nothing, `dist`
  removed first: `npm run build` exited **0**.
  ✅ **Closed later the same day by `#43`, and the assertion is no longer inline in `ci.yml`.** It
  is `scripts/check-icons.sh`, called from three places: `package.json`'s `build`, so `npm run
  build` itself now exits **1** on that same mutated tree (both directions shown on one run, and
  restoring the glob returns it to 0); `ci.yml`; and `release.yml` immediately after its `Build`
  step, so the publish path no longer lacks it. It compares relative path SETS, not only counts,
  so a stale `dist` holding the same number of differently named files fails too, and it exits 2
  rather than 0 when there are no source icons, since zero would otherwise equal zero forever.
  Since 2026-10-18 its defaults are `icons/` and `dist/icons/`, because the icon moved there with
  the node-cli re-scaffold (#4). `n8n-node build`'s copy has the same blind spot as gulp's,
  measured the same day: with the icon moved out of the repository it exited 0 with no svg under
  `dist`, and with `icons/` renamed inside the repository it followed the file to
  `dist/<new name>/` and still exited 0.
  ⚠️ Two siblings measured the same day and **not** fixed then: one `include` in `tsconfig.json`
  matching nothing is silent (`tsc` raises TS18003 only when **every** include is empty, measured
  rc 0 against rc 2, and `nodes/**/*.json` matches zero files today), and `npm pack --dry-run`
  with no `dist` at all exits **0** and builds a four file tarball carrying no code. `jest` and
  `eslint` both fail closed on an empty match, so the list is not one sided.
  ✅ **BOTH CLOSED 2026-08-30 by `#45`. The measurements above are correct for their date and are
  left as written; do not overwrite them.** Both findings were re-derived independently before
  being fixed rather than carried over, and both agreed. Two more scripts, same shape and same
  exit codes as `check-icons.sh`, 0 agree / 1 disagree / 2 could not answer:
  - `scripts/check-tsconfig-includes.sh` requires every `include` pattern in every
    `tsconfig*.json` to match at least one file. It asks TypeScript's own resolver rather than
    reimplementing its glob rules, so it agrees with the compiler by construction, and it
    **discovers** the configs instead of holding a list. `nodes/**/*.json` was removed in the same
    change, so the gate is green on a correct tree rather than red from the day it landed;
    `tsc --listFilesOnly` reports the same 3 files before and after. **Fixed 2026-10-18 (#4):** it
    resolved every pattern with empty compiler options, so with `resolveJsonModule` off it counted
    any `.json` pattern as 0 files even while tsc compiled them, and the node-cli tsconfig's
    `nodes/**/*.json` (the codex files) and `package.json` read as dead. It now passes each
    config's effective options, `extends` included, and is tested against tsc's own file list with
    the option on and off. Runs first in
    `package.json`'s `build`, in `ci.yml`'s `typecheck` job, and in `release.yml` after `npm ci`.
  - `scripts/check-pack-contents.sh` requires every path under `package.json`'s `n8n.nodes` and
    `n8n.credentials` to be in the manifest `npm pack --dry-run --json` produces. It asserts the
    tarball **contents**, never `npm pack`'s exit code, because the exit code is the thing that is
    wrong. Note what would NOT work: "the tarball holds a `.js`" passes on an unbuilt tree, since
    `index.js` is at the package root and npm always includes the file named by `main`. Runs in
    `prepublishOnly` after the build, which closes the last unguarded path (`npm publish` by hand
    from a tree that was never built), in `ci.yml`'s `build` job, and in `release.yml` after
    `Build`.
- **Release**: `.github/workflows/release.yml` publishes to npm **via trusted publishing (OIDC)** on
  `v*` tags, with provenance. Gates in order: **CHANGELOG entry check**, **lock-file version check**
  (`scripts/check-version-sync.sh`, added 2026-08-28, #39), npm upgrade, `npm ci`,
  **tsconfig include check** (`scripts/check-tsconfig-includes.sh`, added 2026-08-30, #45), lint,
  build, **icon copy check** (`scripts/check-icons.sh`, added 2026-08-29, #43),
  **pack contents check** (`scripts/check-pack-contents.sh`, added 2026-08-30, #45), test,
  tag/version match, publish. Derive the list rather than trusting it, since it grows:
  `yq '.jobs.publish.steps[].name' .github/workflows/release.yml`, or read the file.
  The include check sits right after `npm ci` because that is the earliest point it can run, it
  needs the local `typescript`, and it names a broken include directly where lint and build would
  report the wrong cause or nothing at all. The pack check sits after `Build` because it asserts
  what the build produced, read from npm's own manifest rather than inferred from the build having
  exited 0. The CHANGELOG check runs first because it needs only the
  checkout, so a malformed release fails in seconds instead of after a full install and build. The
  lock-file check sits before `npm ci` because `npm ci` cannot catch what it looks for: npm's sync
  check compares dependencies only, and it exited 0 on the drifted pair while a control desyncing a
  real dependency exited 1 with `EUSAGE`.
  **There is no publish credential.** The workflow exchanges its `id-token` for a
  short-lived one; `release.yml` contains no `secrets.` reference at all, and the old `NPM_TOKEN`
  repo secret was **deleted 2026-08-08** (`gh api repos/tallyfy/n8n/actions/secrets` → `total_count: 0`).
  Registered publisher on npmjs.com: org `tallyfy`, repo `n8n`, workflow `release.yml`.
- **Work in progress goes under `## [Unreleased]` in `CHANGELOG.md`, never under the last released
  version's heading** (convention recorded in the file itself 2026-08-22, #35). Both conventions
  were half-adopted before that: the preamble claimed Keep a Changelog, which prescribes
  `[Unreleased]`, while `main` accumulated under the last released heading, which is how the `#30`
  fix ended up filed under `1.1.3` after `v1.1.3` was already tagged and on npm.
- **To cut a release**: bump `version` in `package.json`, **rename `## [Unreleased]` to
  `## [X.Y.Z] - YYYY-MM-DD` and open a fresh empty `## [Unreleased]` above it**, commit to `main`,
  then `git tag vX.Y.Z && git push origin vX.Y.Z`. Nothing else. Do not run `npm publish` by hand.
  Renaming rather than adding is the point: nothing has to be hunted down and moved, so nothing can
  be left behind. Check the changelog half locally before tagging, since a tag push is
  irreversible: `scripts/check-changelog.sh <version>` exits 0 when the entry exists **and has
  entries under it**, 1 when it does not, 2 when it was called wrongly or the scan itself broke.
  ⚠️ **The "and has entries under it" half is new as of 2026-08-22 (#35).** Until then the script
  stopped at the heading, so a bare `## [1.1.4]` with nothing beneath it passed and the release
  would have shipped with its notes still filed under the previous version. Measured both
  directions before the change: an empty section under a correct heading exited 0, a missing
  heading exited 1. An empty `## [Unreleased]` never blocks a release, and `[Unreleased]` can never
  satisfy one, because the gate is only ever asked about a semantic version.
- ✅ **`1.1.3` WAS TAGGED AND PUBLISHED, 2026-08-21, by the owner directly. `#21` is CLOSED.**
  Corrected 2026-08-22 - this bullet said "NOT published, npm `latest` is still `1.1.2`" until
  then, and that was already false by the time a session read it the next day. Verified two ways:
  `npm view n8n-nodes-tallyfy version` and the registry's `dist-tags.latest` both read `1.1.3`,
  and `#21` (the release tracking issue) reads `state: CLOSED, stateReason: COMPLETED`. The tag
  `v1.1.3` points at `e1094fea` (tagger `amit@tallyfy.com`, `2026-08-21T12:47:58Z`), and its
  `Release` workflow run is `conclusion: success`.

  `git log v1.1.2..v1.1.3 --oneline` shows what actually shipped - **four** merged user-facing
  fixes, not three: `d2224ba` (PR #13, issue #12) `SEAT_POOL_EXHAUSTED` naming the pool that is
  actually full; `dd426b5` (PR #23, issue #22) lenient `radio` kick-off matching; `dd976e8e` (PR
  #27, issue #26) `encodeKickoffValue` accepting an option **ID** on dropdown and multiselect as
  radio already did; and `8169358` (PR #29, `tallyfy/middleware#240`) the exact-text-before-id
  precedence fix for ambiguous choice input. The "three" count above was already stale before
  publication - #29 landed after it was last derived and was never folded back in. Read the
  `git log` range, never a prose enumeration, for exactly this reason.

  ⚠️ **`main` is AHEAD of the published `1.1.3` again, as of 2026-08-22, and `package.json` does
  NOT say so.** `tallyfy/n8n#30` (option-ID whitespace trimming, PR #33, merged `d23d0ea`) landed
  on `main` after the `v1.1.3` tag, and `package.json` still reads `1.1.3` - unchanged, because a
  version bump is a separate, deliberate step nobody has taken yet. **This is exactly the trap the
  next line warns about**: `node -p "require('./package.json').version"` and `npm view
  n8n-nodes-tallyfy version` both currently read `1.1.3` and APPEAR to agree, which reads as
  "nothing to publish" - they agree only because nobody has bumped the version for what shipped
  after the tag. **The real check is `git log v1.1.3..origin/main --oneline`, not a version-string
  comparison**, whenever a version string comparison alone would read as reassuring: a
  version-string match tells you nothing once a version has already been used once and `main` has
  moved past it.

  **To release what is unreleased now**: bump `package.json` to the next version (**1.1.4** -
  `1.1.3` cannot be reused, the tag exists), rename `## [Unreleased]` in `CHANGELOG.md` to
  `## [1.1.4] - YYYY-MM-DD` and open a fresh empty `## [Unreleased]` above it, commit, then
  `git tag vX.Y.Z && git push origin vX.Y.Z`. Nobody has decided to do this yet; it is not done as
  a side effect of merging a fix to `main`, on purpose, so that publishing stays a deliberate act
  gated on the owner rather than on whoever happens to merge next.

  **Reading of 2026-10-23: the next version is 1.2.0, and 1.1.4 will never exist.** The owner
  decided on 2026-10-22 to release what is on `main` as 1.2.0 (#52). The release PR for #52 bumps
  `package.json` and the lock to 1.2.0 and renames `## [Unreleased]` to `## [1.2.0] - 2026-10-23`.
  The tag `v1.2.0` is pushed only after that PR's independent review, and pushing it is the
  publish. Until `npm view n8n-nodes-tallyfy version` reads `1.2.0`, the paragraph above about
  `main` being ahead of the published version still describes the live state.

  **Reading of 2026-10-23, later the same day: 1.2.0 was tagged and never published, and the next
  version is 1.2.1.** PR #54 merged as `457830f` and the tag `v1.2.0` started Release run
  `39905616620`, which failed at the pack contents check with "no files array" and skipped the
  publish; `npm view n8n-nodes-tallyfy version` still read `1.1.3`. The cause was the npm the
  workflow installed (see the third trap below). The owner decided the same day to release as
  1.2.1 and leave the `v1.2.0` tag as the record of the failed run, so never delete or move it,
  and never reuse 1.2.0. The release PR for #52 fixes the check, pins npm, and bumps to 1.2.1.

  **Reading of 2026-10-23, evening: the version after 1.2.1 is 1.3.0, from PR #56.** That PR
  carries the Scheduled Job resource (#53), the Get Many paging fix (#55) and the README section
  on Tallyfy's MCP server (#57), merges `main` after 1.2.1 (#58, `3544b75`), bumps `package.json`
  and the lock to 1.3.0, and files its notes under `## [1.3.0] - 2026-10-23`. As with every
  release, the tag `v1.3.0` is the publish and is pushed only after that PR's review and merge.

  **Reading of 2026-10-23, night: the version after 1.3.0 is 1.4.0, from the release PR for #59.**
  It makes Instant the default Mode for a newly added Tallyfy Trigger through node version 2
  (version 1 keeps Polling, so saved workflows keep their mode), passes a 403 on subscribe that is
  not the admin refusal through in Tallyfy's own words, and corrects the #9 help text and live
  tripwire. As with every release, the tag `v1.4.0` is the publish and is pushed only after that
  PR's review and merge.
- ⚠️ **Two traps, both measured rather than theorised.** (1) `actions/setup-node` must NOT set
  `registry-url` here. With it, setup-node writes `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}`
  into a temp `.npmrc`; with no token that expands to empty, npm treats auth as configured, **skips
  the OIDC exchange** and fails `ENEEDAUTH`. Caught by Cursor Bugbot on PR #16 before it shipped.
  (2) A failed release run still writes a permanent public provenance record (see above), so a tag
  push is never a safe experiment.
  (3) **Added 2026-10-23 (#52): the npm a release runs must be the npm CI runs.** `release.yml`
  used to install `npm@latest`, while CI ran the runner's npm 10, so every release ran an npm no
  pull request had. npm 12 prints `npm pack --dry-run --json` as an object keyed by package name
  where npm 10 prints a one-element array (measured on this package: 10.9.9 array, 12.0.2 and
  12.2.1 object), and `scripts/check-pack-contents.sh` read only the array, so the v1.2.0 release
  stopped there unpublished. The script now reads both shapes. `release.yml` pins npm 12.0.2,
  the version that published 1.1.3 through OIDC, and `ci.yml`'s `build` job installs the same
  version before `npm ci`. `test/scripts/npm-pin.test.ts` fails if the pins differ or the release
  one is not exact, so change both together. npm 12 needs Node `^22.22.2 || ^24.15.0 || >=26`;
  to run it on a Mac with another Node, use a checksum-verified Node 22 from nodejs.org.
- **What is on npm**: `n8n-nodes-tallyfy@1.1.2`, published 2026-08-08 by CI with SLSA provenance —
  the first release this workflow has ever produced. Verify with
  `curl -s https://registry.npmjs.org/-/npm/v1/attestations/n8n-nodes-tallyfy@1.1.2 | jq '[.attestations[].predicateType]'`.
  Everything up to and including 1.1.1 was published by hand.
  Reading of 2026-10-29 (#65): npm's latest is `n8n-nodes-tallyfy@1.4.1`, published 2026-10-24T21:15Z.
  The releases after 1.1.2 are 1.1.3, 1.2.1, 1.3.0, 1.4.0 and 1.4.1, and 1.4.1 also carries both
  attestations. Read the current version with `npm view n8n-nodes-tallyfy version` and use it in the curl above.
- **macOS install gotcha**: n8n-workflow 2.x pulls `isolated-vm` (native C++ addon, needs Node >=22 headers to compile; fine on Linux CI). **Check `xcode-select -p` BEFORE exporting anything.** On a Mac whose CommandLineTools lack `usr/include/c++/v1` (broken CLT), `npm install` fails with `'memory' file not found`, and the fix is `export CPLUS_INCLUDE_PATH=/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/include/c++/v1`, plus making sure Apple's `/usr/bin/libtool` (not Homebrew GNU libtool) wins in PATH or the `-static` archive step fails. ⚠️ **Where `xcode-select -p` points at Xcode rather than CommandLineTools, that export MIXES TWO SDKs and `npm ci` fails with `unknown type name 'uint64_t'` — a different error that reads like a worse version of the one you were fixing.** Measured on ak-imac 2026-08-21: clean environment, no workaround, `npm ci` exits 0. So the workaround is conditional, not a default.

## CI runners and pull requests (dated 2026-10-06)

This repo is public. All its CI runs on GitHub-hosted runners and it sets no `CI_*` variable.

## Tallyfy's own n8n instance

Tallyfy runs its own n8n at n8n.tallyfy.com, on the droplet named answers-n8n. Its config, deploys, backups, workflows and known issues live in the private repo `tallyfy/n8n-internal`, which deploys it from GitHub Actions; the droplet itself is in `systems/docs/DigitalOcean_Infrastructure.md`. This repo is public, so it names no internal address, droplet id or tunnel id (work-queue#3641, 2026-10-23).
