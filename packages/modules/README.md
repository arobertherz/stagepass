# `@stagepass/modules`

Modular runtime extensions for Stagepass.

This package provides optional browser modules that extend `@stagepass/loader`.

## Install

```bash
npm install @stagepass/loader@2 @stagepass/modules@2
```

`@stagepass/loader` should be loaded first.  
Without the loader, `inject` and `cookies` still attach their APIs and warn; `maintenance` skips registration.  
`@stagepass/modules` declares `@stagepass/loader` as a peer dependency (`>=2.0.0`).

## CDN Usage

Prefer the major pin `@2` in production on jsDelivr. Stagepass follows strict semver: no breaking changes within v2; breaking changes only in a new major (v3). Exact pins (e.g. `@2.0.0`) are optional for maximum control. jsDelivr may cache `@2` for a while; purge with the same pattern as the loader (see root README [Version pinning](../../README.md#-version-pinning)).

```html
<script
  src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js"
  data-stagepass-version="2.0.0"
></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/inject.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/cookies.min.js"></script>
<script
  src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/maintenance.min.js"
  data-stagepass-maintenance="true"
  data-stagepass-maintenance-title="We will be back soon"
  data-stagepass-maintenance-text="Please check again shortly."
></script>
```

Or load all modules:

```html
<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/all.min.js"></script>
```

unpkg serves the same paths if you need an alternative CDN.

Published files: `dist/inject.min.js`, `dist/cookies.min.js`, `dist/maintenance.min.js`, `dist/all.min.js`.

## Available Modules

### Injector (`inject.min.js`)

Registers `sp.inject` (also `stagepass.inject`). Accepts a single options object, an array, or `{ scripts, styles }`.

```js
await sp.inject({
  src: 'https://cdn.example.com/lib.js',
  stagepass: true,
  localPath: 'lib.js',   // alias: path
  id: 'my-library',
  type: 'script',        // or 'style'; auto-detected from .css
  version: '2.0.0',      // production ?v=<version>
  async: false,          // default false (keeps order)
  defer: true,           // default true unless async is true
  position: 'head',      // 'head' | 'body-start' | 'body-end' | { target, action }
  integrity: 'sha384-abc',
  crossorigin: 'anonymous',
  nonce: 'csp-nonce',
  allowedHosts: ['cdn.example.com'],
  attributes: { 'data-foo': 'bar' },
});
```

**Options**

| Field | Description |
| :--- | :--- |
| `src` | Required production URL. |
| `type` | `'script'` \| `'style'` (default: `.css` → style, else script). |
| `stagepass` | When not `false` and `sp.vars.isLocal`, resolve a local URL via `sp.resolveLocalUrl` (fallback `https://<domain>/<path>?_cb=<timestamp>`). |
| `localPath` / `path` | Local path under the linked root (default: filename from `src`). |
| `id` | Element id; skips inject if already present. |
| `async` | If `true`, set `script.async = true`; otherwise `async = false` and keep order. |
| `defer` | Default `true` when not async; set `false` to omit defer. |
| `version` | Production cache bust: append `?v=<version>` (URL-encoded). |
| `cacheBust` | Deprecated; does **not** append per-view timestamps in v2 production. Prefer `version`. |
| `attributes` | Extra HTML attributes on the created element. |
| `integrity` | Pass-through SRI hash. |
| `crossorigin` | Pass-through CORS mode. |
| `nonce` | Optional CSP nonce. |
| `allowedHosts` | Optional host allowlist; other hosts are skipped with a warning. |
| `position` | `'head'` \| `'body-start'` \| `'body-end'` (default) \| `{ target: cssSelector, action: 'before' \| 'after' }`. |

Deduplication: skips when `id` already exists or a matching `script[src]` / `link[href]` is present. Failed items log in non-production and do not abort the rest of a batch.

### Cookies (`cookies.min.js`)

Registers `sp.cookies` and singular alias `sp.cookie`. Cookie helpers only, **not** a consent manager or legal compliance solution. A tiny optional consent hook (`sp.consent`) can gate categorized writes.

```js
sp.cookies.bake('token', 'abc123', { days: 7, path: '/' });
sp.cookie.eat('token');              // singular alias
sp.cookies.has('token');             // true
sp.cookies.list();                   // { token: 'abc123', ... }
sp.cookies.throw('token', { path: '/' });

sp.cookies.bake('analytics_id', 'x', { category: 'analytics', days: 30 });
sp.cookies.throwAll({ category: 'analytics' });
sp.cookies.jar();                    // copy of known cookies
sp.cookies.crumbs('analytics_');     // matching known names

// Consent hook (tooling only; default allows all)
sp.consent.set((category) => category !== 'marketing');
sp.cookies.bake('ad', '1', { category: 'marketing' }); // queued
sp.consent.set(() => true);
sp.consent.update(); // flushes queue
```

| Method | Description |
| :--- | :--- |
| `bake(name, value, options?)` | Write/update a cookie. Optional `category` remembers the category and may queue when consent rejects. |
| `eat(name, options?)` | Read a cookie; `null` if missing. |
| `throw(name, options?)` | Delete via `Max-Age=0` + expired date. |
| `has(name)` | Existence check. |
| `list(options?)` | All visible cookies as a name → value map. |
| `throwAll({ category? })` | Delete known cookies, optionally by category. |
| `jar()` | Shallow copy of cookies known to this helper. |
| `crumbs(prefix)` | Known cookie names starting with `prefix`. |

**`bake` options:** `days?`, `maxAge?` (seconds), `path?` (default `/`), `domain?`, `secure?` (default `true` on HTTPS), `sameSite?` (`'Lax'` \| `'Strict'` \| `'None'`, default `'Lax'`), `encode?` (default `true`), `json?`, `category?`.

**`eat` / `list` options:** `decode?` (default `true`), `json?`.

**`throw` options:** `path?` (default `/`), `domain?`, `secure?`, `sameSite?`.

Notes: `HttpOnly` cookies are invisible to JS; use the same `path`/`domain` to delete; `sameSite: 'None'` forces `Secure=true`.

### Maintenance (`maintenance.min.js`)

Client-side full-page overlay for visitors when enabled. **Not access protection**: page HTML remains in the document. This module does **not** inject `noindex`; SEO handling belongs to the site.

Off unless `data-stagepass-maintenance="true"` on the module script tag (or enabled programmatically).

```html
<script
  src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/maintenance.min.js"
  data-stagepass-maintenance="true"
  data-stagepass-maintenance-title="We will be back soon"
  data-stagepass-maintenance-text="Please check again shortly."
></script>
```

Behaviour:
- Visitors without an active Stagepass session see the overlay (text via `textContent` only; accessible `role` / focus / `aria`).
- Developers with an active session (or `?stagepass=debug`) see the real page plus a small badge.
- Respects `prefers-color-scheme`; no external resources.

```js
sp.maintenance.enable({ title: 'We will be back soon', text: 'Please check again shortly.' });
sp.maintenance.isActive(); // true
sp.maintenance.disable();
```

## Types

`global.d.ts` extends `@stagepass/loader` via declaration merging (`inject`, `cookies` / `cookie`, `consent`, `maintenance`).

## Repository

- Full docs and examples: [stagepass repository](https://github.com/arobertherz/stagepass)
- Migration: [MIGRATION.md](../../MIGRATION.md)
