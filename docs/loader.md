# Loader

Package: `@stagepass/loader`. Standalone browser script (no CLI dependency). CDN files live under `dist/` (`loader.min.js`, plus session-only chunks `flag.min.js`, `flag-card.min.js`, `live.min.js`).

## Version pinning

Stagepass follows strict semver within v2. For production embeds prefer an **exact** version (for example `@2.3.1`). Major aliases such as `@2` are convenient for docs and local trials, but jsDelivr may cache them for up to about 7 days after a publish.

```html
<script
  src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2.3.1/dist/loader.min.js"
  data-stagepass-version="2.3.1"
></script>
```

To force a refresh of the major alias after a release:

```text
https://purge.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js
```

Use the same purge pattern for modules (`…/@stagepass/modules@2/dist/inject.min.js`, etc.). Exact pins are unaffected the same way. See [jsDelivr purge](https://www.jsdelivr.com/documentation#purge).

Prereleases are never resolved by `@2`; pin the exact beta when testing.

## Markup

**Legacy (default):** production URL on `data-src` / `data-href`.

**Zero-cost (opt-in):** `data-stagepass-live-src="true"` on the loader tag; assets keep normal `src` / `href` (optional `integrity`). Without a session the loader does not touch them. The loader must be a sync script in `<head>` before tagged assets.

Common attributes:

| Attribute | Where | Meaning |
| --- | --- | --- |
| `data-stagepass` | asset | Mark for processing |
| `data-src` / `data-href` | asset | Production URL (legacy mode) |
| `data-stagepass-path` | asset | Local path under the `.sp` root |
| `data-stagepass-v` | asset | Production `?v=` |
| `data-stagepass-version` | loader | Default production `?v=` |
| `data-stagepass-session-hours` | loader | Session lifetime (default 12) |
| `data-stagepass-mute-console` | loader | Legacy global console mute without a session |
| `data-stagepass-staging-hosts` | loader | Extra staging hostnames |
| `data-stagepass-alias` | loader | Custom global when free |
| `data-stagepass-live-src` | loader | Opt-in zero-cost mode |
| `data-stagepass-flag-base` | loader | Folder for flag / live chunks when the loader URL is unknown |

## Session

Only `.sp` domains, `localhost`, `localhost:<port>`, or `debug` are accepted. Invalid values are cleared. Session key: `localStorage.stagepass_domain` as JSON `{ domain, expires }`.

Visitors without a session never load `flag.min.js`, `flag-card.min.js`, or `live.min.js`, and never open `/__stagepass/live`.

## Runtime API

Globals: `sp` and `stagepass` are always assigned. Prefer flat helpers:

```javascript
sp.env()                 // 'local' | 'staging' | 'production'
sp.is('staging')
sp.can('localStorage')   // sessionStorage, cookies, serviceWorker
sp.client('theme')       // or sp.client() for the whole object
const off = sp.on('theme', (t) => {})  // also: 'session'
sp.use('my-module', '2.1.0', (api) => {})
sp.resolveLocalUrl('dist/main.js')     // '' without a swap session
sp.log / sp.warn / sp.error            // only when a session is active
```

`sp.vars` remains available (frozen). In `?stagepass=debug`, reading it once hints toward the flat helpers.

## Dev chunks

While a **swap** session is active, the loader loads `flag.min.js` and `live.min.js` from the same folder as the loader script URL (or `data-stagepass-flag-base` / jsDelivr fallback). See [dev.md](./dev.md) for live reload behaviour.
