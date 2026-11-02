# Contributing to Stagepass

Thanks for contributing. This monorepo uses npm workspaces (`packages/cli`, `packages/loader`, `packages/modules`).

## Setup

1. Clone the repository.
2. Install dependencies (prefer Docker for a clean Linux Node environment; see below).
3. Build packages: `npm run build`
4. For local CLI use: `chmod +x packages/cli/bin/index.js` and optionally `npm link` from `packages/cli`.

See [DEVELOPMENT.md](DEVELOPMENT.md) for more detail.

## Docker test recipe

Host `node_modules` may be platform-native. Run installs, builds, and tests inside Docker:

```bash
docker run --rm -v "$PWD":/w \
  -v /w/node_modules -v /w/packages/cli/node_modules \
  -v /w/packages/loader/node_modules -v /w/packages/modules/node_modules \
  -w /w node:22-bookworm-slim bash -lc \
  'npm ci && npm run build && npm test --workspaces --if-present'
```

Also verify on Node 24 (`node:24-bookworm-slim`) to match CI. Development and CI use Node 22 or 24; do not change published `engines` fields (CLI stays `>=18.0.0`) without a deliberate compatibility decision. If you change `package-lock.json`, generate it inside Docker and commit it.

## Browser E2E (Playwright)

Headless tests live under `e2e/` (own `package.json`, not part of the npm workspaces). They serve fixture pages via Playwright routing (no real network) and cover zero-cost live-src, legacy `data-src`, and flag chunk resolution. Run inside the Playwright Docker image (Chromium, Firefox, and WebKit):

```bash
docker run --rm -v "$PWD":/w -w /w mcr.microsoft.com/playwright:v1.56.1-noble bash -lc \
  'npm ci && npm run build && cd e2e && npm ci && npm run e2e'
```

Or, if dependencies and `packages/loader/dist` are already built:

```bash
docker run --rm -v "$PWD":/w -w /w/e2e mcr.microsoft.com/playwright:v1.56.1-noble bash -lc \
  'npm ci && npm run e2e'
```

These E2E tests are not wired into GitHub Actions yet.

## Commit style

- Prefer small, logical commits.
- Use concise messages that explain **why** (e.g. `fix(cli): …`, `docs: …`, `chore: …`).
- Do not commit secrets, tokens, or local machine paths.
- Do not push tags or publish to npm unless you are a maintainer following [RELEASING.md](RELEASING.md).

## Releasing

Maintainers only. See **[RELEASING.md](RELEASING.md)**: every release starts as a prerelease (`--tag next`), is verified on a Webflow staging site with an exact beta pin, then ships stable (also staged on `next`) and is promoted to `latest` with an explicit `npm dist-tag add`. Breaking changes only in a new major (v3).

## Pull requests

1. Branch from the relevant release/development branch.
2. Keep changes focused; update docs/tests when behaviour changes.
3. Ensure the Docker test recipe passes on Node 22 and 24.
4. Describe what changed and how you verified it.

## Security

Report vulnerabilities privately. See [SECURITY.md](SECURITY.md). Do not discuss undisclosed issues in public PRs or issues.

## AI-assisted contributions

Contributions may be AI assisted, but the contributor must review every change before submitting. Public docs and credits should stay generic:

> Built with AI coding agents and tools, every release reviewed by a human.

Do not name specific AI models or tools in project docs.
