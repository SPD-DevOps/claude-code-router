# Speedio CCR 3.1.3 candidate — not approved for production

## Scope

Merge official tag `v3.1.3` into the Speedio fork based on `cef543c1`.
This branch/PR is a candidate, not a deployment authorization. Do not merge to main
until the checks and staging acceptance below are complete: main automatically builds,
pushes the production image and updates the shared infrastructure chart.

## Preserved Speedio behavior

- PM2 server name `ccr-core-server`, Nginx, optional SSH and optional S3 exporter.
- Dropbear host keys and `SSH_AUTHORIZED_KEY` integration.
- Basic Auth file persistence and Nginx read permissions.
- Global CCR CLI for SSH operations.
- Hetzner S3 path-style addressing and WHEN_REQUIRED request/response checksums.
- Existing production build/promote workflows (not invoked by this branch).

The only textual merge conflict was `docker/pm2.config.cjs`; the Speedio process list
was retained. Clean textual merges in Dockerfile/entrypoint still need runtime tests.
CLI version is now pinned to 3.1.3 and S3 SDK to 3.1166.0 through Docker build args.
These pins do not freeze every transitive dependency or base-image digest.

## Codex catalog discovery

Subscription model discovery now sends the `client_version` query parameter.
The tested default is 0.167.0; override with `CCR_CODEX_CLIENT_VERSION` when needed.
The value must be a semantic version. This is a Codex client version, not a CCR version.
No credentials or production catalogs are committed.

Tests cover default/override/invalid versions, actual mocked discovery, and retaining
existing models on HTTP errors, empty catalogs or transport failures. OAuth credentials
remain server-side and are not needed by these tests.

Upstream also adds configuration revision checks and separates settings saves from
API key writes. Verify conflicting UI saves and revocation/rotation with stale screens
in staging; these changes are relevant to, but do not establish the cause of, historical
configuration/key disappearance.

## Validation workflow

`.github/workflows/speedio-upgrade-validation.yaml` runs on PRs and `review/**` pushes:

- typecheck, core/UI/CLI/architecture tests and Speedio runtime unit tests;
- independent Linux Docker image build, upstream smoke and authenticated Speedio smoke;
- synthetic disposable volumes/tokens only;
- no registry push, deployment, Vault access, production secret or infrastructure tag update.

The upstream unauthenticated smoke explicitly disables Basic Auth. A separate Speedio
smoke enables Basic Auth and SSH, tests no/invalid/valid credentials, checks PM2 services
and repeats the assertions after a container restart. S3 configuration preservation has
a unit check; actual Hetzner upload still requires a controlled staging test.

## Local results (Node 24.20.0, macOS)

| Check | Result |
|---|---|
| npm ci | passed |
| TypeScript typecheck | passed |
| Codex unit file (including new discovery cases) | 19 passed |
| Speedio runtime tests | 2 passed |
| UI suite | 212 passed |
| CLI suite | 6 passed |
| Architecture suite | 5 passed |
| Core full suite before final mocked discovery cases | 1119 passed, 4 failed, 10 skipped |
| Docker assets build (`npm run build:docker`) | passed |
| Shell/JS syntax checks | passed |
| Linux Docker image build / runtime smoke | delegated to CI; no local Docker daemon available |

Core failures observed:

1. `RequestLogStore bounded heap regression` — its subprocess fails the assertion that
   fixture body size exceeds the V8 heap limit.
2. `known bundled plugins without persisted permissions receive scoped defaults`.
3. `legacy combined Claude Design plugin config migrates to split Design and Ship plugins`.
4. `Claude Design runtime plugin config resolves from the bundled plugin in CCR Desktop without persisting`.

The latter three involve bundled desktop plugin resolution. Root causes and behavior
on Linux/Node 22 are not established. Do not suppress failures or claim a fully green
suite. These are acceptance blockers until diagnosed or explicitly scoped by review.

## Required before promotion

- [ ] All Linux checks green; diagnose remaining core failures.
- [ ] Authenticated Docker smoke and restart persistence pass.
- [ ] Separate staging volume and credentials; no concurrent refresh of production OAuth tokens.
- [ ] Two UI sessions: stale-save conflict and preservation of API key changes.
- [ ] Per-user tokens and per-provider models across supported protocols, including streaming/tools.
- [ ] Confirm full Codex catalog discovery and preserve it through edits/restarts.
- [ ] Verify English UI mounts/CSP with the infrastructure charts.
- [ ] Controlled S3 export test; SSH behavior and CLI/process names.
- [ ] Consistent backup/restore of config SQLite, OAuth, htpasswd and other PVC data.
- [ ] Explicit production approval, controlled infrastructure PR and rollback plan.

S3 usage/request-log exports alone are not complete credential/configuration backups.
Never run a candidate against the live RWO volume concurrently with production.
