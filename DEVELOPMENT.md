# Development Guide

This guide explains how to set up Stagepass for local development.

## Prerequisites

- Node.js **22 or 24** for development and CI (Vitest 5 and related tooling need Node `>=22.12`). The published CLI still declares `engines.node`: `>=18.0.0` for consumers; do not bump that field casually.
- npm (comes with Node.js)
- macOS only for running system CLI commands (`setup`, `start`, `stop`, `reload`, `link`, `unlink`). Tests in Linux Docker inject the platform or set `STAGEPASS_SKIP_PLATFORM_CHECK=1` (tests/CI only).
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
```

### 4. Build Loader

Build the loader package:

```bash
cd packages/loader
npm run build
```

This generates `dist/loader.js` and `dist/loader.min.js`.

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
│   │       └── commands/
│   └── loader/        # Browser loader (published as @stagepass/loader)
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

Also verify on Node 24 (`node:24-bookworm-slim`) to match CI (matrix: 22.x and 24.x). See `RELEASING.md` for the tag → `npm stage` flow. Loader v2 behaviour notes: session expiry, version cache busting, and no global console mute. See `MIGRATION.md`.

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

Do **not** run `npm publish` from a developer machine. Releases use the tag → `npm stage publish` flow documented in **[RELEASING.md](RELEASING.md)** (prerelease on `next`, then stable on `latest`, maintainer 2FA approval).

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
