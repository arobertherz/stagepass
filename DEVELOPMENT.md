# Development Guide

This guide explains how to set up Stagepass for local development.

## Prerequisites

- Node.js **22 or 24** for development and CI (Vitest 5 and related tooling need Node `>=22.12`). The published CLI still declares `engines.node`: `>=18.0.0` for consumers; do not bump that field casually.
- npm (comes with Node.js)
- macOS only for running system CLI commands (`setup`, `start`, `stop`, `reload`, `link`, `unlink`, `doctor`, `certs`, `autostart`, `daemon`). Project helpers (`new`, `build`, `watch`, `upgrade`) are also available. Tests in Linux Docker inject the platform or set `STAGEPASS_SKIP_PLATFORM_CHECK=1` (tests/CI only).
- Homebrew (for dependency management)

## Local Development Setup

### 1. Install Dependencies

Install all workspace dependencies from the root directory:

```bash
npm install
```

This downloads all packages for CLI and Loader and links the workspaces.

### 2. Make CLI Executable

Make the CLI binary executable:

```bash
chmod +x packages/cli/bin/index.js
```

### 3. Link CLI Locally

Link the CLI package to simulate a global installation:

```bash
cd packages/cli
npm link
```

**Note:** This may require `sudo` depending on your Node.js installation, but usually it's not needed.

After linking, you can use `stagepass` commands from anywhere:

```bash
stagepass setup
stagepass start
stagepass link my-project
stagepass doctor
stagepass certs check
stagepass autostart status

# Optional project helpers (2.1+)
stagepass new my-project --yes
stagepass build
stagepass watch
stagepass upgrade
```

Full command set (keep in sync with the root README, `packages/cli/README.md`, and `AGENTS.md`):

| Command | Role |
| :--- | :--- |
| `stagepass setup` | Install dependencies and configure the `.sp` resolver |
| `stagepass start` | Start background Caddy and PHP |
| `stagepass stop` | Stop background services (hints when autostart is enabled) |
| `stagepass reload` | Reload Caddy configuration |
| `stagepass link [domain]` | Link the current directory to a `.sp` domain |
| `stagepass unlink [domain]` | Unlink a `.sp` domain |
| `stagepass doctor` | Read-only diagnostics; `--json`; exit 1 on fail |
| `stagepass certs check` | Read-only Caddy local CA / trust / TLS checks |
| `stagepass certs trust` | Run `caddy trust` after confirmation or `--yes` |
| `stagepass autostart on\|off\|status` | Login LaunchAgent (`io.github.arobertherz.stagepass`) |
| `stagepass daemon` | Foreground LaunchAgent helper (`caddy run`; never sudo) |
| `stagepass new [name]` | Scaffold a lean Webflow project (`--yes`, `--dry-run`, flags for every option) |
| `stagepass build` | Run `npm run build` in the current project |
| `stagepass watch` | Run `npm run watch` in the current project |
| `stagepass upgrade` | Bump `@stagepass/*` in `package.json` and print the Webflow snippet |

### 4. Build Loader and Modules

Build the loader and modules packages:

```bash
cd packages/loader
npm run build
cd ../modules
npm run build
```

This generates `packages/loader/dist/loader.js` and `loader.min.js`, plus `packages/modules/dist/{inject,cookies,maintenance,all}.min.js`.

For development with watch mode:

```bash
npm run dev
```

## Project Structure

```
stagepass/
├── packages/
│   ├── cli/           # CLI tool (published as @stagepass/cli)
│   │   ├── bin/       # Executable entry point
│   │   └── src/       # Source code
│   ├── loader/        # Browser loader (published as @stagepass/loader)
│   │   ├── src/       # TypeScript source
│   │   └── dist/      # Built files (committed for CDN)
│   └── modules/       # Browser modules (published as @stagepass/modules)
│       ├── src/       # TypeScript source
│       └── dist/      # Built files (committed for CDN)
└── README.md
```

## Testing Changes

Prefer running the full test run in Docker (host `node_modules` may be macOS-native):

```bash
docker run --rm -v "$PWD":/w \
  -v /w/node_modules -v /w/packages/cli/node_modules \
  -v /w/packages/loader/node_modules -v /w/packages/modules/node_modules \
  -w /w node:22-bookworm-slim bash -lc 'npm ci && npm run build && npm test --workspaces --if-present'
```

Packed smoke test (what npm actually ships: packs cli, loader and modules, scaffolds ts/js projects from the local tarballs, runs `tsc --noEmit` on `sp`, builds, and runs `upgrade` on an old-style project; needs registry access for third-party deps and a prior `npm run build`):

```bash
docker run --rm -v "$PWD":/w -w /w node:22-bookworm-slim node scripts/test-cli-packed.mjs
```

Templates under `packages/cli/templates/` must not start with a dot (npm pack drops `.gitignore`); name them without the dot and map them in `scaffoldTemplateMap`.

Also verify on Node 24 (`node:24-bookworm-slim`) to match CI (matrix: 22.x and 24.x). See `RELEASING.md` for the tag → `npm stage` flow. Loader v2 behaviour notes: session expiry, version cache busting, and no global console mute. See `MIGRATION.md`.

### Browser E2E (Playwright)

Isolated package under `e2e/` (not an npm workspace). Fixtures are fulfilled with `page.route` (no real network). Requires a prior loader build (`packages/loader/dist`).

```bash
docker run --rm -v "$PWD":/w -w /w mcr.microsoft.com/playwright:v1.56.1-noble bash -lc \
  'npm ci && npm run build && cd e2e && npm ci && npm run e2e'
```

Projects: Chromium, Firefox, WebKit (`npm run e2e` in `e2e/`). Not part of the GitHub Actions workflow yet.

### CLI Changes

After modifying CLI code, the changes are immediately available if you used `npm link`. No rebuild needed.

### Loader Changes

1. Modify `packages/loader/src/index.ts`
2. Run `npm run build` in `packages/loader/`
3. Test the built `dist/loader.min.js` in your Webflow project

For quick iteration, use watch mode:

```bash
cd packages/loader
npm run dev
```

## Publishing

Do **not** run `npm publish` from a developer machine. Releases use the tag → `npm stage publish` flow documented in **[RELEASING.md](RELEASING.md)** (every version is staged on `next`, maintainer 2FA approval, then an explicit `npm dist-tag add … latest`).

## Unlinking

To unlink the CLI after development:

```bash
npm unlink -g @stagepass/cli
```

Or if you want to remove the global link:

```bash
cd packages/cli
npm unlink
```
