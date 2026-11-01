# `@stagepass/loader`

Universal browser runtime for Stagepass.

The loader reads Stagepass session state and swaps tagged production assets with local `.sp` assets during development. It also exposes a runtime API via `sp` / `stagepass`.

## Install

```bash
npm install @stagepass/loader
```

## CDN Usage

Pin exact versions in production:

```html
<script
  src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2.0.0/dist/loader.min.js"
  data-stagepass-version="2.0.0"
></script>
```

```html
<script src="https://unpkg.com/@stagepass/loader@2.0.0/dist/loader.min.js"></script>
```

See [MIGRATION.md](../../MIGRATION.md) for breaking changes from 1.x.

## What it does

- Processes `script[data-stagepass]` and `link[rel="stylesheet"][data-stagepass]`.
- Uses `data-src` / `data-href` as source URL.
- Uses `data-stagepass-path` as optional local path override.
- Local session: cache bust with `?_cb=<timestamp>` (one per page load).
- Production: version bust with `data-stagepass-version` / `data-stagepass-v` → `?v=<version>`.
- Session expiry (default 12 h): `data-stagepass-session-hours`.
- Optional legacy console mute: `data-stagepass-mute-console="true"`.
- Chrome Local Network Access hint when permission is `prompt` / `denied`.

## Runtime API

Preferred global is `sp` (aliases: `stagepass`, `window.stagepass`). Types ship in `global.d.ts`.

- `sp.vars.isLocal`
- `sp.vars.env`
- `sp.vars.domain`
- `sp.vars.timestamp`
- `sp.vars.version`
- `sp.vars.client.*` (theme/browser/os/device/viewport/locale/capabilities)
- `sp.resolveLocalUrl(relativePath)`
- `sp.log(...)`, `sp.warn(...)`, `sp.error(...)`

## URL Modes

- `?stagepass=my-project.sp` - activate local swapping (expires).
- `?stagepass=debug` - logging only.
- `?stagepass=off` / `0` / `false` - deactivate session.

## Related Packages

- `@stagepass/cli` - creates and manages `.sp` infrastructure.
- `@stagepass/modules` - optional modules that extend the loader.

## Repository

- Full docs and examples: [stagepass repository](https://github.com/arobertherz/stagepass)
