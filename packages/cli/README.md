# `@stagepass/cli`

Local development orchestrator for Webflow projects.

The CLI sets up and manages the local Stagepass infrastructure (`.sp` domains, Caddy, DNS, PHP) so your live Webflow site can load local assets through the Stagepass loader.

## Install

```bash
npm install -g @stagepass/cli
```

## Requirements

- macOS
- Node.js 18+
- Homebrew

## Quick Start

```bash
stagepass setup
stagepass start

# inside your project folder
stagepass link my-project
```

Your project is now available at `https://my-project.sp`.

## Commands

- `stagepass setup` - install dependencies and configure local resolver.
- `stagepass start` - start Caddy + PHP background services.
- `stagepass link [domain]` - link current directory to a `.sp` domain.
- `stagepass unlink [domain]` - remove link from Caddy config.
- `stagepass reload` - reload Caddy config.
- `stagepass stop` - stop background services.

All commands support `-v, --verbose`.

## Related Packages

- `@stagepass/loader` - browser runtime for swapping production assets.
- `@stagepass/modules` - optional runtime modules (`inject`, `cookies`).

## Repository

- Docs and full setup: [stagepass repository](https://github.com/arobertherz/stagepass)
