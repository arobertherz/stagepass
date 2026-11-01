# Stagepass Runtime (Loader Only)

Profile-Version: 2.0  
Compatible with: `@stagepass/loader@2.0.0`  
Last updated: 2026-11-01

This profile is for projects that use Stagepass Loader only (no `@stagepass/modules`).

## CDN (version pinning)
Prefer exact versions in production script tags (avoid floating `@1` / `@2`):

```html
<script
  src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2.0.0/dist/loader.min.js"
  data-stagepass-version="2.0.0"
></script>
```

```html
<script src="https://unpkg.com/@stagepass/loader@2.0.0/dist/loader.min.js"></script>
```

Floating majors can change behaviour on live sites without an intentional update.

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
- `sp.vars.client` (`object`) with:
  - `theme` (`preferred`, `current`)
  - `browser` (`family`, `major`, `userAgent`)
  - `os` (`family`)
  - `device` (`type`, `touch`)
  - `viewport` (`width`, `height`, `dpr`)
  - `locale` (`language`, `timezone`)
  - `capabilities` (`cookiesEnabled`, `localStorage`, `sessionStorage`)
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

## Constraints (hard limits)
- `sp.inject(...)` is not available in this profile.
- `sp.cookies.*` is not available in this profile.
- Do not assume consent/cookie-management features.
- `sp.resolveLocalUrl(...)` may return `''` when no active Stagepass local session exists.
- Browser/OS/device detection is heuristic (best effort, not a strict guarantee).

## Decision Rules (for AI agents)
- Prefer `sp` over `stagepass` for new code.
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

// Structured logging
sp.log('Loader active', { env: sp.vars.env, domain: sp.vars.domain });
```
