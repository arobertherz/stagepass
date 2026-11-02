# Loader

Package: `@stagepass/loader`. Standalone browser script (no CLI dependency). CDN files live under `dist/` (`loader.min.js`, plus session-only chunks `flag.min.js`, `flag-card.min.js`, `live.min.js`).

## Version pinning

Stagepass follows strict semver: **no breaking changes within v2**; breaking changes only land in a new major (v3). For production CDN embeds, pin the **major** (`@2`), or an **exact** version when you want to freeze one publish and avoid alias caching.

### Recommended (`@2`)

```html
<script
  src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js"
  data-stagepass-version="2.3.1"
></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/inject.min.js"></script>
```

unpkg serves the same paths if you need an alternative CDN.

See [MIGRATION.md](../MIGRATION.md) for breaking changes from 1.x. `stagepass doctor` warns on unpinned CDN URLs (`@latest`, bare major `@1`, or bare package with no version).

### Optional exact pin

For maximum control (freeze one publish), use an exact version such as `@2.3.1`:

```html
<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2.3.1/dist/loader.min.js"></script>
```

jsDelivr may cache alias versions such as `@2` for a while after a new publish (often up to about 7 days). Exact pins are not affected the same way. To force a refresh of the major alias, purge:

```text
https://purge.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js
```

Use the same purge URL pattern for modules (replace the package path). Details: [jsDelivr purge](https://www.jsdelivr.com/documentation#purge).

### Legacy 1.x (still valid if you pin it)

Sites that keep `@1` / exact `1.x` pins are unaffected by 2.x:

```html
<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@1.2.0/dist/loader.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@1.1.0/dist/inject.min.js"></script>
```

Why `@2`:

* **Compatible updates**: minor/patch releases within v2 stay backward compatible under strict semver.
* **One intentional major bump**: breaking changes require a new major (v3) and a deliberate URL change.
* **Exact pin when needed**: use `@2.3.1` (or any exact version) for maximum control; prereleases are never resolved by `@2` (pin the exact beta, e.g. `@2.3.0-beta.4`).

## Markup

**Legacy (default):** production URL on `data-src` / `data-href`.

**Zero-cost (opt-in):** `data-stagepass-live-src="true"` on the loader tag; assets keep normal `src` / `href` (optional `integrity`). Without a session the loader does not touch them. The loader must be a sync script in `<head>` before tagged assets. Full behaviour: [Zero-cost production mode](#zero-cost-production-mode).

### Attribute reference

| Attribute | Where | Meaning |
| --- | --- | --- |
| `data-stagepass` | asset | Marks the element for processing (presence is enough; `"true"` is conventional) |
| `data-src` / `data-href` | asset | Production URL (legacy mode; loaded by default for all users) |
| `data-stagepass-path` | asset | Relative path on the local `.sp` root (optional; if omitted while swapping, the filename is extracted from the production URL) |
| `data-stagepass-v` | asset | Production appends `?v=<version>` |
| `data-stagepass-version` | loader | Default production `?v=` for assets without a per-asset override |
| `data-stagepass-session-hours` | loader | Session lifetime in hours (default `12`) |
| `data-stagepass-mute-console="true"` | loader | Opt-in legacy global console mute in production when no session |
| `data-stagepass-cachebust="true"` | asset/legacy | Legacy; no longer timestamps every production page view |
| `data-stagepass-staging-hosts` | loader | Comma-separated hostnames treated as staging (in addition to `*.webflow.io`) |
| `data-stagepass-alias` | loader | Custom global alias (valid JS identifier; assigned only when free) |
| `data-stagepass-live-src="true"` | loader | Opt-in zero-cost mode (native `src` / `href` instead of `data-src` / `data-href`) |
| `data-stagepass-flag-base` | loader | Optional folder for `flag.min.js`, `flag-card.min.js`, and `live.min.js` when the loader is inlined or bundled. Only `http(s)` or relative URLs; anything else is ignored with a warning. Read only during a session. Also: `window.stagepassFlagBase` before the loader runs. |
| `data-stagepass-processed` | asset | Internal flag set after processing (prevents double-processing) |

Selectors:

* Scripts: `script[data-stagepass]:not([data-stagepass-processed])`
* Stylesheets: `link[rel="stylesheet"][data-stagepass]:not([data-stagepass-processed])`

## Session

Only `.sp` domains, `localhost`, `localhost:<port>`, or `debug` are accepted. Invalid values are cleared from `localStorage`. Session key: `localStorage.stagepass_domain` as JSON `{ domain, expires }` (legacy plain-string values are cleared).

Visitors without a session never load `flag.min.js`, `flag-card.min.js`, or `live.min.js`, and never open `/__stagepass/live`.

URL parameters:

* `?stagepass=<domain.sp>`: activate local swapping
* `?stagepass=debug`: debug mode (no asset swapping, logging only)
* `?stagepass=off` / `?stagepass=0` / `?stagepass=false`: deactivate session

Parameters are removed from the URL after processing via `window.history.replaceState()`.

### Dev flag

While a session is active, a small pass-icon pill appears fixed in the top-right corner. Visitors without a session never see it and never download its code.

| Stage | Flag |
| --- | --- |
| Rest | pill with a status dot (amber: warnings, red: errors) |
| Hover or keyboard focus | expands to the left: `LOCAL` (`?stagepass=my-project.sp`) or `DEBUG` (`?stagepass=debug`), plus warning and error counters |
| Click | session card |

* On touch devices the first tap expands the pill and the second opens the card.
* The card shows the project, the session domain, a collapsed list of the swapped files (live → local, `js`/`css`, status `ok`, `404` or `failed`) and the latest 50 warnings and errors. Each message is a one-line row (repeats grouped as `×N` with the last time); click it for the details: source (`local`, `live` or `external`), `file:line:col` and the stack. **Always expanded** keeps all details open (remembered per site). **Copy all** and the per-message **Copy** button copy a Markdown report (page URL without query, project, loader version, messages). The footer has Reload, **Debug mode** / **Back to local** and End session. Without a local session to return to, the toggle is disabled and the card says why.
* Locally swapped files load with `crossorigin="anonymous"`, so their errors keep message, location and stack (the Stagepass dev server sends the CORS header). If a local server sends no CORS header, the file loads again without it and the card says so. Errors from other origins without CORS show as "Error in a cross-origin script (details only in DevTools console)".
* Only **End session** clears the session (same as `?stagepass=off`). Esc or a click outside just closes the card.
* Warnings count `sp.warn(...)`, `sp.log('warn', ...)` and `console.warn(...)` on the page, plus loader warnings.
* Errors count `sp.error(...)`, `sp.log('error', ...)`, `console.error(...)`, uncaught errors, failed resource loads and unhandled promise rejections on the page. A missing local file shows "Local file not found (404)". When the local dev server cannot be reached, the card says "Local server not reachable", suggests `stagepass doctor` and, if Chrome blocks local network access, adds that hint.
* Messages are always shown as plain text. Counters above 99 show `99+`.
* The flag renders in a Shadow DOM, so site CSS cannot restyle it and it cannot restyle the site. It is keyboard accessible, and with `prefers-reduced-motion` all changes are instant.
* The flag UI ships as two separate files, `dist/flag.min.js` and `dist/flag-card.min.js` (the card loads on first expand). Both are fetched only during a session, from the folder of the loader's own script URL, whatever the file is called (for example `…/@stagepass/loader@2/dist/flag.min.js`, or `/js/flag.min.js` next to a self-hosted `/js/stagepass.js`). When you self-host or copy the loader from `node_modules/@stagepass/loader/dist/`, copy both flag files (and `live.min.js`) into the same folder and everything stays on your server.
* Inlined or bundled loader: set `data-stagepass-flag-base="/assets/stagepass/"` on the script tag (or `window.stagepassFlagBase` before the loader runs). Without a script URL and without the option, the flag files load from jsDelivr at the loader's exact version, and debug sessions show a warning.
* With a strict Content Security Policy, `script-src` must allow the origin of the flag files (for jsDelivr: `https://cdn.jsdelivr.net`). If they are blocked, swapping still works and the console shows a warning.

## Zero-cost production mode

Opt-in so production visitors load normal `src` / `href` tags (and optional SRI) without depending on the loader to rewrite them. The swap runtime only runs while a Stagepass session is active. Default markup stays `data-src` / `data-href` (unchanged).

**Requirements**

* Loader tag is a classic synchronous script in `<head>` **before** tagged assets.
* Opt-in: `data-stagepass-live-src="true"` on the loader tag.
* Assets: `data-stagepass` plus a normal `src` (scripts) or `href` (stylesheets). Do **not** set `data-src` / `data-href` on those tags.

```html
<script
  src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js"
  data-stagepass-live-src="true"
></script>
<script
  data-stagepass
  src="https://cdn.example.com/js/app.min.js"
  integrity="sha384-…"
  crossorigin="anonymous"
  data-stagepass-path="js/app.js"
></script>
<link
  rel="stylesheet"
  data-stagepass
  href="https://cdn.example.com/css/app.css"
  integrity="sha384-…"
  crossorigin="anonymous"
  data-stagepass-path="css/app.css"
/>
```

**Migration from `data-src`**

1. Add `data-stagepass-live-src="true"` on the loader tag.
2. Move each production URL from `data-src` / `data-href` to `src` / `href`.
3. Keep `data-stagepass` and optional `data-stagepass-path` / `data-stagepass-v`.
4. Optionally add `integrity` (and `crossorigin="anonymous"`) from your build manifest.

**Behaviour**

* No session: the browser loads production URLs as usual; the loader does not rewrite those tags and does not fetch the flag chunks.
* Active session: tags are rewritten to `https://<domain.sp>/…` before classic scripts run. `integrity` is removed (local files will not match production hashes). `crossorigin="anonymous"` is set when missing (same as legacy swap).
* Chromium / WebKit: `MutationObserver` before the parser prepares the script. Firefox: `beforescriptexecute` (may still fetch the production URL, but must not execute it).

**Limitations**

* The loader must appear synchronously before tagged assets. If a script is already executing when seen, Stagepass skips the rewrite silently.
* Firefox may remove `beforescriptexecute` in a future release; watch release notes if you rely on live-src there.
* Mixed pages can keep legacy `data-src` tags alongside live-src tags; both work when the opt-in is on.

**Integrity from the build manifest**

After `stagepass build` (or your own hashed build), copy the file digest into the tag, for example:

```html
<script
  data-stagepass
  src="https://cdn.example.com/js/app.abc123.js"
  integrity="sha256-<base64-from-manifest>"
  crossorigin="anonymous"
></script>
```

Scaffolded projects write SRI `integrity` (sha384) per file in `dist/manifest.json`. Use `crossorigin="anonymous"` whenever `integrity` is set on a cross-origin URL. During a local session Stagepass strips `integrity` on the swapped element (legacy swap and live-src alike).

## Loader Runtime API

### Global Variables (`sp.vars`)

Access runtime information via `sp.vars` (preferred), or `stagepass.vars` / `window.stagepass.vars`:

```javascript
sp.vars.isLocal     // boolean - true if Stagepass active or localhost
sp.vars.env         // 'local' | 'staging' | 'production'
sp.vars.domain      // string - Current domain (local or production)
sp.vars.timestamp   // number - Session start time (for cache-busting)
sp.vars.version     // string - Loader version
sp.vars.client      // object - Client runtime info (theme/browser/os/device/viewport/locale/capabilities)
```

Optional loader attributes: `data-stagepass-staging-hosts`, `data-stagepass-alias` (custom global when free), `data-stagepass-live-src="true"` (zero-cost mode).

`sp` and `stagepass` are always assigned (2.x compatibility). Prefer the flat helpers below for new code. In `?stagepass=debug`, after the flag chunk has loaded, reading `sp.vars` once logs a one-time hint: prefer `sp.env()` / `is()` / `can()` / `client()` / `on()` over reading `sp.vars` directly. Reads before the flag chunk loads simply do not hint. `vars` stays frozen. Client detection stays eager (2.0.0 behaviour).

### Flat helpers

```javascript
sp.env()                 // 'local' | 'staging' | 'production'
                         // local = active swap session to a .sp domain
                         // staging = *.webflow.io or data-stagepass-staging-hosts
                         // else production (independent of vars.env localhost semantics)
sp.is('staging')         // boolean
sp.can('localStorage')   // also: sessionStorage, cookies, serviceWorker
sp.client('theme')       // or sp.client() for the whole object
const off = sp.on('theme', (t) => {})  // also: 'session'; returns unsubscribe
off()
sp.use('my-module', '2.1.0', (api) => { /* register */ })
```

### Client Runtime Info (`sp.vars.client`)

The loader exposes technical client/runtime data:

```javascript
sp.vars.client.theme.preferred   // 'light' | 'dark' | 'no-preference'
sp.vars.client.theme.current     // 'light' | 'dark' | 'unknown' (auto-updated)
sp.vars.client.browser.family    // 'chrome' | 'safari' | 'firefox' | 'edge' | 'opera' | 'unknown'
sp.vars.client.browser.major     // number | null
sp.vars.client.os.family         // 'macos' | 'windows' | 'ios' | 'android' | 'linux' | 'unknown'
sp.vars.client.device.type       // 'mobile' | 'tablet' | 'desktop' | 'unknown'
sp.vars.client.device.touch      // boolean
sp.vars.client.viewport.width    // number (auto-updated on resize)
sp.vars.client.viewport.height   // number (auto-updated on resize)
sp.vars.client.viewport.dpr      // number (auto-updated on resize)
sp.vars.client.locale.language   // string (e.g. 'de-DE')
sp.vars.client.locale.timezone   // string | null
sp.vars.client.capabilities.cookiesEnabled // boolean
sp.vars.client.capabilities.localStorage   // boolean
sp.vars.client.capabilities.sessionStorage // boolean
```

Notes:

* Browser/OS/device detection is heuristic (best effort).
* `client` values are runtime data, not analytics consent/tracking signals.
* `theme.current` and `viewport.*` are refreshed while the page is running.

### Local URL helper (`sp.resolveLocalUrl`)

The loader exposes a single place to build local asset URLs (used by modules and by custom code):

```javascript
// Returns local URL when a Stagepass session is active, otherwise ''
sp.resolveLocalUrl('js/app.js');   // e.g. 'https://my-project.sp/js/app.js?_cb=1234567890'
sp.resolveLocalUrl('/lib.js');     // leading slash is normalized
```

While a local session is active, swapped assets use a single `?_cb=<timestamp>` per page load. In production, use `data-stagepass-version` (loader) or `data-stagepass-v` (asset) to append `?v=<version>`.

### Logging API

Stagepass provides a structured logging API that wraps the browser console when a Stagepass session is active:

```javascript
// Preferred API
sp.log('Hello from Stagepass');          // info / log
sp.log('warn', 'Something looks off');   // warn level
sp.log('error', 'Something went wrong'); // error level

sp.warn('This is a warning');
sp.error('This is an error');
```

`sp.log` automatically prefixes messages with a timestamp and (if available) the calling file and line, e.g. `[🎫 11:58:02 | app.js:830]`. Logging is only active when a Stagepass session is enabled; otherwise the helper functions are effectively no-ops. The deprecated globals `splog` / `spwarn` / `sperror` were **removed in v2**.

With an active session or debug mode, after the flag chunk loads, the loader warns when two tagged assets resolve to the same local filename without `data-stagepass-path`.

## Security Architecture

Stagepass does not allow arbitrary remote injection. Controls exist in both the loader and the CLI:

1. **Session domains:** The loader only accepts `*.sp`, `localhost`, `localhost:<port>`, or `debug`. Invalid values are cleared from `localStorage`.
2. **Asset tagging:** Tagged elements use `data-src` / `data-href` (or live-src `src` / `href`) as the production source of truth; originals are removed after the replacement is inserted (no double-load).
3. **No session → production URLs:** Without an active session, tagged assets keep production URLs (optional `?v=` from `data-stagepass-version` / `data-stagepass-v`). Live-src tags are left untouched.
4. **Quiet Stagepass logs:** `sp.log` / `sp.warn` / `sp.error` are no-ops without a session; the global console is not muted unless `data-stagepass-mute-console="true"`.
5. **Caddy CORS + path blocking:** Linked `.sp` sites reflect ACAO only for the allowlist (local `.sp` / localhost / `127.0.0.1` plus `--origin`); blocked paths (`.git`, `.env`, `node_modules`, key/cert/db/log extensions) always 404. No `Access-Control-Allow-Credentials`.
6. **Integrity during swap:** Local rewrites strip `integrity` (production hashes will not match local files).
7. **Live reload:** `/__stagepass/live` is loopback-only behind Caddy; visitors without a session never open it. See [dev.md](./dev.md#security-notes).

More CLI security notes: [`packages/cli/README.md`](../packages/cli/README.md).

## Dev chunks

While a session is active, the loader loads `flag.min.js` from the same folder as the loader script URL (or `data-stagepass-flag-base` / jsDelivr fallback). During a **swap** session (not debug), the flag chunk then appends `live.min.js` from the same folder as `flag-card.min.js`. `live.min.js` opens EventSource to `https://<domain.sp>/__stagepass/live` for CSS cache-bust without reload and full reload on JS; it closes after the first error when `stagepass dev` is not running. Never loaded without a session. See [dev.md](./dev.md) for live reload behaviour.
