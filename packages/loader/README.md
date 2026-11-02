# `@stagepass/loader`

Universal browser runtime for Stagepass.

The loader reads Stagepass session state and swaps tagged production assets with local `.sp` assets during development. It also exposes a runtime API via `sp` / `stagepass`.

## Install

```bash
npm install @stagepass/loader@2
```

## CDN Usage

Prefer the major pin `@2` in production on jsDelivr. Stagepass follows strict semver: no breaking changes within v2; breaking changes only in a new major (v3). Exact pins (e.g. `@2.2.0`) are optional for maximum control. jsDelivr may cache `@2` for a while; purge with `https://purge.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js`. See the root README [Version pinning](../../README.md#-version-pinning) section.

```html
<script
  src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js"
  data-stagepass-version="2.2.0"
></script>
```

unpkg serves the same paths if you need an alternative CDN.

See [MIGRATION.md](../../MIGRATION.md) for breaking changes from 1.x.

## What it does

- Processes `script[data-stagepass]:not([data-stagepass-processed])` and `link[rel="stylesheet"][data-stagepass]:not([data-stagepass-processed])`.
- Uses `data-src` (scripts) / `data-href` (stylesheets) as the production URL.
- Uses `data-stagepass-path` as an optional local path; if omitted while swapping, the filename is taken from the production URL.
- Inserts the new element before the original, then removes the original (`data-stagepass-processed` prevents double work).
- Local session: cache-bust with a single `?_cb=<timestamp>` per page load.
- Production: version bust with `data-stagepass-version` (loader tag) and/or `data-stagepass-v` (per asset) → `?v=<version>` (URL-encoded; existing query/hash preserved).
- `data-stagepass-cachebust="true"` is legacy and **does not** timestamp every production view in v2.
- Session expiry (default **12 h**): `data-stagepass-session-hours` on the loader tag.
- Optional legacy global console mute: `data-stagepass-mute-console="true"` (production, no session only).
- Dynamically created scripts use `async=false` unless the original had `async`; `defer` is added when neither async nor defer was set (keeps classic order).
- Chrome Local Network Access: best-effort permission query; warning in the flag card and counter, and a console hint when state is `prompt` or `denied`.

## Loader tag attributes

| Attribute | Effect |
| :--- | :--- |
| `data-stagepass-version` | Production default `?v=<version>` for swapped/tagged assets without a per-asset override. |
| `data-stagepass-session-hours` | Session lifetime in hours (positive number; default `12`). |
| `data-stagepass-mute-console="true"` | Opt-in legacy mute of `console.log/warn/error/info/debug` in production when no session. |
| `data-stagepass-staging-hosts` | Comma-separated hostnames treated as staging (in addition to `*.webflow.io`). |
| `data-stagepass-alias` | Optional custom global name (valid JS identifier). Assigned only when that global is free. |

## Asset attributes

| Attribute | Effect |
| :--- | :--- |
| `data-stagepass` | Marks the element for processing (any value). |
| `data-src` / `data-href` | Production URL (required for processing). |
| `data-stagepass-path` | Local path under the linked project root (optional). |
| `data-stagepass-v` | Per-asset production `?v=<version>` (overrides loader `data-stagepass-version`). |
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

- Card: project, session domain, files swapped locally, the latest 50 warnings and errors (time, `file:line`, text only, long messages truncated). Click a message to copy it.
- Card footer: Reload, Debug on/off (reloads with `?stagepass=debug` and back to the previous session), End session.
- Only "End session" clears the session. Esc or a click outside closes the card.
- Warnings: `sp.warn`, `sp.log('warn', …)`, loader warnings (for example the LNA hint).
- Errors: `sp.error`, `sp.log('error', …)`, uncaught errors, failed resource loads, unhandled rejections. A local file that cannot be loaded shows "Local server not reachable … Run stagepass doctor".
- Accessibility: the pill is a button with `aria-expanded`, the card a `role="dialog"`; focus moves into the card and back to the pill; reduced motion makes all changes instant.
- Rendered in an open Shadow DOM (`#stagepass-flag`) with DOM APIs only (no `innerHTML`, no `eval`, constructable stylesheet with a `<style>` fallback). No shadows, glow or filters.
- The UI lives in `dist/flag.min.js` (about 2.6 KB gzip) and `dist/flag-card.min.js` (about 3.4 KB gzip, fetched on first expand). Both are fetched only during a session, next to the loader URL (or from jsDelivr at the same version when the loader is served under another file name). Allow that origin in `script-src` if the site uses a strict CSP.

## Runtime API

Preferred global is `sp` (aliases: `stagepass`, `window.stagepass`). Optional custom alias via `data-stagepass-alias` when free. Types ship in `global.d.ts` (complete `sp` API with JSDoc and examples, typed `sp.on(...)` events). Add `"@stagepass/loader"` to `compilerOptions.types` (or `/// <reference types="@stagepass/loader" />`).

```js
sp.vars.isLocal     // boolean: session swap active or page on localhost
sp.vars.env         // 'local' | 'staging' | 'production' (localhost counts as local)
sp.vars.domain      // active .sp domain, or page hostname when no swap
sp.vars.timestamp   // session start ms while swapping; otherwise 0
sp.vars.version     // package version (build-time)
sp.vars.client      // theme / browser / os / device / viewport / locale / capabilities

// Flat helpers (additive)
sp.env()            // 'local' | 'staging' | 'production'
                    // local = active swap to a .sp domain
                    // staging = *.webflow.io or data-stagepass-staging-hosts
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
