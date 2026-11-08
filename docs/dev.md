# Live reload (`stagepass dev`)

## Decision: no Vite in user projects

Stagepass does **not** add Vite (or an ESM HMR graph) to scaffolded projects. Webflow pages load bundled classic scripts in a fixed order, and the scaffold emits a hashed `dist/manifest.json` with stable `dist/main.js` / `dist/styles.css` copies. A Vite dev graph would change script-order semantics and fight that model.

Instead, live reload is owned by the CLI and proxied on the existing `.sp` HTTPS site.

## What `stagepass dev` does

In a **linked** project directory:

1. Starts a small event server on `127.0.0.1` (ephemeral port).
2. Watches the project output directory (`dist` by default, or `outDir` in `stagepass.json`; always resolved inside the project root).
3. Serves Server-Sent Events at `/__stagepass/live` with payloads `{"type":"css"|"reload","paths":[…]}` (project-relative URL paths). Heartbeat comment every 25s. Cap 32 connections. No other routes (404). Request data is never reflected into responses. Classification is **content-based**: each watched file under the output dir is fingerprinted (sha256); identical rewrites (same bytes) are ignored and produce no broadcast; `manifest.json`, dotfiles, `~` backups and `.map` files are ignored. A batch where only `.css` files really changed emits `{type:"css"}` (stylesheet cache-bust / swap); any other real change emits `{type:"reload"}`.
4. Writes a validated `devPort` (integer 1024..65535) into `~/.stagepass/projects.json`, regenerates the site’s Caddy block with `handle /__stagepass/live` → `reverse_proxy 127.0.0.1:<port>` (`flush_interval -1`) **before** `file_server`, and reloads Caddy. CORS and Private Network Access preflight match the asset routes (same origin allowlist; no `*`).
5. Spawns `npm run watch` without a shell, inherits stdio, forwards SIGINT/SIGTERM, exits with the child code.
6. On exit (or when a stale `devPid` is dead on the next `start` / `link` / `dev`), clears `devPort` and reloads Caddy again.

```bash
cd my-project
stagepass link --origin my-project.webflow.io   # once
stagepass start                                 # if needed
stagepass dev
```

Then open the live site with `?stagepass=my-project.sp`.

**Prerequisites (public origin):** for a public `https://` page that swaps to `https://<project>.sp` (typically `127.0.0.1`), allow Chrome **Local network** / **Loopback network** for that origin and trust the Stagepass local CA. These are separate failure modes (`LocalNetworkAccessPermissionDenied` vs `ERR_CERT_AUTHORITY_INVALID`). Details: [troubleshooting.md](./troubleshooting.md#public-origin-to-sp-err_failed).

**Version split:** published `@stagepass/loader` **2.3.3** (jsDelivr `@2` currently resolves there) still does **not** ship `dist/live.min.js`. That chunk is in tagged loader **2.4.0** (`loader-v2.4.0` / `cddec72`) and is **not** on the public npm registry until that publish completes. Automatic CSS swap / JS reload requires a loader that includes `live.min.js`, an active swap session, **and** the unpublished `stagepass dev` SSE server — do not treat `stagepass dev` as a command from current npm `@stagepass/cli@2.2.6`. Content-hash classification: CSS-only real changes emit `{type:"css"}` (stylesheet clone with `?t=` cache-bust); any other real change emits `{type:"reload"}` (`location.reload()`). Opt-in `data-stagepass-live-src` is a separate production-markup switch, not the live-reload server. Overlay of production assets still needs `data-stagepass` tags as in [getting-started.md](./getting-started.md) / [loader.md](./loader.md).

## Loader side

With an **active swap session** (not `debug`), after local assets are injected a loader that ships the live chunk lazily loads `live.min.js` from the same base URL as the flag chunks. The chunk opens:

```text
EventSource('https://<domain.sp>/__stagepass/live')
```

**Why always during a swap session (no `?stagepass=dev` flag):** the EventSource fails closed when `stagepass dev` is not running (close after the first error, no retry loop, one debug log line only in debug mode). That avoids a second URL parameter to teach, and keeps the core growth to a few lines that reuse the existing flag base URL. Visitors without a session never download the chunk and never hit `/__stagepass/live`.

On `css` events, every `<link rel="stylesheet">` whose `href` starts with the local base is replaced with a clone that has `?t=<timestamp>` (integrity removed; insert before remove). On `reload`, `location.reload()`. Stream payloads are JSON-parsed in try/catch; unknown types are ignored. Nothing from the stream is evaluated.

Scaffolded projects (`scripts/build.mjs --watch`) rebuild only the affected part (JS entry/imports → JS, CSS entry → CSS) and write a `dist` file only when its bytes changed, so a CSS-only edit does not rewrite `main.js` and does not trigger a full reload.

## Security notes

* Event server binds loopback only.
* Caddyfile port is validated before write.
* Output watch paths cannot escape the project root.
* SSE handler never echoes query strings or headers into the body.
