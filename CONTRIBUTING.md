# Contributing to Stagepass

Thanks for contributing. This monorepo uses npm workspaces (`packages/cli`, `packages/loader`, `packages/modules`).

## Setup

1. Clone the repository.
2. Install dependencies (prefer Docker for a clean Linux Node environment; see below).
3. Build packages: `npm run build`
4. For local CLI use: `chmod +x packages/cli/bin/index.js` and optionally `npm link` from `packages/cli`.

See [DEVELOPMENT.md](DEVELOPMENT.md) for more detail.

## Docker test recipe

Host `node_modules` may be platform-native. Run installs, builds, and tests inside Docker. Anonymous volumes keep container-built modules off the host:

```bash
docker run --rm -v "$PWD":/w \
  -v /w/node_modules -v /w/packages/cli/node_modules \
  -v /w/packages/loader/node_modules -v /w/packages/modules/node_modules \
  -w /w node:22 bash -lc \
  'npm ci && npm run build && npm test --workspaces --if-present && node scripts/test-cli-packed.mjs'
```

Also verify on Node 24 (`node:24` with the same volume flags) to match CI. Development and CI use Node 22 or 24; do not change published `engines` fields without a deliberate compatibility decision. If you change `package-lock.json`, generate it inside Docker and commit it.

After a loader/modules build that rewrites `dist/`, restore committed artifacts unless you intend to ship them:

```bash
git checkout -- packages/loader/dist packages/modules/dist
```

## Browser E2E (Playwright)

Headless tests live under `e2e/` (own `package.json`, not part of the npm workspaces). They serve fixture pages via Playwright routing (no real network) and cover zero-cost live-src, legacy `data-src`, flag chunks, and live-reload CSS/JS behaviour.

**Local (all browsers):** use the Playwright Docker image with Chromium, Firefox, and WebKit:

```bash
docker run --rm --ipc=host -v "$PWD":/w \
  -v /w/node_modules -v /w/packages/cli/node_modules \
  -v /w/packages/loader/node_modules -v /w/packages/modules/node_modules \
  -v /w/e2e/node_modules \
  -w /w mcr.microsoft.com/playwright:v1.56.1-noble bash -lc \
  'npm ci && npm run build && cd e2e && npm ci && npx playwright test'
```

**CI:** the `e2e` job on the self-hosted `cerebro` runner installs Chromium only (`npx playwright install --with-deps chromium`) and runs `npx playwright test --project=chromium`. Firefox and WebKit stay for the local Docker run above. The runner has no Docker socket, so CI does not use the Playwright image.

A full HTTPS page on a real `.sp` domain (Caddy + trusted local CA) is not covered in CI; the routed fixture suite covers loader behaviour instead. Validate `.sp` TLS manually on a Mac when changing Caddy or certs.

## Commit style

* Prefer small, logical commits.
* Use concise messages that explain **why** (e.g. `fix(cli): …`, `docs: …`, `chore: …`).
* Do not commit secrets, tokens, or local machine paths.
* Do not push tags or publish to npm unless you are a maintainer following [RELEASING.md](RELEASING.md).

## Releasing

Maintainers only. See **[RELEASING.md](RELEASING.md)**: a prerelease is optional (real test users) and stages on `next`; a stable release is verified by the maintainer before tagging and stages on `latest`, so one 2FA approval publishes it with no separate promotion. Breaking changes only in a new major (v3).

## Pull requests

1. Branch from the relevant release/development branch.
2. Keep changes focused; update docs/tests when behaviour changes.
3. Ensure the Docker test recipe passes on Node 22 and 24, and Chromium E2E (or the full Playwright Docker run) is green.
4. Describe what changed and how you verified it.

## Security

Report vulnerabilities privately. See [SECURITY.md](SECURITY.md). Do not discuss undisclosed issues in public PRs or issues.

## AI-assisted contributions

Contributions may be AI assisted, but the contributor must review every change before submitting. Public docs and credits should stay generic:

> Built with AI coding agents and tools, every release reviewed by a human.

Do not name specific AI models or tools in project docs.
