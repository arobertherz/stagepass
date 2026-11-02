# Modules

Package: `@stagepass/modules`. Load modules as **separate script tags** after `loader.min.js`. The loader does not auto-load modules via query parameters.

Modules depend on the **Loader** at runtime (they use `sp.vars` / `stagepass.vars`). Load the loader script before any module script. `inject` and `cookies` still attach their APIs without the loader (and warn); `maintenance` skips registration without the loader. For npm users, `@stagepass/modules` lists `@stagepass/loader` as a peer dependency: install the loader when you install modules.

```html
<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/inject.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/cookies.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/maintenance.min.js"></script>
```

Or the combined bundle: `all.min.js`. Prefer major pin `@2` or an exact version in production (see [loader.md](./loader.md#version-pinning)).

The modules peer range includes `>=2.0.0 || >=2.3.0-beta.0`, so a 2.3 loader prerelease satisfies it (prereleases never match a plain `>=2.0.0`).

## Available Modules

**Injector Module** (`inject.min.js`)

* Programmatic asset injection API
* Smart source resolution (local vs production)
* Flexible positioning and deduplication
* Pass-through `integrity` / `crossorigin`, optional `nonce`, optional `allowedHosts`
* Include as a separate script tag after `loader.min.js`

**Cookies Module** (`cookies.min.js`)

* Lightweight cookie utility helpers (`sp.cookies` / singular `sp.cookie`)
* Categories, `jar` / `crumbs` / `throwAll`, optional `sp.consent` hook (tool, not legal compliance)
* Event subscribe: `sp.cookies.on('bake' | 'throw', fn)`
* Include as a separate script tag after `loader.min.js`

**Maintenance Module** (`maintenance.min.js`)

* Opt-in client-side overlay for visitors (`data-stagepass-maintenance="true"`)
* Developers with an active session see the real page plus a badge
* Not access protection; does not inject `noindex`
* Include as a separate script tag after `loader.min.js`

## Injector: Programmatic Injection API

When the Injector module is loaded, use `sp.inject()` (preferred). `stagepass.inject()` and `window.stagepass.inject()` remain available as aliases:

```javascript
// Single injection
await sp.inject({
  src: 'https://cdn.example.com/lib.js',
  stagepass: true,        // Enable local swapping when active
  localPath: 'lib.js',     // Optional: local file path (defaults to filename from src)
  id: 'my-library',        // Optional: for deduplication
  position: 'head',        // 'head' | 'body-start' | 'body-end' | { target: '#id', action: 'before' | 'after' }
  type: 'script',          // Optional: 'script' | 'style' (auto-detected from extension)
  version: '2.1.0',        // Optional: in production, append ?v=<version> for cache busting
  async: false,            // Optional: default false (keeps script order)
  defer: true,             // Optional: default true (unless async is true)
  integrity: 'sha384-abc', // Optional: SRI
  crossorigin: 'anonymous', // Optional: CORS
  nonce: 'csp-nonce',       // Optional: CSP nonce
  allowedHosts: ['cdn.example.com'], // Optional: host allowlist
  attributes: {             // Optional: additional HTML attributes
    'data-foo': 'bar'
  }
});

// Batch injection (array)
await sp.inject([
  { src: 'https://cdn.example.com/lib1.js', stagepass: true, localPath: 'lib1.js', version: '2.1.0' },
  { src: 'https://cdn.example.com/lib2.css', stagepass: true, localPath: 'lib2.css', type: 'style', version: '2.1.0' }
]);

// Batch injection ({ scripts, styles })
await sp.inject({
  scripts: [{ src: 'https://cdn.example.com/lib1.js', stagepass: true, path: 'lib1.js', version: '2.1.0' }],
  styles: [{ src: 'https://cdn.example.com/lib2.css', stagepass: true, localPath: 'lib2.css', version: '2.1.0' }]
});
```

`path` is an alias for `localPath`. Deprecated `cacheBust` no longer appends production timestamps; use `version` instead. Dynamically created scripts default to `async=true` in browsers; Stagepass forces `script.async = false` (unless the original had `async`) and adds `defer` when neither async nor defer was set, matching the core loader.

## Cookies: Utility API

When the Cookies module is loaded, use `sp.cookies` (singular alias `sp.cookie`):

```javascript
sp.cookies.bake('token', 'abc123', { days: 7, path: '/' });
sp.cookie.eat('token'); // 'abc123'
sp.cookies.has('token'); // true
sp.cookies.list(); // { token: 'abc123', ... }
sp.cookies.throw('token', { path: '/' });
sp.cookies.jar(); // copy of known cookies
sp.cookies.crumbs('tok'); // known names with prefix
sp.cookies.throwAll({ category: 'analytics' });
const off = sp.cookies.on('bake', ({ name, category }) => { /* … */ });
off();
```

API reference:

* `sp.cookies.bake(name, value, options?)`  
  Creates/updates a cookie. Optional `category` is remembered; rejected consent queues the write.
* `sp.cookies.eat(name, options?)`  
  Reads a cookie value. Returns `null` when not found.
* `sp.cookies.throw(name, options?)`  
  Deletes a cookie (writes `Max-Age=0` + expired date).
* `sp.cookies.has(name)`  
  Boolean existence check.
* `sp.cookies.list(options?)`  
  Returns all visible cookies as an object map.
* `sp.cookies.throwAll({ category? })` / `jar()` / `crumbs(prefix)`
* `sp.cookies.on('bake' | 'throw', fn)`  
  Subscribe after a successful write/delete (including queued bakes flushed by consent, and each cookie in `throwAll`). Returns unsubscribe. Listener errors do not break the operation. Also available on `sp.cookie`.

`bake` options:

* `days?: number` - Expiration in days.
* `maxAge?: number` - Expiration in seconds (`Max-Age`).
* `path?: string` - Cookie path (default: `/`).
* `domain?: string` - Cookie domain.
* `secure?: boolean` - Defaults to `true` on HTTPS pages.
* `sameSite?: 'Lax' | 'Strict' | 'None'` - Default: `Lax`.
* `encode?: boolean` - URL-encode key/value (default: `true`).
* `json?: boolean` - Store value as JSON string.
* `category?: string` - Optional category for consent gating / `throwAll`.

Consent hook (tooling only, **not** legal compliance):

```javascript
sp.consent.set((category) => category !== 'marketing');
sp.consent.allows('analytics'); // true/false
sp.consent.update(); // flush queued categorized bakes
```

`eat` / `list` options:

* `decode?: boolean` - URL-decode values (default: `true`).
* `json?: boolean` - Attempt `JSON.parse` for values.

`throw` options:

* `path?: string` (default: `/`)
* `domain?: string`
* `secure?: boolean`
* `sameSite?: 'Lax' | 'Strict' | 'None'`

JSON example:

```javascript
sp.cookies.bake('profile', { id: 7, role: 'editor' }, { json: true, days: 30 });
sp.cookies.eat('profile', { json: true }); // { id: 7, role: 'editor' }
```

Notes and limitations:

* JavaScript cannot read or delete `HttpOnly` cookies.
* To reliably delete a cookie, use the same `path`/`domain` you used when writing it.
* If `sameSite: 'None'` is used, the module enforces `Secure=true` (browser requirement).
* Cookie helpers plus the optional consent hook are tools only; they are **not** a legal compliance solution.

## Maintenance overlay

Opt-in client-side overlay (`maintenance.min.js`). Not access protection; content remains in the HTML. Does not inject `noindex`.

```html
<script
  src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/maintenance.min.js"
  data-stagepass-maintenance="true"
  data-stagepass-maintenance-title="We will be back soon"
  data-stagepass-maintenance-text="Please check again shortly."
></script>
```

```javascript
sp.maintenance.enable({ title: 'We will be back soon', text: 'Please check again shortly.' });
sp.maintenance.isActive();
sp.maintenance.disable();
```

Visitors without a Stagepass session see the overlay. Developers with an active session (or `?stagepass=debug`) see the real page plus a badge.

## Declared modules in projects

`stagepass.json` lists which modules the live site loads (`[]`, named list, or `["all"]`). `stagepass new` / `upgrade` / `doctor` use that list for types and the generated `AGENTS.md` block. See [cli.md](./cli.md#declared-modules-ai-guide-and-types).
