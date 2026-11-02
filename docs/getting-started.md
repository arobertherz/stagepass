# Getting started

Stagepass bridges a live Webflow (or any production) site with files on your Mac. The CLI creates HTTPS `.sp` domains; the loader swaps tagged assets to those local URLs while a session is active.

## Install

```bash
npm install -g @stagepass/cli@2
```

Or once without a global install:

```bash
npx @stagepass/cli@2 setup
```

**Requirements:** macOS for system commands (`setup`, `start`, `stop`, `reload`, `link`, `unlink`, `dev`). Published CLI `engines.node` is `>=20.17.0`. Homebrew is used for Caddy, PHP, and Dnsmasq.

## First project

```bash
stagepass setup
stagepass start
stagepass new my-project --yes --staging my-project.webflow.io
cd my-project
stagepass link --origin my-project.webflow.io
npm run build
```

Add the loader to Webflow (Project Settings → Custom Code → Head Code). Prefer an exact pin in production; see [loader.md](./loader.md#version-pinning).

```html
<script
  src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2.3.1/dist/loader.min.js"
  data-stagepass-version="2.3.1"
></script>
```

Tag assets (legacy `data-src` / `data-href`, or opt-in live-src; see [loader.md](./loader.md)):

```html
<script
  data-src="https://cdn.example.com/js/app.min.js"
  data-stagepass
  data-stagepass-path="dist/main.js"
></script>
<link
  rel="stylesheet"
  data-href="https://cdn.example.com/css/app.css"
  data-stagepass
  data-stagepass-path="dist/styles.css"
/>
```

Activate on the live site:

```text
https://www.example.com/?stagepass=my-project.sp
```

For CSS hot swap and JS full reload while you edit, run `stagepass dev` in the project (see [dev.md](./dev.md)).

## Session modes

| URL | Effect |
| --- | --- |
| `?stagepass=my-project.sp` | Start a swap session (stored in `localStorage`, default 12 h) |
| `?stagepass=debug` | Logging only, no asset swap |
| `?stagepass=off` / `0` / `false` | Clear the session |

The query parameter is removed with `history.replaceState` after processing.

## Next

* [CLI reference](./cli.md)
* [Loader](./loader.md)
* [Modules](./modules.md)
* [Live reload (`stagepass dev`)](./dev.md)
* [Troubleshooting](./troubleshooting.md)
* [Migration from 1.x](./migration.md)
