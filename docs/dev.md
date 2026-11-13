# Live reload (`stagepass dev`)

`stagepass dev` ships in published CLI **2.3.1 and later** (npm `latest` is **2.4.0**). The client chunk `live.min.js` ships since published loader **2.4.0** (npm `latest` is **2.5.0**).

## Decision: no Vite in user projects

Stagepass does **not** add Vite (or an ESM HMR graph) to scaffolded projects. Webflow pages load bundled classic scripts in a fixed order. Prefer `stagepass build`, `stagepass watch` and `stagepass dev`. `stagepass build` emits a hashed `dist/manifest.json` plus stable `dist/main.js` / `dist/styles.css` copies. The loader swaps the stable files with `?_cb=` and does not read hashes or the manifest. CLI 2.4.0 `stagepass watch` and `stagepass dev` write only those stable files (no hashed files, no `manifest.json` writes). Published CLI 2.3.1 still writes hashes and `manifest.json` from watch when bytes change. A Vite dev graph would change script-order semantics and fight that model.

Instead, live reload is owned by the CLI and proxied on the existing `.sp` HTTPS site.

## What `stagepass dev` does

In a **linked** project directory:

1. Starts a small event server on `127.0.0.1` (ephemeral port).
2. Watches the project output directory (`dist` by default, or `outDir` in `stagepass.json`; always resolved inside the project root). When `stagepass.json` has `"php": true`, it also watches `api/` and `.php/` with the same debounce. Missing directories are skipped. `.env`, `.php/.env`, `.php/rate-limit/`, logs, pid files, `.pem` `.key` `.p12` `.pfx` `.crt` `.cer` `.sqlite` `.db`, and editor temp files (`~`, `.swp`, `.DS_Store`) do not reload. Without `"php": true` only the output directory is watched. The start log names `api/` and `.php/` when PHP watching is on. Watchers close when `stagepass dev` exits.
3. Serves Server-Sent Events at `/__stagepass/live` with payloads `{"type":"css"|"reload","paths":[…]}` (project-relative URL paths). Heartbeat comment every 25s. Cap 32 connections. No other routes (404). Request data is never reflected into responses. Classification is **content-based**: each watched file under the output dir is fingerprinted (sha256); identical rewrites (same bytes) are ignored and produce no broadcast; `manifest.json`, dotfiles, `~` backups and `.map` files are ignored. A batch where only `.css` files really changed emits `{type:"css"}` (stylesheet cache-bust / swap); any other real change emits `{type:"reload"}`.
4. Writes a validated `devPort` (integer 1024..65535) into `~/.stagepass/projects.json`, regenerates the site’s Caddy block with `handle /__stagepass/live` → `reverse_proxy 127.0.0.1:<port>` (`flush_interval -1`) **before** `file_server`, and reloads Caddy. CORS and Private Network Access preflight match the asset routes (same origin allowlist; no `*`).
5. Spawns `npm run watch` without a shell, inherits stdio, forwards SIGINT/SIGTERM, exits with the child code.
6. On exit (or when a stale `devPid` is dead on the next `start` / `link` / `dev`), clears `devPort` and reloads Caddy again.

```bash
cd my-project
stagepass link --origin my-project.webflow.io   # once
stagepass start                                 # if needed (dev also offers to start when interactive)
stagepass dev
```

`stagepass dev` (and `stagepass watch`) check whether Stagepass is already running. On an interactive TTY they ask to run the same in-process start path as `stagepass start`; in CI / non-TTY they print a `stagepass start` hint and continue. An unlinked directory still fails with a clear `stagepass link` error.

Then open the live site with `?stagepass=my-project.sp`.

**Prerequisites (public origin):** for a public `https://` page that swaps to `https://<project>.sp` (typically `127.0.0.1`), allow Chrome **Local network** / **Loopback network** for that origin and trust the Stagepass local CA. These are separate failure modes (`LocalNetworkAccessPermissionDenied` vs `ERR_CERT_AUTHORITY_INVALID`). Details: [troubleshooting.md](./troubleshooting.md#public-origin-to-sp-err_failed).

**Version split:** `dist/live.min.js` ships since published `@stagepass/loader` **2.4.0** (npm `latest` is **2.5.0**). Published **2.3.3** does **not** ship that chunk. `@2` is a major range alias, not the npm `latest` tag; after a publish the CDN can briefly serve the previous 2.x build. Pin an exact version (e.g. `@2.5.0`) when a specific build must load. Automatic CSS swap / JS reload requires a loader that includes `live.min.js` (pin `@2.5.0`), an active swap session, **and** the `stagepass dev` SSE server from CLI 2.3.0 (still in published CLI 2.4.0). Content-hash classification: CSS-only real changes emit `{type:"css"}` (stylesheet clone with `?t=` cache-bust); any other real change emits `{type:"reload"}` (`location.reload()`). Opt-in `data-stagepass-live-src` is a separate production-markup switch, not the live-reload server. Overlay of production assets still needs `data-stagepass` tags as in [getting-started.md](./getting-started.md) / [loader.md](./loader.md).

## Loader side

With an **active swap session** (not `debug`), after local assets are injected a loader that ships the live chunk lazily loads `live.min.js` from the same base URL as the flag chunks. The chunk opens:

```text
EventSource('https://<domain.sp>/__stagepass/live')
```

**Why always during a swap session (no `?stagepass=dev` flag):** the EventSource fails closed when `stagepass dev` is not running (close after the first error, no retry loop, one debug log line only in debug mode). That avoids a second URL parameter to teach, and keeps the core growth to a few lines that reuse the existing flag base URL. Visitors without a session never download the chunk and never hit `/__stagepass/live`.

On `css` events, every `<link rel="stylesheet">` whose `href` starts with the local base is replaced with a clone that has `?t=<timestamp>` (integrity removed; insert before remove). On `reload`, `location.reload()`. Stream payloads are JSON-parsed in try/catch; unknown types are ignored. Nothing from the stream is evaluated.

Prefer `stagepass build`, `stagepass watch` and `stagepass dev`. Scaffolded projects (`scripts/build.mjs --watch`, via `stagepass watch` / `stagepass dev`) rebuild only the affected part (JS entry/imports → JS, CSS entry → CSS) and write a dist file only when its bytes changed, so a CSS-only edit does not rewrite `main.js` and does not trigger a full reload. CLI 2.4.0 watch does not write hashed files or `manifest.json` (the manifest stays as the last `stagepass build`), and `stagepass upgrade` replaces `scripts/build.mjs` when it is still an unmodified older scaffold, leaving an edited script in place with a hint. Published CLI 2.3.1 does not do that replacement.

## Security notes

* Event server binds loopback only.
* Caddyfile port is validated before write.
* Output watch paths cannot escape the project root.
* SSE handler never echoes query strings or headers into the body.
