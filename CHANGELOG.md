# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Packages are versioned independently: `@stagepass/cli`, `@stagepass/loader`, `@stagepass/modules`.

---

## `@stagepass/cli`

### [2.0.0] - 2026-11-01

Stable release of the 2.0 line (same behaviour as `2.0.0-beta.1`).

#### Security

- Caddy site blocks no longer serve hidden path segments (`.git`, `.env`, …), `node_modules`, or common private key/cert/db/log extensions; blocked before `php_fastcgi` / `file_server`.
- CORS no longer uses blanket `Access-Control-Allow-Origin: *` by default. Allowed origins are reflected with `Vary: Origin` (local `.sp` / localhost / 127.0.0.1, plus per-project `--origin` / `projects.json`). No `Access-Control-Allow-Credentials`.
- **Breaking:** `*.webflow.io` / `*.webflow.com` are **not** in the default allowlist; add hosts via `--origin` (explicit `*.webflow.io` allowed with a warning).
- Domain and project-root inputs are validated to prevent Caddyfile injection; dangerous roots (`/`, home, `/Users`, `/System`, …) are refused.

#### Added

- Origin allowlist CORS with OPTIONS preflight (`204`), `Access-Control-Allow-Private-Network`, and configurable live domains (`--origin`, `~/.stagepass/projects.json`).
- `--allow-all-origins` / `--no-allow-all-origins` opt-in for the previous permissive CORS mode (with warnings).
- `--remove-origin <host>` (repeatable) to drop stored CORS hostnames.
- Automatic legacy Caddyfile migration on `link` / `reload` / `start` (timestamped backup, version marker `# stagepass-block: v2`; migrated blocks keep `allowAllOrigins` enabled for compatibility).
- Shared pure helpers under `src/lib/` and expanded Vitest coverage; optional Docker/`caddy adapt` integration test (skipped when unavailable).
- Tag-triggered `npm stage publish` release workflow (see `RELEASING.md`).

#### Changed

- `stagepass --version` reads the version from `packages/cli/package.json` instead of a hard-coded value.
- Generated site blocks include `# stagepass-block: v2` / `# stagepass-options: …` markers.
- Regenerating v2 blocks uses the tighter defaults and prints a tip to add `--origin` for Webflow/staging hosts.

#### Fixed

- Invalid or injectable domain names are rejected before writing the Caddyfile; folder-derived domains are slugified when needed.
- `--no-allow-all-origins` is a defined Commander option (three-state with `--allow-all-origins`; omitting both keeps stored settings).
- Re-linking a v2 site when `projects.json` lacks the domain restores CORS options from the Caddyfile marker instead of silently resetting them.

### [2.0.0-beta.1] - 2026-11-01

#### Security

- Caddy site blocks no longer serve hidden path segments (`.git`, `.env`, …), `node_modules`, or common private key/cert/db/log extensions; blocked before `php_fastcgi` / `file_server`.
- CORS no longer uses blanket `Access-Control-Allow-Origin: *` by default. Allowed origins are reflected with `Vary: Origin` (local `.sp` / localhost / 127.0.0.1, plus per-project `--origin` / `projects.json`). No `Access-Control-Allow-Credentials`.
- **Breaking:** `*.webflow.io` / `*.webflow.com` are **not** in the default allowlist; add hosts via `--origin` (explicit `*.webflow.io` allowed with a warning).
- Domain and project-root inputs are validated to prevent Caddyfile injection; dangerous roots (`/`, home, `/Users`, `/System`, …) are refused.

#### Added

- Origin allowlist CORS with OPTIONS preflight (`204`), `Access-Control-Allow-Private-Network`, and configurable live domains (`--origin`, `~/.stagepass/projects.json`).
- `--allow-all-origins` / `--no-allow-all-origins` opt-in for the previous permissive CORS mode (with warnings).
- `--remove-origin <host>` (repeatable) to drop stored CORS hostnames.
- Automatic legacy Caddyfile migration on `link` / `reload` / `start` (timestamped backup, version marker `# stagepass-block: v2`; migrated blocks keep `allowAllOrigins` enabled for compatibility).
- Shared pure helpers under `src/lib/` (`caddyfile`, `domain`, `origins`, `paths`, `projects`, `migrate`) and expanded Vitest coverage; optional Docker/`caddy adapt` integration test (skipped when unavailable).
- Tag-triggered `npm stage publish` release workflow (see `RELEASING.md`).

#### Changed

- `stagepass --version` reads the version from `packages/cli/package.json` instead of a hard-coded value.
- Generated site blocks include `# stagepass-block: v2` / `# stagepass-options: …` markers.
- Regenerating v2 blocks uses the tighter defaults and prints a tip to add `--origin` for Webflow/staging hosts.

#### Fixed

- Invalid or injectable domain names are rejected before writing the Caddyfile; folder-derived domains are slugified when needed.
- `--no-allow-all-origins` is a defined Commander option (three-state with `--allow-all-origins`; omitting both keeps stored settings).
- Re-linking a v2 site when `projects.json` lacks the domain restores CORS options from the Caddyfile marker instead of silently resetting them.

### [1.0.1] - 2026-03-10

- CORS support for linked `.sp` sites: `OPTIONS` preflight (`204`) plus `Access-Control-Allow-Methods` / `Access-Control-Allow-Headers` (committed in the 2026-03-10 release work; published as 1.0.1).

### [1.0.0] - 2026-01-19

- Initial public release: local `.sp` SSL domains via Caddy/Dnsmasq/PHP, `setup` / `start` / `stop` / `link` / `unlink` / `reload`, verbose (`-v`) logging.

---

## `@stagepass/loader`

### [2.0.0] - 2026-11-01

Stable release of the 2.0 line (same behaviour as `2.0.0-beta.1`).

#### Breaking

- No global console mute in production by default; opt in with `data-stagepass-mute-console="true"`.
- `?stagepass=` sessions expire (default 12 h; `data-stagepass-session-hours`); stored as JSON with expiry.
- `data-stagepass-cachebust="true"` no longer appends a timestamp on every production page view; use `data-stagepass-version` / `data-stagepass-v` → `?v=`.
- Injected scripts keep order (`script.async = false`).
- Removed deprecated globals `splog`, `spwarn`, `sperror`.

#### Added

- Chrome Local Network Access permission hint (`loopback-network` / `local-network-access`) before local swaps.
- Build-time `__STAGEPASS_VERSION__` from `package.json`.
- Shipped `global.d.ts` (`types` field) for `Window.stagepass` / `stagepass` / `sp`.
- Package `LICENSE` (MIT).

### [2.0.0-beta.1] - 2026-11-01

#### Breaking

- No global console mute in production by default; opt in with `data-stagepass-mute-console="true"`.
- `?stagepass=` sessions expire (default 12 h; `data-stagepass-session-hours`); stored as JSON with expiry.
- `data-stagepass-cachebust="true"` no longer appends a timestamp on every production page view; use `data-stagepass-version` / `data-stagepass-v` → `?v=`.
- Injected scripts keep order (`script.async = false`).
- Removed deprecated globals `splog`, `spwarn`, `sperror`.

#### Added

- Chrome Local Network Access permission hint (`loopback-network` / `local-network-access`) before local swaps.
- Build-time `__STAGEPASS_VERSION__` from `package.json`.
- Shipped `global.d.ts` (`types` field) for `Window.stagepass` / `stagepass` / `sp`.

### Unreleased (folded into 2.0.0-beta.1)

- Added package `LICENSE` (MIT).

### [1.2.0] - 2026-04-10

- Added `sp.vars.client` runtime info (`theme`, `browser`, `os`, `device`, `viewport`, `locale`, `capabilities`), with live updates for theme and viewport.
- Added package `README.md`.

### [1.1.4] - 2026-03-10

- Added preferred logging API: `sp.log` / `sp.warn` / `sp.error` (`splog` / `spwarn` / `sperror` deprecated).
- Added `sp.resolveLocalUrl(relativePath)` for shared local URL building.
- Added `data-stagepass-cachebust` for production cache busting.
- Removed evaluation of loader script-tag query parameters `?modules` / `?silent` (modules must be included as separate script tags).

### [1.1.3] - 2026-01-22

- Published on npm. No separate feature commit for this patch bump remains in the current repository history (same-day publishes after 1.1.1).

### [1.1.2] - 2026-01-22

- Published on npm. No separate feature commit for this patch bump remains in the current repository history (same-day publishes after 1.1.1).

### [1.1.1] - 2026-01-22

- Module loading readiness / sequential module script loading fixes (while script-tag `?modules` still existed in this line).

### [1.1.0] - 2026-01-22

- Exposed global `stagepass` (in addition to `window.stagepass`).

### [1.0.2] - 2026-01-20

- Fixed console suppression so active Stagepass sessions are not silenced incorrectly.
- Added cache-bust query (`_cb`) for locally swapped assets.

### [1.0.1] - 2026-01-20

- Package `main` points at the minified build (`dist/loader.min.js`).

### [1.0.0] - 2026-01-19

- Initial public release: `data-stagepass` asset swapping, session via `localStorage` / `?stagepass=`, debug mode, production console suppression, visual active flag.

---

## `@stagepass/modules`

### [2.0.0] - 2026-11-01

Stable release of the 2.0 line (same behaviour as `2.0.0-beta.1`).

#### Breaking

- Injected scripts keep insertion order (`async = false` unless `async: true`).
- Production `cacheBust: true` no longer appends per-view timestamps; use `version: '…'` → `?v=`.

#### Added

- Declaration merging types (`global.d.ts`) for `stagepass.inject` / `stagepass.cookies`.
- JSDoc on public cookie helpers and `inject`.

### [2.0.0-beta.1] - 2026-11-01

#### Breaking

- Injected scripts keep insertion order (`async = false` unless `async: true`).
- Production `cacheBust: true` no longer appends per-view timestamps; use `version: '…'` → `?v=`.

#### Added

- Declaration merging types (`global.d.ts`) for `stagepass.inject` / `stagepass.cookies`.
- JSDoc on public cookie helpers and `inject`.

### Unreleased (folded into 2.0.0-beta.1)

#### 1.1.1 (superseded by beta)

- Documentation only relative to published 1.1.0: package `README.md`, `LICENSE`, and version bump in `package.json`. Dist artifacts match npm 1.1.0.

### [1.1.0] - 2026-04-09

- Added Cookies utility module (`sp.cookies.bake` / `eat` / `throw` / `has` / `list`), bundled into `all.min.js`.

### [1.0.6] - 2026-03-10

- Injector uses loader `resolveLocalUrl` when available; added production `cacheBust` option.
- Declared `@stagepass/loader` peer dependency; dist files committed for CDN use.

### [1.0.5] - 2026-01-22

- Published on npm. No separate feature commit for this patch bump remains in the current repository history.

### [1.0.3] - 2026-01-22

- Published on npm. No separate feature commit for this patch bump remains in the current repository history.

### [1.0.2] - 2026-01-22

- Published on npm. No separate feature commit for this patch bump remains in the current repository history.

### [1.0.1] - 2026-01-22

- Published on npm. No separate feature commit for this patch bump remains in the current repository history.

### [1.0.0] - 2026-01-22

- Initial public release: Injector module (`sp.inject` / `inject.min.js` / `all.min.js`).
