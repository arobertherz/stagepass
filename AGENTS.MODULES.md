# Stagepass Runtime (Loader + Modules)

Profile-Version: 1.1  
Compatible with: `@stagepass/loader >= 1.2.0`, `@stagepass/modules >= 1.1.0`  
Last updated: 2026-03-10

This profile is for projects that use Stagepass Loader and Stagepass Modules (Injector + Cookies).  
Loader must be loaded before modules.

## Capability Profile
- Profile: `loader+modules`
- Runtime prerequisites:
  - Loader script must load before module scripts
  - `sp` global exists and includes module registrations

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
- `sp.resolveLocalUrl(relativePath: string): string`  
  Returns local Stagepass URL with cache-busting when session is active, otherwise `''`.
- `sp.log(...args)` and `sp.log('warn' | 'error', ...args)`
- `sp.warn(...args)`
- `sp.error(...args)`

## Modules capabilities (`sp.*`)
- Injector API:
  - `sp.inject(options | options[] | { scripts?: options[]; styles?: options[] })`
- Cookies API:
  - `sp.cookies.bake(name, value, options?)`
  - `sp.cookies.eat(name, options?)`
  - `sp.cookies.throw(name, options?)`
  - `sp.cookies.has(name)`
  - `sp.cookies.list(options?)`

## Constraints (hard limits)
- Cookies module is utility-only (`bake/eat/throw/has/list`), not consent management.
- JS cannot read/delete HttpOnly cookies.
- Cookie deletion reliability depends on matching `path`/`domain`.
- `sp.inject` supports local swap only when Stagepass local session is active.
- Browser/OS/device detection in `sp.vars.client` is heuristic (best effort).
- `sp.resolveLocalUrl(...)` may return `''` when no active Stagepass local session exists.

## Decision Rules (for AI agents)
- Prefer `sp` over `stagepass` for new code.
- Use `sp.inject` for runtime/script-style injection needs; use static tags otherwise.
- Use `cacheBust: true` only when explicitly required for production freshness.
- Use `sp.cookies.*` for browser-readable cookies; do not propose it for HttpOnly/session server cookies.
- Use `sp.vars.client.*` for runtime adaptation (theme/device/viewport checks).

## Injector option highlights
- `src` (required)
- `stagepass?: boolean` (default enabled)
- `localPath?` / `path?`
- `cacheBust?: boolean` (production cache-bust)
- `type?: 'script' | 'style'`
- `position?: 'head' | 'body-start' | 'body-end' | { target, action }`
- `id?`, `async?`, `defer?`, `attributes?`

## Canonical Examples
```js
// Runtime injection with production cache busting
await sp.inject({
  src: 'https://cdn.example.com/widget.js',
  stagepass: true,
  localPath: 'widget.js',
  cacheBust: true,
});

// Cookie utility usage
sp.cookies.bake('feature_flag', 'on', { days: 7, path: '/' });
const enabled = sp.cookies.eat('feature_flag') === 'on';
if (!enabled) sp.cookies.throw('feature_flag', { path: '/' });
```

## Deprecated aliases (still available)
- `splog(...)`, `spwarn(...)`, `sperror(...)`
