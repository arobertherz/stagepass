# `@stagepass/loader`

Universal browser runtime for Stagepass.

The loader reads Stagepass session state and swaps tagged production assets with local `.sp` assets during development. It also exposes a runtime API via `sp` / `stagepass`.

## Install

```bash
npm install @stagepass/loader@2
```

## CDN Usage

Prefer the major pin `@2` in production on jsDelivr. Stagepass follows strict semver: no breaking changes within v2; breaking changes only in a new major (v3). Exact pins (e.g. `@2.4.0`) are optional for maximum control. jsDelivr may cache `@2` for a while; purge with `https://purge.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js`. See [Version pinning](https://github.com/arobertherz/stagepass/blob/master/docs/loader.md#version-pinning) in the docs.

```html
<script
  src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js"
  data-stagepass-version="2.4.0"
></script>
```

unpkg serves the same paths if you need an alternative CDN. Always embed the full `/dist/loader.min.js` path (not a short package URL that redirects); otherwise session chunks resolve from the wrong folder. Or set `data-stagepass-flag-base`.

## Known limits (scoped acceptance)

Acceptance for `live.min.js` / live reload is **scoped localhost only**. It is not proof of the full default `setup` / `start` / `stop` path, System Trust / `certs renew`, autostart / login / boot / OS-crash recovery, or a real `.sp` resolver + production Webflow origin path.

A `localhost` / `localhost:<port>` session still reports `sp.env() === 'production'` (unchanged since 2.3.1 / 2.3.3). Only an active `*.sp` swap session is `local`. That is expected behaviour, not a live-reload failure.

`live.min.js` is the published loader **2.4.0** chunk (lazy-loaded during an active swap session; not in **2.3.3**). Pin `@2.4.0` to load it (npm `latest` is **2.4.0**). `@2` is a major range alias, not the npm `latest` tag; after a publish the CDN can briefly serve the previous 2.x build. Pin an exact version (e.g. `@2.4.0`) when a specific build must load.

See [MIGRATION.md](../../MIGRATION.md) for breaking changes from 1.x.

## What it does

- Processes `script[data-stagepass]:not([data-stagepass-processed])` and `link[rel="stylesheet"][data-stagepass]:not([data-stagepass-processed])`.
- Uses `data-src` (scripts) / `data-href` (stylesheets) as the production URL.
- Uses `data-stagepass-path` as an optional local path; if omitted while swapping, the filename is taken from the production URL.
- Inserts the new element before the original, then removes the original (`data-stagepass-processed` prevents double work).
- Local session: cache-bust with a single `?_cb=<timestamp>` per page load.
- Production: version bust with `data-stagepass-version` (loader tag) and/or `data-stagepass-v` (per asset) → `?v=<version>` (URL-encoded; existing query/hash preserved).
- Production, per asset: `data-stagepass-nocache` on a `data-src` / `data-href` asset appends a fresh `?_cb=<timestamp>` on **every** page view, for every visitor (not just during a Stagepass session). `?v=` is applied first when present, so both combine as `?v=<version>&_cb=<timestamp>`. Existing query/hash stay preserved.
- `data-stagepass-cachebust="true"` is legacy and **does not** timestamp every production view in v2.
- Session expiry (default **12 h**): `data-stagepass-session-hours` on the loader tag.
- Optional legacy global console mute: `data-stagepass-mute-console="true"` (production, no session only).
- Dynamically created scripts use `async=false` unless the original had `async`; `defer` is added when neither async nor defer was set (keeps classic order).
- Chrome Local Network Access: best-effort permission query; when a local file fails at the network level and the state is `prompt` or `denied`, the error in the flag card includes the hint.

## Loader tag attributes

| Attribute | Effect |
| :--- | :--- |
| `data-stagepass-version` | Production default `?v=<version>` for swapped/tagged assets without a per-asset override. |
| `data-stagepass-session-hours` | Session lifetime in hours (positive number; default `12`). |
| `data-stagepass-mute-console="true"` | Opt-in legacy mute of `console.log/warn/error/info/debug` in production when no session. |
| `data-stagepass-staging-hosts` | Comma-separated hostnames treated as staging (in addition to `*.webflow.io`). |
| `data-stagepass-alias` | Optional custom global name (valid JS identifier). Assigned only when that global is free. |
| `data-stagepass-flag-base` | Folder for `flag.min.js` / `flag-card.min.js` when the loader is inlined or bundled (2.3.1+). `http(s)` or relative only; also `window.stagepassFlagBase`. Read only during a session. |
| `data-stagepass-live-src="true"` | Opt-in zero-cost mode: tagged assets use native `src` / `href`; the loader rewrites them only while a swap session is active. |

## Asset attributes

| Attribute | Effect |
| :--- | :--- |
| `data-stagepass` | Marks the element for processing (any value). |
| `data-src` / `data-href` | Production URL for legacy mode (default). Required unless live-src opt-in uses native `src` / `href`. |
| `data-stagepass-path` | Local path under the linked project root (optional). |
| `data-stagepass-v` | Per-asset production `?v=<version>` (overrides loader `data-stagepass-version`). |
| `data-stagepass-nocache` | Boolean (present, or `="true"`; `="false"` turns it off). Production only: appends a fresh `?_cb=<timestamp>` to **this asset's** URL on every page view, for every visitor. Combines with `data-stagepass-v` / `data-stagepass-version` as `?v=<version>&_cb=<timestamp>`. No effect during an active local/dev swap session (local assets already get a per-page-load `_cb` stamp). Not applied to `data-stagepass-live-src="true"` assets, which stay untouched in production by design. |
| `data-stagepass-cachebust` | Legacy; ignored for production timestamps in v2. |
| `data-stagepass-processed` | Internal; set after processing. |

## URL Modes

- `?stagepass=my-project.sp`: activate local swapping (expires; default 12 h).
- `?stagepass=debug`: logging only (no asset swap).
- `?stagepass=off` / `0` / `false`: clear the session.

Allowed session values: `*.sp`, `localhost`, `localhost:<port>`, `debug`. Invalid values are rejected/cleared.

After handling, `?stagepass=` is removed with `history.replaceState` (other query params and the hash are kept).

Storage key: `localStorage.stagepass_domain` → JSON `{ "domain": "…", "expires": <ms> }`. Legacy plain-string values are cleared.

## Dev flag

Shown only while a session is active (including debug).

| Stage | Flag |
| :--- | :--- |
| Rest | pass-icon pill with a status dot (amber: warnings, red: errors) |
| Hover / focus (first tap on touch) | expands to the left: `LOCAL` or `DEBUG`, warning and error counters (`99+` above 99) |
| Click (second tap on touch) | session card |

- Card: project, session domain, a collapsed list of swapped files (live → local, `js`/`css`, `ok` / `404` / `failed`; only loaded files count as swapped) and the latest 50 message groups (text only, truncated, repeats as `×N` with the last time). Rows are one-liners; details show source (`local` / `live` / `external`), `file:line:col` and the stack. "Always expanded" is stored per origin. "Copy all" and per-message "Copy" write Markdown (page URL without query, project, loader version, messages; no cookies or storage).
- Card footer: Reload, "Debug mode" / "Back to local" (reloads with `?stagepass=debug` and back to the previous session, also from a new tab), End session. Without a session to return to the button is disabled and the card explains why.
- Locally swapped files get `crossorigin="anonymous"` (unless the tag already sets `crossorigin`) for full error details. Without a CORS header from the local server the file loads again without it and a warning says so. Production files and debug sessions are unchanged.
- Only "End session" clears the session. Esc or a click outside closes the card.
- Warnings: `sp.warn`, `sp.log('warn', …)`, `console.warn` (only during a session; the original console still runs), loader warnings.
- Errors: `sp.error`, `sp.log('error', …)`, `console.error`, uncaught errors (with stack), failed resource loads, unhandled rejections (with stack). Local files report "Local file not found (404)" or "Local server not reachable … Run stagepass doctor". Sanitized errors from other origins show as "Error in a cross-origin script (details only in DevTools console)".
- Accessibility: the pill is a button with `aria-expanded`, the card a `role="dialog"`; focus moves into the card and back to the pill; reduced motion makes all changes instant.
- Rendered in an open Shadow DOM (`#stagepass-flag`) with DOM APIs only (no `innerHTML`, no `eval`, constructable stylesheet with a `<style>` fallback). No shadows, glow or filters.
- The UI lives in `dist/flag.min.js` (about 3.2 KB gzip) and `dist/flag-card.min.js` (about 4.8 KB gzip, fetched on first expand). Both are fetched only during a session, from the folder of the loader's script URL under any file name (self-hosted or copied from `node_modules`: keep the flag files together). Inlined or bundled: set `data-stagepass-flag-base`; without a script URL and without the option they come from jsDelivr at the same version (debug sessions warn). Allow that origin in `script-src` if the site uses a strict CSP.
- Loader **2.4.0** only: during a swap session the flag chunk also bootstraps `live.min.js` (lazy EventSource client). Published **2.3.3** does not ship that chunk.

## Zero-cost production mode

Opt-in with `data-stagepass-live-src="true"` on the loader tag (loader **2.4.0**). Put a normal `src` / `href` (optional `integrity` + `crossorigin`) on `data-stagepass` assets instead of `data-src` / `data-href`. Without a session the browser loads those URLs directly; with a session Stagepass rewrites them to the local `.sp` host before classic scripts run (loader must be a sync script in `<head>` before the assets). Legacy `data-src` / `data-href` stays the default and keeps working. See [Zero-cost production mode](https://github.com/arobertherz/stagepass/blob/master/docs/loader.md#zero-cost-production-mode) for migration, SRI, and limitations.

## Permanent per-asset cache busting

`data-stagepass-nocache` is for the rare asset that must be fetched fresh on every page view, for every production visitor — not just during a Stagepass session. Typical case: a script that embeds third-party forms via iframes, where a stale cached copy breaks the embed.

```html
<script
  data-stagepass
  data-src="https://cdn.example.com/js/forms-embed.js"
  data-stagepass-nocache
></script>
```

- Boolean attribute: present (any value, including empty) or `="true"` turns it on; `="false"` turns it off (same as omitting it).
- Scoped to exactly that asset. All other `data-stagepass` assets keep the existing version-only cache strategy.
- Appends `?_cb=<Date.now()>` after any `?v=<version>` from `data-stagepass-v` / `data-stagepass-version`, preserving existing query strings and hash fragments.
- Production only. During an active local/dev swap session the asset resolves to the local `.sp` URL as usual (single `?_cb=<timestamp>` per page load, same as every other swapped file) — `data-stagepass-nocache` has no extra effect there.
- Not applied to `data-stagepass-live-src="true"` assets: that mode is intentionally zero-cost (untouched by the loader in production), so pair an asset that needs permanent busting with the default `data-src` / `data-href` mode instead.
- `data-stagepass-cachebust` remains legacy and unrelated: it no longer timestamps every production view (see above) and is not a per-asset opt-in.

## Runtime API

Preferred global is `sp` (aliases: `stagepass`, `window.stagepass`; both always assigned in 2.x). Optional custom alias via `data-stagepass-alias` when free. Types ship in `global.d.ts` (complete `sp` API with JSDoc and examples, typed `sp.on(...)` events). Add `"@stagepass/loader"` to `compilerOptions.types` (or `/// <reference types="@stagepass/loader" />`). In debug mode, after the flag chunk loads, reading `sp.vars` once hints toward the flat helpers (reads before the chunk has loaded do not hint).

Two layers (do not conflate):

1. **Endpoint / session choice:** `*.sp` vs `localhost` / `localhost:<port>` vs `debug`.
2. **`sp.env()`:** `local` only for an active `*.sp` swap session; a `localhost` / `localhost:<port>` session is `production` (since 2.3.1 / 2.3.3). `sp.vars.isLocal` remains “swap active **or** page on localhost” and is not the same question as `sp.env()`.

```js
sp.vars.isLocal     // boolean: session swap active or page on localhost (≠ sp.env())
sp.vars.env         // 'local' | 'staging' | 'production' (page/host heuristic; not sp.env())
sp.vars.domain      // active .sp domain, or page hostname when no swap
sp.vars.timestamp   // session start ms while swapping; otherwise 0
sp.vars.version     // package version (build-time)
sp.vars.client      // theme / browser / os / device / viewport / locale / capabilities

// Flat helpers (additive)
sp.env()            // 'local' | 'staging' | 'production'
                    // local = active swap to a .sp domain only
                    // staging = *.webflow.io or data-stagepass-staging-hosts
                    // else production (a localhost session is production)
sp.is('staging')
sp.can('localStorage') // also: sessionStorage, cookies, serviceWorker
sp.client('theme')     // or sp.client() for the whole object
const off = sp.on('theme', (t) => { /* prefers-color-scheme change */ })
off()
sp.use('my-module', '2.1.0', (api) => { /* register */ })

sp.resolveLocalUrl('js/app.js')  // local HTTPS URL while swapping; '' otherwise
sp.log('...') / sp.log('warn', '...') / sp.log('error', '...')
sp.warn('...')
sp.error('...')
```

Logging helpers only print while a Stagepass session is active. Deprecated globals `splog` / `spwarn` / `sperror` were removed in v2.

With an active session (or debug), the loader warns when two tagged assets resolve to the same local filename without `data-stagepass-path`.

## Related Packages

- `@stagepass/cli`: creates and manages `.sp` infrastructure.
- `@stagepass/modules`: optional modules that extend the loader (`inject`, `cookies`, `maintenance`).

## Repository

- Full docs and examples: [stagepass repository](https://github.com/arobertherz/stagepass)
