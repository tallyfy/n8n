# n8n - Tallyfy Custom Nodes

> **NEVER use auto memory** (`~/.claude/projects/*/memory/`) — store all knowledge in CLAUDE.md files.

## Overview

Custom n8n community node package providing 96 Tallyfy API operations across 12 resources plus a
Trigger node, for workflow automation. Published on npm as `n8n-nodes-tallyfy` **v1.1.2** (npm latest
since 2026-08-08; installed via `npm install n8n-nodes-tallyfy`). **1.1.2 is the first release
published by CI** rather than by hand, via npm trusted publishing (OIDC) with SLSA provenance.

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
> whole procedure is: bump `version` in `package.json`, **add a `## [X.Y.Z] - YYYY-MM-DD` entry to
> `CHANGELOG.md`**, commit to `main`, then `git tag vX.Y.Z && git push origin vX.Y.Z`. The tag push
> is the trigger and there is no manual publish step.
>
> ⚠️ **The CHANGELOG step is enforced since 2026-08-09 and is not optional.** `scripts/check-changelog.sh`
> runs first in `release.yml`, before `npm ci`, and fails the run when the pushed tag has no matching
> heading. `npm test` fails the same way as soon as `package.json` is bumped without one, so the
> mistake surfaces at commit time rather than at tag time. It was added because 1.1.0, 1.1.1 and
> 1.1.2 all shipped with no entry: the procedure was written in two places and only the middleware
> runbook mentioned the CHANGELOG, so the step only one document mentioned is the one that stopped
> happening (#18, PR #20). Do not describe the procedure anywhere without that step.

## Working conventions

- **Claude may merge PRs and push directly to `main` in this repo (owner decision 2026-08-04).** This is one of only two repos in the Tallyfy
  estate where that covers **code**, not just documentation; everywhere else code needs a PR.
  **The reason it is safe, and the only reason: pushing to a BRANCH publishes nothing.**
  `.github/workflows/release.yml` is the only workflow in the repo and it triggers on
  `push: tags: ['v*']`, never on a branch, so a commit landing on `main` starts zero workflow runs.
  The droplet has no CI/CD either ("**CI/CD**: None — deployed manually", under Production
  Deployment). Confirm a push was inert with
  `gh run list --repo tallyfy/n8n --limit 5 --json headSha,workflowName` and expect your SHA absent.
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
- **Release**: `.github/workflows/release.yml` publishes to npm **via trusted publishing (OIDC)** on
  `v*` tags, with provenance. Gates in order: **CHANGELOG entry check**, npm upgrade, `npm ci`, lint,
  build, test, tag/version match, publish. The CHANGELOG check runs first because it needs only the
  checkout, so a malformed release fails in seconds instead of after a full install and build.
  **There is no publish credential.** The workflow exchanges its `id-token` for a
  short-lived one; `release.yml` contains no `secrets.` reference at all, and the old `NPM_TOKEN`
  repo secret was **deleted 2026-08-08** (`gh api repos/tallyfy/n8n/actions/secrets` → `total_count: 0`).
  Registered publisher on npmjs.com: org `tallyfy`, repo `n8n`, workflow `release.yml`.
- **To cut a release**: bump `version` in `package.json`, **add a `## [X.Y.Z] - YYYY-MM-DD` entry to
  `CHANGELOG.md`**, commit to `main`, then `git tag vX.Y.Z && git push origin vX.Y.Z`. Nothing else.
  Do not run `npm publish` by hand. Check the changelog half locally before tagging, since a tag push
  is irreversible: `scripts/check-changelog.sh <version>` exits 0 when the entry exists, 1 when it
  does not, 2 when it was called wrongly.
- ⚠️ **`main` declares `1.1.3` and it is NOT published. npm `latest` is still `1.1.2`.** Updated
  2026-08-10 (#24, PR #25): the version and its `CHANGELOG.md` entry landed, and the tag was
  deliberately **not** pushed. So the version on `main` is not the version anyone is running, and
  a `package.json` read is not an answer to "what do users have".

  `1.1.3` carries **three** merged user-facing fixes: `d2224ba` (PR #13, issue #12), the
  `SEAT_POOL_EXHAUSTED` message naming the pool that is actually full; `dd426b5` (PR #23, issue
  #22), lenient `radio` kick-off matching; and `dd976e8e` (PR #27, issue #26, 2026-08-12),
  `encodeKickoffValue` accepting an option **ID** on dropdown and multiselect as radio already did.
  **Two of the three can reach a customer today** — api-v2 does not emit the 409 shape until
  `allocated_seats_model_active` is flipped (`api-v2#9143`, open), but both kick-off matching fixes
  are live behaviour the moment 1.1.3 is published.

  ⚠️ **This bullet said "two" until 2026-08-12, one commit after the third landed.** The count is a
  literal enumeration in prose and nothing tests it, so it goes stale the next time anything merges
  to `main` unpublished. **Derive it instead:** `git log v1.1.2..origin/main --oneline`, and read
  `CHANGELOG.md`'s `## [1.1.3]` section, which is the entry `scripts/check-changelog.sh` actually
  gates on.

  **To release it: `git tag v1.1.3 && git push origin v1.1.3`.** That is the whole of what is left
  on **#21**, and it is irreversible. The 2026-08-09 decision was wait-and-batch, resuming when
  either `api-v2#9143` flips or the droplet install (#14) is scheduled; neither had fired when this
  was written.

  Re-derive rather than trusting this line: `git log v1.1.2..origin/main`, and compare
  `node -p "require('./package.json').version"` against `npm view n8n-nodes-tallyfy version`.
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
- **macOS install gotcha**: n8n-workflow 2.x pulls `isolated-vm` (native C++ addon, needs Node >=22 headers to compile; fine on Linux CI). On a Mac whose CommandLineTools lack `usr/include/c++/v1` (broken CLT), `npm install` fails with `'memory' file not found` — work around with `export CPLUS_INCLUDE_PATH=/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/include/c++/v1`, and make sure Apple's `/usr/bin/libtool` (not Homebrew GNU libtool) wins in PATH or the `-static` archive step fails.

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
