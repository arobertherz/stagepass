# Migrating from Stagepass 1.x to 2.0

This guide covers every breaking change in **2.0.0**. Sites that keep using `@1` / exact `1.x` CDN URLs are unaffected until you opt in.

Prefer the major pin `@2` (strict semver within v2; breaking changes only in a new major). Exact `@2.1.0` is optional for maximum control:

```html
<script
  src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js"
  data-stagepass-version="2.1.0"
></script>
```

unpkg serves the same paths if you need an alternative CDN.

---

## 1. CORS is no longer allow-all by default

**Before (1.x / early security WIP):** new links could behave permissively, or defaults included broad wildcards.

**After (2.0):** new `stagepass link` projects use an **origin allowlist**. Allow-all is only via explicit opt-in:

```bash
stagepass link --allow-all-origins   # emergency / migration only (prints a warning)
```

**What to do:** Prefer listing your live hosts:

```bash
stagepass link --origin my-project.webflow.io --origin www.example.com
stagepass link --no-allow-all-origins
```

Legacy Caddy blocks migrated by the CLI keep `allowAllOrigins` enabled for compatibility (timestamped backup under `~/.stagepass/`). Switch them off after adding `--origin` entries.

---

## 2. `*.webflow.io` / `*.webflow.com` are no longer default

**Before:** default CORS allowlist included `https://*.webflow.io` and `https://*.webflow.com`.

**After:** defaults are local only (`https://*.sp`, `localhost`, `127.0.0.1`) plus per-project `--origin` values.

**What to do:** Add each staging/live host you need:

```bash
stagepass link --origin my-project.webflow.io
```

An explicit `--origin *.webflow.io` is still accepted but prints a warning (any Webflow user's site would then be allowed). Prefer the exact subdomain.

---

## 3. Dotfiles, `.git`, and `node_modules` return 404

**Before:** Caddy could serve sensitive paths under the project root.

**After:** Any path segment starting with `.`, plus `node_modules` and common key/cert/db/log extensions, always return **404** (including OPTIONS), even with `--allow-all-origins`.

**What to do:** Do not rely on serving `.env`, `.git`, or `node_modules` over `.sp`. Keep secrets out of the web root.

---

## 4. Invalid `.sp` domain names are rejected by `link`

**Before:** Some unsafe folder-derived or injectable names could reach the Caddyfile.

**After:** Domains must be DNS-safe labels ending in `.sp`. Folder names are slugified when the domain argument is omitted; injection attempts are rejected.

**What to do:** Use a clean domain (`my-project.sp`). If `link` slugifies your folder name, use the printed domain going forward.

---

## 5. Production console is no longer muted globally

**Before:** Without a Stagepass session, the loader replaced `console.log` / `warn` / `error` / … with no-ops in production.

**After:** Only Stagepass' own `sp.log` / `sp.warn` / `sp.error` output is gated on an active session. The global console is left alone.

**What to do:** If you still want the old mute, opt in on the loader tag:

```html
<script
  src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js"
  data-stagepass-mute-console="true"
></script>
```

---

## 6. `?stagepass=` activation expires (default 12 h)

**Before:** `localStorage.stagepass_domain` stored a permanent plain string.

**After:** The session is a JSON object with an expiry (default **12 hours**). Legacy/malformed/expired values are cleared. `?stagepass=off` / `0` / `false` still disconnects.

**What to do:** Re-activate with `?stagepass=my-project.sp` after expiry. Optional lifetime:

```html
<script
  src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js"
  data-stagepass-session-hours="24"
></script>
```

---

## 7. `data-stagepass-cachebust="true"` no longer timestamps every production view

**Before:** In production, `data-stagepass-cachebust="true"` appended `?_cb=<Date.now()>` on every page load.

**After:** Production cache busting uses a **version** string:

- `data-stagepass-version` on the loader tag, and/or
- `data-stagepass-v` on an individual asset

Both append `?v=<version>` (URL-encoded; existing query/hash preserved). Per-request `?_cb=<timestamp>` applies only while a Stagepass session is swapping to local assets.

**What to do:**

```html
<script
  src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js"
  data-stagepass-version="2026-11-01"
></script>
<script
  data-stagepass
  data-src="https://cdn.example.com/app.js"
  data-stagepass-v="2026-11-01"
></script>
```

Bump the version when you publish new production assets.

---

## 8. Injected scripts execute in insertion order

**Before:** Dynamically created scripts often ran with the browser default `async = true`, so order was not guaranteed.

**After:** The loader and `@stagepass/modules` inject set `script.async = false` (unless the original/`async: true` opted into async). Classic scripts keep document order.

**What to do:** Usually nothing. If you relied on races, fix load-order assumptions in your own code.

---

## 9. `splog`, `spwarn`, `sperror` are removed

**Before:** Deprecated globals aliased `sp.log` / `sp.warn` / `sp.error`.

**After:** Only `sp` / `stagepass` / `window.stagepass` logging APIs remain.

**What to do:** Replace:

```js
// before
splog('hello');
spwarn('careful');
sperror('fail');

// after
sp.log('hello');
sp.warn('careful');
sp.error('fail');
```

---

## CLI install

```bash
npm install -g @stagepass/cli@2
```

`stagepass --version` should print a 2.x version (e.g. `2.1.0`).

## Modules

```html
<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/inject.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/cookies.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/maintenance.min.js"></script>
```

Injector option `cacheBust: true` no longer appends timestamps in production; use `version: '…'` instead.
