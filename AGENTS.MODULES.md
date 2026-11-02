# Stagepass Runtime (Loader + Modules)

Profile-Version: 2.1  
Compatible with: `@stagepass/loader@2`, `@stagepass/modules@2`  
Last updated: 2026-11-02

This profile is for projects that use Stagepass Loader and Stagepass Modules (Injector + Cookies + Maintenance).  
Loader must be loaded before modules as separate `<script>` tags (the loader does not auto-load modules via query parameters). Without the loader, `inject`/`cookies` still attach APIs and warn; `maintenance` skips registration.

## CDN (version pinning)
Prefer the major pin `@2` in production. Stagepass follows strict semver: no breaking changes within v2; breaking changes only in a new major (v3). Exact pins (e.g. `@2.2.0`) are optional for maximum control. Legacy `@1` sites are unaffected.

```html
<script
  src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js"
  data-stagepass-version="2.2.0"
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

## Capability Profile
- Profile: `loader+modules`
- Runtime prerequisites:
  - Loader script should load before module scripts
  - `sp` global exists and includes module registrations when the loader is present

## Available Global API
- Preferred global: `sp`
- Backward-compatible aliases: `stagepass`, `window.stagepass`

## Loader Runtime Contract (fully included)
This profile is a **superset** and already includes the full Loader contract.

### Loader: `sp.vars` fields
- `sp.vars.isLocal` (`boolean`)
- `sp.vars.env` (`'local' | 'staging' | 'production'`)
- `sp.vars.domain` (`string`)
- `sp.vars.timestamp` (`number`)
- `sp.vars.version` (`string`)

### Loader: `sp.vars.client` fields
- `sp.vars.client.theme.preferred` (`'light' | 'dark' | 'no-preference'`)
- `sp.vars.client.theme.current` (`'light' | 'dark' | 'unknown'`) - auto-updated
- `sp.vars.client.browser.family` (`'chrome' | 'safari' | 'firefox' | 'edge' | 'opera' | 'unknown'`)
- `sp.vars.client.browser.major` (`number | null`)
- `sp.vars.client.browser.userAgent` (`string`)
- `sp.vars.client.os.family` (`'macos' | 'windows' | 'ios' | 'android' | 'linux' | 'unknown'`)
- `sp.vars.client.device.type` (`'mobile' | 'tablet' | 'desktop' | 'unknown'`)
- `sp.vars.client.device.touch` (`boolean`)
- `sp.vars.client.viewport.width` (`number`) - auto-updated on resize
- `sp.vars.client.viewport.height` (`number`) - auto-updated on resize
- `sp.vars.client.viewport.dpr` (`number`) - auto-updated on resize
- `sp.vars.client.locale.language` (`string`)
- `sp.vars.client.locale.timezone` (`string | null`)
- `sp.vars.client.capabilities.cookiesEnabled` (`boolean`)
- `sp.vars.client.capabilities.localStorage` (`boolean`)
- `sp.vars.client.capabilities.sessionStorage` (`boolean`)

### Loader: helper/runtime functions
- `sp.env()` / `sp.is(name)` / `sp.can(capability)` / `sp.client(key?)` / `sp.on(event, fn)` / `sp.use(name, version, factory)`
- `sp.resolveLocalUrl(relativePath: string): string`  
  Returns local Stagepass URL with `?_cb=<timestamp>` when a session is active, otherwise `''`.
- `sp.log(...args)` and `sp.log('warn' | 'error', ...args)`
- `sp.warn(...args)`
- `sp.error(...args)`

## Modules capabilities (`sp.*`)
- Injector API:
  - `sp.inject(options | options[] | { scripts?: options[]; styles?: options[] })`
- Cookies API:
  - `sp.cookies` and singular alias `sp.cookie`
  - `bake` / `eat` / `throw` / `has` / `list`
  - `throwAll({ category? })` / `jar()` / `crumbs(prefix)`
  - `on('bake' | 'throw', fn)` → unsubscribe (after successful write/delete; queued bakes fire on flush)
  - Optional `category` on `bake`; consent queue via `sp.consent`
- Consent hook (tool only, not legal compliance):
  - `sp.consent.allows(category)` (default true)
  - `sp.consent.set(fn)` / `sp.consent.update()`
- Maintenance overlay:
  - `sp.maintenance.enable()` / `disable()` / `isActive()`
  - Opt-in via `data-stagepass-maintenance="true"` on the module script tag
  - Client-side overlay only (not access protection; HTML remains in the page)
  - Does not inject `noindex` (SEO belongs to the site)

## Constraints (hard limits)
- Cookies module is a utility (plus optional consent hook as a tool), not a legal consent banner.
- JS cannot read/delete HttpOnly cookies.
- Cookie deletion reliability depends on matching `path`/`domain`.
- `sp.inject` supports local swap only when Stagepass local session is active.
- Maintenance mode is a visitor overlay; developers with an active session or debug see the real page plus a badge.
- Browser/OS/device detection in `sp.vars.client` is heuristic (best effort).
- `sp.resolveLocalUrl(...)` may return `''` when no active Stagepass local session exists.

## Decision Rules (for AI agents)
- Prefer `sp` over `stagepass` for new code.
- Prefer flat helpers for env/capability checks.
- Use `sp.inject` for runtime/script-style injection needs; use static tags otherwise.
- Prefer `version: '…'` for production cache freshness (appends `?v=`). Do not rely on `cacheBust` for timestamps (deprecated / no-op for that behaviour in v2).
- Use `sp.cookies.*` / `sp.cookie.*` for browser-readable cookies; do not propose it for HttpOnly/session server cookies.
- Treat `sp.consent` as an integration hook for existing consent tools, not as compliance by itself.
- Use `sp.vars.client.*` for runtime adaptation (theme/device/viewport checks).

## Injector option highlights
- `src` (required)
- `stagepass?: boolean` (default enabled)
- `localPath?` / `path?`
- `version?: string` (production: appends `?v=<version>`)
- `cacheBust?: boolean` (deprecated; no longer appends per-view timestamps)
- `type?: 'script' | 'style'`
- `position?: 'head' | 'body-start' | 'body-end' | { target, action }`
- `id?`, `async?` (default `false`), `defer?`, `attributes?`
- `integrity?`, `crossorigin?`, `nonce?`, `allowedHosts?`
- Scripts keep insertion order unless `async: true`

## Canonical Examples
```js
// Runtime injection with production version cache busting
await sp.inject({
  src: 'https://cdn.example.com/widget.js',
  stagepass: true,
  localPath: 'widget.js',
  version: '2.1.0',
  integrity: 'sha384-abc',
  crossorigin: 'anonymous',
  allowedHosts: ['cdn.example.com'],
});

// Cookie utility + category/consent hook (tool, not legal compliance)
sp.consent.set((category) => category !== 'marketing');
sp.cookies.bake('feature_flag', 'on', { days: 7, path: '/', category: 'analytics' });
sp.consent.update();
const enabled = sp.cookie.eat('feature_flag') === 'on';
if (!enabled) sp.cookies.throw('feature_flag', { path: '/' });

// Maintenance (client-side overlay only)
sp.maintenance.enable({ title: 'We will be back soon', text: 'Please check again shortly.' });
```

## Removed / changed in v2
- `splog(...)`, `spwarn(...)`, `sperror(...)`: use `sp.log` / `sp.warn` / `sp.error`
- Inject `cacheBust: true` no longer appends per-view timestamps; use `version: '…'`
