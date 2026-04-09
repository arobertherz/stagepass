# Stagepass Runtime (Loader + Modules)

Profile-Version: 1.0  
Compatible with: `@stagepass/loader >= 1.1.4`, `@stagepass/modules >= 1.1.0`  
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

## Capabilities (`sp.*`)
- All Loader APIs:
  - `sp.vars.*`
  - `sp.resolveLocalUrl(relativePath)`
  - `sp.log(...)`, `sp.warn(...)`, `sp.error(...)`
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

## Decision Rules (for AI agents)
- Prefer `sp` over `stagepass` for new code.
- Use `sp.inject` for runtime/script-style injection needs; use static tags otherwise.
- Use `cacheBust: true` only when explicitly required for production freshness.
- Use `sp.cookies.*` for browser-readable cookies; do not propose it for HttpOnly/session server cookies.

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
