# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Packages are versioned independently: `@stagepass/cli`, `@stagepass/loader`, `@stagepass/modules`.

---

## `@stagepass/cli`

### Unreleased

#### 1.0.2 (not yet published; npm latest is 1.0.1)

- Documentation only relative to published 1.0.1: package `README.md`, root/package `LICENSE`, and version bump in `package.json`. No CLI source changes.

### [1.0.1] - 2026-03-10

- CORS support for linked `.sp` sites: `OPTIONS` preflight (`204`) plus `Access-Control-Allow-Methods` / `Access-Control-Allow-Headers` (committed in the 2026-03-10 release work; published as 1.0.1).

### [1.0.0] - 2026-01-19

- Initial public release: local `.sp` SSL domains via Caddy/Dnsmasq/PHP, `setup` / `start` / `stop` / `link` / `unlink` / `reload`, verbose (`-v`) logging.

---

## `@stagepass/loader`

### Unreleased

- Added package `LICENSE` (MIT). No runtime/code changes since published 1.2.0.

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

### Unreleased

#### 1.1.1 (not yet published; npm latest is 1.1.0)

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
