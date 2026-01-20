# Development Guide

This guide explains how to set up Stagepass for local development.

## Prerequisites

- Node.js 18+
- npm (comes with Node.js)
- macOS (Windows/Linux support coming soon)
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

### Publish Loader

```bash
cd packages/loader
npm run build  # Ensure dist/ is up to date
npm publish --access public
```

### Publish CLI

```bash
cd packages/cli
npm publish --access public
```

**Note:** Both packages require `--access public` because they use the `@stagepass` scope.

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
