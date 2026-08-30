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
  The droplet has no CI/CD either ("**CI/CD**: None — deployed manually", under Production
  Deployment).

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

- **Toolchain**: `n8n-workflow` ^2.16.0 (dev + peer), `engines.node` >=20.15, ESLint 8 + `@typescript-eslint` 8 + `eslint-plugin-n8n-nodes-base` 1.16.7 (+ `jsonc-eslint-parser` for linting package.json). `npm run build` (tsc + gulp icons) and `npm run lint` are both green.
- **n8n-workflow 2.x API note**: `NodeConnectionType` is type-only in 2.x; `inputs`/`outputs` use the literal `['main']` form (same runtime value as the old enum).
- **Deferred lint rules**: `.eslintrc.json` disables six `n8n-nodes-base` rules that would force user-visible UI/behavior changes (option-sorting, maxValue removal, color widget, error classes) plus the URL-mangling `cred-class-field-documentation-url-miscased`. Re-enable during the `@n8n/node-cli` verified-node re-scaffold (issue #4 phase 2).
- **Tests**: `npm test` runs Jest. 113 tests declared across 5 files, re-derived 2026-08-22: `test/credentials/TallyfyApi.credentials.test.ts` (5), `test/live/Tallyfy.live.test.ts` (20), `test/nodes/Tallyfy.node.test.ts` (61), `test/nodes/TallyfyTrigger.node.test.ts` (11), `test/scripts/check-changelog.test.ts` (16). The live file is gated behind `TALLYFY_LIVE=1` (`const d = LIVE ? describe : describe.skip`), so a plain `npm test` skips its 20 and reports **93 passed, 20 skipped** (observed, not inferred). Re-derive rather than trusting this count, since it decays the moment a test is added or removed: `grep -rcE '^[[:space:]]*it\(' test/**/*.test.ts`. ⚠️ **127 declared across 6 files as of 2026-08-28**, after `test/scripts/check-version-sync.test.ts` (14) was added by #39; a plain `npm test` now reports **107 passed, 20 skipped** (observed, not inferred). ⚠️ **141 declared across 7 files as of 2026-08-29**, after `test/scripts/check-icons.test.ts` (14) was added by #43; a plain `npm test` now reports **121 passed, 20 skipped** (observed, not inferred). The 2026-08-22 figures above are correct for their date and are deliberately left as written rather than overwritten, which is the same reason the note below exists. ⚠️ **This bullet read 103 / 57 / 10 until 2026-08-22 and had already decayed on its own**: `Tallyfy.node.test.ts` had gained four tests that were never folded back in, so only 6 of the 10-test delta is the check-changelog work of #35. Exactly the decay the sentence above warns about, in the sentence that warns about it.
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
  (1) `typecheck` runs `tsc --noEmit` over **both** `tsconfig.json` and `tsconfig.jest.json`, and
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
  ⚠️ Two siblings measured the same day and **not** fixed: one `include` in `tsconfig.json`
  matching nothing is silent (`tsc` raises TS18003 only when **every** include is empty, measured
  rc 0 against rc 2, and `nodes/**/*.json` matches zero files today), and `npm pack --dry-run`
  with no `dist` at all exits **0** and builds a four file tarball carrying no code. `jest` and
  `eslint` both fail closed on an empty match, so the list is not one sided.
- **Release**: `.github/workflows/release.yml` publishes to npm **via trusted publishing (OIDC)** on
  `v*` tags, with provenance. Gates in order: **CHANGELOG entry check**, **lock-file version check**
  (`scripts/check-version-sync.sh`, added 2026-08-28, #39), npm upgrade, `npm ci`, lint,
  build, **icon copy check** (`scripts/check-icons.sh`, added 2026-08-29, #43), test,
  tag/version match, publish. The CHANGELOG check runs first because it needs only the
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
- ⚠️ **Two traps, both measured rather than theorised.** (1) `actions/setup-node` must NOT set
  `registry-url` here. With it, setup-node writes `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}`
  into a temp `.npmrc`; with no token that expands to empty, npm treats auth as configured, **skips
  the OIDC exchange** and fails `ENEEDAUTH`. Caught by Cursor Bugbot on PR #16 before it shipped.
  (2) A failed release run still writes a permanent public provenance record (see above), so a tag
  push is never a safe experiment.
- **What is on npm**: `n8n-nodes-tallyfy@1.1.2`, published 2026-08-08 by CI with SLSA provenance —
  the first release this workflow has ever produced. Verify with
  `curl -s https://registry.npmjs.org/-/npm/v1/attestations/n8n-nodes-tallyfy@1.1.2 | jq '[.attestations[].predicateType]'`.
  Everything up to and including 1.1.1 was published by hand.
- **macOS install gotcha**: n8n-workflow 2.x pulls `isolated-vm` (native C++ addon, needs Node >=22 headers to compile; fine on Linux CI). **Check `xcode-select -p` BEFORE exporting anything.** On a Mac whose CommandLineTools lack `usr/include/c++/v1` (broken CLT), `npm install` fails with `'memory' file not found`, and the fix is `export CPLUS_INCLUDE_PATH=/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/include/c++/v1`, plus making sure Apple's `/usr/bin/libtool` (not Homebrew GNU libtool) wins in PATH or the `-static` archive step fails. ⚠️ **Where `xcode-select -p` points at Xcode rather than CommandLineTools, that export MIXES TWO SDKs and `npm ci` fails with `unknown type name 'uint64_t'` — a different error that reads like a worse version of the one you were fixing.** Measured on ak-imac 2026-08-21: clean environment, no workaround, `npm ci` exits 0. So the workaround is conditional, not a default.

## Production Deployment

- **Droplet**: answers-n8n (64.227.104.197), ID 405593214
- **Path**: /home/n8n/
- **Container**: n8n (port 5678, image: n8n-n8n)
- **Database**: PostgreSQL 17 on same droplet (database: n8n, 10 MB)
- **Docker network**: n8n
- **Tunnel**: n8n.tallyfy.com via mcp&answers tunnel (2a507cba-31a4-4732-adf9-7a137b9b9b4a)
- **CI/CD**: None — deployed manually
- **Backups**: DO usage-based weekly backups enabled (2026-03-29)

**Full DO infrastructure docs**: See `systems/docs/DigitalOcean_Infrastructure.md`

## Known Issues

- **Boot-order dependency**: After droplet reboot, PostgreSQL must listen on Docker bridge IPs (`172.17.0.1`) before n8n can start. PG `listen_addresses` includes Docker bridges but they don't exist at PG boot time. **Fix**: Restart PG after boot (`systemctl restart postgresql@17-main`) then restart n8n (`docker restart n8n`).
- No automated deployment pipeline
- Workflows/credentials backed up via DO droplet-level weekly backups (enabled 2026-03-29)
