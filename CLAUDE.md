# n8n - Tallyfy Custom Nodes

> **NEVER use auto memory** (`~/.claude/projects/*/memory/`) — store all knowledge in CLAUDE.md files.

## Overview

Custom n8n community node package providing 96 Tallyfy API operations across 12 resources plus a
Trigger node, for workflow automation. Published on npm as `n8n-nodes-tallyfy` **v1.1.1** (npm latest
since 2026-07-26; installed via `npm install n8n-nodes-tallyfy`).

> **Unreleased on `main`** (2026-07-28): commit `47c0225` adds the middleware **#178** lenient kick-off
> choice match - `encodeKickoffValue` matches a dropdown/multi-select template option even when the
> value differs only by letter case or surrounding whitespace, then sends the option's own canonical
> text (a `canonicalChoiceEq` fallback before the fail-loud throw; parity with Zapier/Workato/Celigo/CLI/MCP).
> NOT yet published. The next npm publish must bump `package.json` to 1.1.2 first, then
> `npm publish --otp=XXXXXX` (2FA). Gates green: tsc build, eslint (0 errors), jest 46 passing.

## Working conventions

- **Direct pushes and merges to `main` are permitted in this repo (owner decision 2026-08-04).**
  Claude may merge PRs and push straight to `main` here. This is one of only two repos in the Tallyfy
  estate where that covers **code**, not just documentation; everywhere else code needs a PR.
  **The reason it is safe: pushing to `main` publishes nothing.** `.github/workflows/release.yml` is
  the only workflow, and it triggers on `push: tags: ['v*']`, never on a branch. Its `NPM_TOKEN`
  secret is not configured either, so today the npm release is the manual two-step recorded above —
  bump `package.json`, then `npm publish --otp=XXXXXX`. The droplet has no CI/CD at all
  ("**CI/CD**: None — deployed manually", under Production Deployment).
  **If that ever changes — `NPM_TOKEN` provisioned and the release workflow retriggered from a
  branch, or any publish step wired to `main` — this permission has to be re-examined, because the
  change would silently remove its only justification.**
  What still applies in full: every PR auto-closes a scoped issue, every PR body opens in plain
  English, and you assert only what you measured.

## Development (modernized 2026-07 — tallyfy/n8n#4)

- **Toolchain**: `n8n-workflow` ^2.16.0 (dev + peer), `engines.node` >=20.15, ESLint 8 + `@typescript-eslint` 8 + `eslint-plugin-n8n-nodes-base` 1.16.7 (+ `jsonc-eslint-parser` for linting package.json). `npm run build` (tsc + gulp icons) and `npm run lint` are both green.
- **n8n-workflow 2.x API note**: `NodeConnectionType` is type-only in 2.x; `inputs`/`outputs` use the literal `['main']` form (same runtime value as the old enum).
- **Deferred lint rules**: `.eslintrc.json` disables six `n8n-nodes-base` rules that would force user-visible UI/behavior changes (option-sorting, maxValue removal, color widget, error classes) plus the URL-mangling `cred-class-field-documentation-url-miscased`. Re-enable during the `@n8n/node-cli` verified-node re-scaffold (issue #4 phase 2).
- **Release**: `.github/workflows/release.yml` publishes to npm with provenance on `v*` tags (gates: lint + build + tag/version match). Needs the `NPM_TOKEN` repo secret (not yet configured).
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
