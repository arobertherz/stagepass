# `@stagepass/modules`

Modular runtime extensions for Stagepass.

This package provides optional browser modules that extend `@stagepass/loader`.

## Install

```bash
npm install @stagepass/loader@2.0.0 @stagepass/modules@2.0.0
```

`@stagepass/loader` must be loaded first.  
`@stagepass/modules` declares `@stagepass/loader` as a peer dependency (`>=2.0.0`).

## CDN Usage

Pin exact versions in production (jsDelivr preferred; unpkg works the same path layout):

```html
<script
  src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2.0.0/dist/loader.min.js"
  data-stagepass-version="2.0.0"
></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2.0.0/dist/inject.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2.0.0/dist/cookies.min.js"></script>
```

Or load all modules:

```html
<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2.0.0/dist/loader.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2.0.0/dist/all.min.js"></script>
```

Published files: `dist/inject.min.js`, `dist/cookies.min.js`, `dist/all.min.js`.

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
  attributes: { crossorigin: 'anonymous' },
});

await sp.inject([
  { src: 'https://cdn.example.com/a.js', stagepass: true, path: 'a.js', version: '2.0.0' },
  { src: 'https://cdn.example.com/b.css', stagepass: true, localPath: 'b.css', type: 'style', version: '2.0.0' },
]);

await sp.inject({
  scripts: [{ src: 'https://cdn.example.com/a.js', stagepass: true, localPath: 'a.js' }],
  styles: [{ src: 'https://cdn.example.com/b.css', stagepass: true, localPath: 'b.css' }],
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
| `position` | `'head'` \| `'body-start'` \| `'body-end'` (default) \| `{ target: cssSelector, action: 'before' \| 'after' }`. |

Deduplication: skips when `id` already exists or a matching `script[src]` / `link[href]` is present. Failed items log in non-production and do not abort the rest of a batch.

### Cookies (`cookies.min.js`)

Registers `sp.cookies` (also `stagepass.cookies`). Cookie helpers only, **not** a consent manager.

```js
sp.cookies.bake('token', 'abc123', { days: 7, path: '/' });
sp.cookies.eat('token');              // 'abc123'
sp.cookies.has('token');              // true
sp.cookies.list();                    // { token: 'abc123', ... }
sp.cookies.throw('token', { path: '/' });

sp.cookies.bake('profile', { id: 7, role: 'editor' }, { json: true, days: 30 });
sp.cookies.eat('profile', { json: true });
```

| Method | Description |
| :--- | :--- |
| `bake(name, value, options?)` | Write/update a cookie. |
| `eat(name, options?)` | Read a cookie; `null` if missing. |
| `throw(name, options?)` | Delete via `Max-Age=0` + expired date. |
| `has(name)` | Existence check. |
| `list(options?)` | All visible cookies as a name → value map. |

**`bake` options:** `days?`, `maxAge?` (seconds), `path?` (default `/`), `domain?`, `secure?` (default `true` on HTTPS), `sameSite?` (`'Lax'` \| `'Strict'` \| `'None'`, default `'Lax'`), `encode?` (default `true`), `json?`.

**`eat` / `list` options:** `decode?` (default `true`), `json?`.

**`throw` options:** `path?` (default `/`), `domain?`, `secure?`, `sameSite?`.

Notes: `HttpOnly` cookies are invisible to JS; use the same `path`/`domain` to delete; `sameSite: 'None'` forces `Secure=true`.

## Types

`global.d.ts` extends `@stagepass/loader` via declaration merging (`stagepass.inject`, `stagepass.cookies`).

## Repository

- Full docs and examples: [stagepass repository](https://github.com/arobertherz/stagepass)
- Migration: [MIGRATION.md](../../MIGRATION.md)
