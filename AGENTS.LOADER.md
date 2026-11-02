# Stagepass Runtime (Loader Only)

Profile-Version: 2.1  
Compatible with: `@stagepass/loader@2`  
Last updated: 2026-11-02

This profile is for projects that use Stagepass Loader only (no `@stagepass/modules`).

## CDN (version pinning)
Prefer the major pin `@2` in production. Stagepass follows strict semver: no breaking changes within v2; breaking changes only in a new major (v3). Exact pins (e.g. `@2.3.0`) are optional for maximum control. Legacy `@1` sites are unaffected.

```html
<script
  src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js"
  data-stagepass-version="2.2.0"
></script>
```

unpkg serves the same paths if you need an alternative CDN.

Optional loader attributes:
- `data-stagepass-staging-hosts="preview.example.com,staging.example.com"`
- `data-stagepass-alias="$sp"` (valid identifier; assigned only when that global is free)
- `data-stagepass-live-src="true"` (zero-cost production mode: native `src`/`href` on tagged assets)

## Capability Profile
- Profile: `loader-only`
- Runtime prerequisites:
  - Loader script is present on page
  - `sp` global exists at runtime

## Available Global API
- Preferred global: `sp`
- Backward-compatible aliases: `stagepass`, `window.stagepass` (always assigned in 2.x)
- Optional custom alias via `data-stagepass-alias` when free

## Capabilities (`sp.*`)
- `sp.vars.isLocal` (`boolean`)
- `sp.vars.env` (`'local' | 'staging' | 'production'`)
- `sp.vars.domain` (`string`)
- `sp.vars.timestamp` (`number`)
- `sp.vars.version` (`string`)
- `sp.vars.client` (`object`) with:
  - `theme` (`preferred`, `current`)
  - `browser` (`family`, `major`, `userAgent`)
  - `os` (`family`)
  - `device` (`type`, `touch`)
  - `viewport` (`width`, `height`, `dpr`)
  - `locale` (`language`, `timezone`)
  - `capabilities` (`cookiesEnabled`, `localStorage`, `sessionStorage`)
- Flat helpers:
  - `sp.env()` → `'local' | 'staging' | 'production'` (`local` = active `.sp` swap session)
  - `sp.is(name)`
  - `sp.can('localStorage' | 'sessionStorage' | 'cookies' | 'serviceWorker' | …)`
  - `sp.client(key?)`
  - `sp.on('theme' | 'session', fn)` → unsubscribe
  - `sp.use(name, version, factory)` module registry (major check)
- `sp.resolveLocalUrl(relativePath: string): string`  
  Returns a local Stagepass URL with `?_cb=<timestamp>` when a session is active, otherwise `''`.
- `sp.log(...args)` and `sp.log('warn' | 'error', ...args)`
- `sp.warn(...args)`
- `sp.error(...args)`

## v2 behaviour notes
- Sessions expire (default 12 h; `data-stagepass-session-hours` on the loader tag).
- Production cache busting uses `data-stagepass-version` / `data-stagepass-v` → `?v=` (not per-view timestamps).
- No global console mute by default; opt in with `data-stagepass-mute-console="true"`.
- Injected scripts keep order (`async = false` unless the original had `async`).
- `splog` / `spwarn` / `sperror` are removed.
- With an active session, duplicate local filenames (no `data-stagepass-path`) emit a debug warning.
- Zero-cost mode (`data-stagepass-live-src="true"`): production uses native `src`/`href` (optional `integrity`); swap only while a session is active. Loader must be sync in `<head>` before tagged assets. Prefer flat helpers over reading `sp.vars` (one-time hint in debug mode).

## Constraints (hard limits)
- `sp.inject(...)` is not available in this profile.
- `sp.cookies.*` / `sp.maintenance` are not available in this profile.
- Do not assume consent/cookie-management features.
- `sp.resolveLocalUrl(...)` may return `''` when no active Stagepass local session exists.
- Browser/OS/device detection is heuristic (best effort, not a strict guarantee).

## Decision Rules (for AI agents)
- Prefer `sp` over `stagepass` for new code.
- Prefer flat helpers (`sp.env()`, `sp.is()`, `sp.can()`, `sp.client()`) for new code.
- Use `sp.resolveLocalUrl()` only when you need a local dev URL at runtime.
- Use `sp.vars.client.*` for runtime adaptation (theme/device/viewport checks).
- Use `sp.log/sp.warn/sp.error` for Stagepass-related diagnostics.
- Do not generate code using `sp.inject` unless modules are explicitly loaded.

## Canonical Examples
```js
// Safe local URL resolution
const localUrl = sp.resolveLocalUrl('js/app.js');
if (localUrl) {
  // local dev path available
}

// Flat helpers
if (sp.is('staging') || sp.env() === 'production') {
  // …
}
if (sp.can('localStorage')) {
  // …
}

// Structured logging
sp.log('Loader active', { env: sp.vars.env, domain: sp.vars.domain });
```
