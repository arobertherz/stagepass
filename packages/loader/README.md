# `@stagepass/loader`

Universal browser runtime for Stagepass.

The loader reads Stagepass session state and swaps tagged production assets with local `.sp` assets during development. It also exposes a runtime API via `sp` / `stagepass`.

## Install

```bash
npm install @stagepass/loader
```

## CDN Usage

```html
<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@1/dist/loader.min.js"></script>
```

## What it does

- Processes `script[data-stagepass]` and `link[rel="stylesheet"][data-stagepass]`.
- Uses `data-src` / `data-href` as source URL.
- Uses `data-stagepass-path` as optional local path override.
- Adds cache busting in local mode via `?_cb=<timestamp>`.
- Optional production cache busting with `data-stagepass-cachebust="true"`.

## Runtime API

Preferred global is `sp` (aliases: `stagepass`, `window.stagepass`).

- `sp.vars.isLocal`
- `sp.vars.env`
- `sp.vars.domain`
- `sp.vars.timestamp`
- `sp.vars.version`
- `sp.vars.client.*` (theme/browser/os/device/viewport/locale/capabilities)
- `sp.resolveLocalUrl(relativePath)`
- `sp.log(...)`, `sp.warn(...)`, `sp.error(...)`

Deprecated aliases (still available): `splog`, `spwarn`, `sperror`.

## URL Modes

- `?stagepass=my-project.sp` - activate local swapping.
- `?stagepass=debug` - logging only.
- `?stagepass=off` - deactivate session.

## Related Packages

- `@stagepass/cli` - creates and manages `.sp` infrastructure.
- `@stagepass/modules` - optional modules that extend the loader.

## Repository

- Full docs and examples: [stagepass repository](https://github.com/arobertherz/stagepass)
