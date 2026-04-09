# Stagepass Runtime (Loader Only)

Profile-Version: 1.0  
Compatible with: `@stagepass/loader >= 1.1.4`  
Last updated: 2026-03-10

This profile is for projects that use Stagepass Loader only (no `@stagepass/modules`).

## Capability Profile
- Profile: `loader-only`
- Runtime prerequisites:
  - Loader script is present on page
  - `sp` global exists at runtime

## Available Global API
- Preferred global: `sp`
- Backward-compatible aliases: `stagepass`, `window.stagepass`

## Capabilities (`sp.*`)
- `sp.vars.isLocal` (`boolean`)
- `sp.vars.env` (`'local' | 'staging' | 'production'`)
- `sp.vars.domain` (`string`)
- `sp.vars.timestamp` (`number`)
- `sp.vars.version` (`string`)
- `sp.resolveLocalUrl(relativePath: string): string`  
  Returns a local Stagepass URL with cache-busting when session is active, otherwise `''`.
- `sp.log(...args)` and `sp.log('warn' | 'error', ...args)`
- `sp.warn(...args)`
- `sp.error(...args)`

## Constraints (hard limits)
- `sp.inject(...)` is not available in this profile.
- `sp.cookies.*` is not available in this profile.
- Do not assume consent/cookie-management features.
- `sp.resolveLocalUrl(...)` may return `''` when no active Stagepass local session exists.

## Decision Rules (for AI agents)
- Prefer `sp` over `stagepass` for new code.
- Use `sp.resolveLocalUrl()` only when you need a local dev URL at runtime.
- Use `sp.log/sp.warn/sp.error` for Stagepass-related diagnostics.
- Do not generate code using `sp.inject` unless modules are explicitly loaded.

## Canonical Examples
```js
// Safe local URL resolution
const localUrl = sp.resolveLocalUrl('js/app.js');
if (localUrl) {
  // local dev path available
}

// Structured logging
sp.log('Loader active', { env: sp.vars.env, domain: sp.vars.domain });
```

## Deprecated aliases (still available)
- `splog(...)` -> use `sp.log(...)`
- `spwarn(...)` -> use `sp.warn(...)`
- `sperror(...)` -> use `sp.error(...)`
