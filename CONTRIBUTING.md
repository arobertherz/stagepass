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

Also verify on Node 20 (`node:20-bookworm-slim`). If you change `package-lock.json`, generate it inside Docker and commit it.

## Commit style

- Prefer small, logical commits.
- Use concise messages that explain **why** (e.g. `fix(cli): …`, `docs: …`, `chore: …`).
- Do not commit secrets, tokens, or local machine paths.
- Do not push tags or publish to npm unless you are a maintainer following [RELEASING.md](RELEASING.md).

## Pull requests

1. Branch from the relevant release/development branch.
2. Keep changes focused; update docs/tests when behaviour changes.
3. Ensure the Docker test recipe passes on Node 20 and 22.
4. Describe what changed and how you verified it.

## Security

Report vulnerabilities privately — see [SECURITY.md](SECURITY.md). Do not discuss undisclosed issues in public PRs or issues.

## AI-assisted contributions

Contributions may be AI assisted, but the contributor must review every change before submitting. Public docs and credits should stay generic:

> Built with AI coding agents and tools, every release reviewed by a human.

Do not name specific AI models or tools in project docs.
