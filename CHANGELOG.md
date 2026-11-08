# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Packages are versioned independently: `@stagepass/cli`, `@stagepass/loader`, `@stagepass/modules`.

---

## Unreleased

---

## `@stagepass/cli`

### [2.2.7] - 2026-11-08

Patch release of the CLI only. `@stagepass/loader` stays at **2.4.0**; `@stagepass/modules` latest **2.2.0** / next **2.2.2** are unchanged. `engines.node` remains `>=18.0.0`. No dependency major bumps.

#### Fixed

- LaunchAgent autostart embeds a validated Homebrew `PATH` (`brew --prefix` bin/sbin + launchd minimal dirs) so login/`daemon` can resolve `caddy` on Apple Silicon and Intel. PATH shims must live in `prefix/bin` or `prefix/sbin`; Cellar realpaths under the same prefix are accepted. Prerequisites are validated before the plist is written.
- Ora spinners no longer treat TTY width `0` / invalid / live resize-to-zero as usable geometry (avoids runaway ANSI clears).
- `stagepass start` closes the parent logfile FD after `caddy start` (execa@8 does not hang when a daemon grandchild inherits the log handles).
- `stagepass start` no longer runs unconditional `sudo -v` or a `sudo lsof | …` shell pipeline. Port 443 is inspected with argv `lsof` (no sudo). Conflicting listeners are signalled only after confirmation: **SIGTERM** first, **SIGKILL** only after a separate confirm if still listening. Non-interactive runs refuse to signal. Privilege (`sudo kill` / `apachectl`) is used only when the confirmed operation needs it.
- When a LaunchAgent plist is installed, `start` bootstraps if needed then `launchctl kickstart` (falls back to direct `caddy start`). `stop` `launchctl bootout`s first (until next login) before stopping Caddy/PHP. PHP `brew services` behaviour is unchanged.

#### Docs

- Autostart / Homebrew PATH / permission / start–stop LaunchAgent contract; `RELEASING.md` single-package `cli-v*` → stage `next` → 2FA approve → explicit `latest`. Bundled offline snippet constant stays lockstep with this release line (`2.2.2`); `new`/`upgrade` still resolve live loader pins from the registry (currently 2.4.0).

### [2.2.6] - 2026-11-06

Patch release of the CLI only. At publish time `@stagepass/loader` and `@stagepass/modules` were 2.2.0; `STAGEPASS_PACKAGES_VERSION` later tracks 2.2.2 without a CLI version bump.

#### Fixed

- Registry and `node_modules` version strings with leading or trailing whitespace are no longer treated as stable semver. `parseSemver` checks the raw value; padded entries are ignored so snippets and `upgrade` ranges stay clean `X.Y.Z` / `^X.Y.Z`.

### [2.2.5] - 2026-11-05

Patch release of the CLI only. `@stagepass/loader` and `@stagepass/modules` stay at 2.2.0.

#### Fixed

- `stagepass upgrade --version`: the loader pin is resolved before any file is written. If it cannot be resolved (version not published for the loader, registry offline), the command exits 1 and leaves `package.json` and project files unchanged.

### [2.2.4] - 2026-11-05

Patch release of the CLI only. `@stagepass/loader` and `@stagepass/modules` stay at 2.2.0.

#### Fixed

- `stagepass upgrade --version <v>` now pins the Webflow snippet (`data-stagepass-version` and the exact-pin hint) to that loader version even when `package.json` lists only `@stagepass/modules`.

### [2.2.3] - 2026-11-05

Patch release of the CLI only. `@stagepass/loader` and `@stagepass/modules` stay at 2.2.0. 2.2.2 was not published; its changes ship in 2.2.3.

#### Fixed

- Live site detection no longer follows a redirect to a URL with an explicit port. `:443`, `:0443` and an empty port are rejected too; the check reads the raw `Location` value, because URL parsing drops the default port.
- `--site` for `stagepass new` and `stagepass upgrade` (and a stored `origin`) rejects every explicit port, including `:443` and `:0443`, before any network access or file write. The error no longer echoes the input.
- Webflow snippets printed by `stagepass new` and `stagepass upgrade` set `data-stagepass-version` to the newest published 2.x `@stagepass/loader`. Offline they use the installed stable 2.x loader, otherwise the bundled loader version (2.2.0), never the CLI version. An explicit `upgrade --version` pin on 2.x is used as is.
- `stagepass upgrade --site <x>` validates the site before any registry query, exec or file write; an invalid value (for example with a port) ends without network access.
- Loader versions from the registry or `node_modules` are accepted for snippets only as strict stable `X.Y.Z`: build metadata (`+…`), prereleases and leading zeros are ignored, so values like `2.9.0+meta` never reach `data-stagepass-version`, the README or the pin hint.
- A stored `origin` in `stagepass.json` or a linked origin that contains a port is still skipped, but now with a warning that names the source; the stored value is not echoed.

#### Changed

- Shorter source comments keep the shipped CLI code no larger than 2.2.1.

### [2.2.1] - 2026-11-02

Patch release of the CLI only. `@stagepass/loader` and `@stagepass/modules` stay at 2.2.0.

#### Fixed

- `stagepass new` with "Run npm install now?" = y failed with `npm error notarget No matching version found for @stagepass/loader@^2.2.0` while 2.2.0 was not yet published. Generated projects now depend on `@stagepass/loader` / `@stagepass/modules` `^2` (the same major as the CDN pin `@2`), never on a range derived from the CLI or a staged version.
- `stagepass upgrade` only writes ranges that a published version satisfies. It reads `npm view <pkg> dist-tags versions` and writes `^<latest published 2.x>`; offline it writes `^2`. An explicit `--version` that is not published (for example a staged release awaiting approval) is refused before any file is written.
- Types follow what is actually available: per-module entries (`@stagepass/modules/cookies`, …) are only written when a published or installed `@stagepass/modules` ships them (2.2.0 and later). Otherwise the umbrella `@stagepass/modules` is used, so `tsc` keeps passing on 2.0.0. After `npm install`, `new` reconciles the types with the installed package.
- `stagepass upgrade` without a TTY maps the legacy `"modules": true` to `["all"]` instead of `[]`, so `sp.inject` / `sp.cookies` / `sp.maintenance` do not become type errors. A hint shows how to narrow the list (`--site-modules cookies`).
- Generated JavaScript projects failed `tsc -p jsconfig.json` (`checkJs` + `strict`) on `window.Webflow` in `src/main.js`. The entry now uses a JSDoc cast; runtime code is unchanged.

### [2.2.0] - 2026-11-02

Non-breaking minor release, together with `@stagepass/loader` and `@stagepass/modules` 2.2.0. Includes the 2.1.0 packaging fix (2.1.0 and the planned 2.1.1 were never published as `latest`). Existing commands, flags and defaults keep working.

#### Fixed

- `stagepass new` failed with `ENOENT … templates/project/.gitignore` when installed from npm (for example after answering y to "Run npm install now?"): npm pack drops `.gitignore` files, so the template never shipped. Dotfile templates are now stored without the leading dot (`templates/project/gitignore`) and written as `.gitignore`.
- A missing template now fails with a clear message ("reinstall the CLI") before anything is written.
- Generated projects no longer pin `@stagepass/loader` / `@stagepass/modules` to the CLI's own version. They use `^<major>.<minor>.0` of the loader/modules version this CLI targets (`^2.2.0`).
- `stagepass upgrade` without `--version` and the `data-stagepass-version` in printed snippets use the loader/modules version this CLI targets, not the CLI version.

#### Added

- Declared modules: `stagepass.json` has `"modules": []`, `["cookies"]` (any of `inject`, `cookies`, `maintenance`) or `["all"]`. `stagepass new` asks for it (or takes `--site-modules`), `stagepass upgrade` infers and confirms it. The legacy boolean `"modules": true|false` is still read.
- Live site detection: `stagepass new --site <host>` and `stagepass upgrade` (using `--site` or the project's linked origin) fetch the public page once (https only, no cookies or auth, about 5 s timeout, size cap, at most 3 redirects) and read `<script src>` tags of `@stagepass/loader` / `@stagepass/modules` on jsDelivr or unpkg (any version). Nothing from the page is executed. When the site is unreachable the CLI asks; without a TTY it keeps the existing list (or `[]`) and prints a hint.
- AI guide: generated projects get `AGENTS.md` with a full `sp` API reference between `<!-- stagepass:begin -->` and `<!-- stagepass:end -->`, plus `.cursor/rules/stagepass.mdc` (globs `src/**`). Declared modules get full sections; undeclared ones get a "not available; enable by …" line and an explicit rule never to use them.
- `stagepass upgrade` syncs existing projects: adds `AGENTS.md` if missing or refreshes only the managed block, adds the Cursor rule if missing, updates `types` in `tsconfig.json` / `jsconfig.json` (rest of the JSON preserved; files with comments or without a `types` array are skipped with a hint), and prints every change. New flags `--dry-run` (writes nothing), `--site`, `--site-modules`, `--skip-site`, `-y, --yes`.
- `stagepass doctor` checks the project in the current directory: `stagepass.json` modules list, the live site's loaded loader version, and a warning when the live site loads other modules than declared. `--skip-site` skips the network check.
- `tsconfig.json` / `jsconfig.json` in new projects list per-module types (`@stagepass/modules/cookies`, …) for the declared modules only.

#### Changed

- CI and the release workflow run a packed-tarball smoke test (`scripts/test-cli-packed.mjs`): packs cli, loader and modules, scaffolds ts and js projects with `--install` from the local tarballs, type checks `sp`, builds, and runs `upgrade` on an old-style project.
- The release workflow stages every version (also stable) under the `next` dist-tag; promotion to `latest` is an explicit `npm dist-tag add` after approval. Partial releases stage only the packages whose version matches the tag.

### [2.1.0] - 2026-11-02

Non-breaking minor release. Existing commands, flags, defaults, and output contracts from 2.0.0 keep working.

#### Added

- `stagepass doctor [--json]`: read-only local stack diagnostics (Homebrew, Caddy, PHP/php-fpm, dnsmasq, resolver, port 443, Caddyfile, projects, certs, LaunchAgent, Chrome LNA hint). Never uses sudo. Exit `1` when any check fails.
- `stagepass certs check` / `stagepass certs trust`: read-only Caddy local CA checks; `trust` runs `caddy trust` after confirmation or `--yes`.
- `stagepass autostart on|off|status` and `stagepass daemon`: user Login LaunchAgent (`io.github.arobertherz.stagepass`) running `caddy run` without sudo.
- `stagepass new [name]`: lean Webflow project scaffold (TypeScript/SCSS defaults, optional modules, git, install). Flags for every option; `--yes` / `--dry-run`.
- `stagepass build` / `stagepass watch`: thin wrappers around project `npm run build` / `npm run watch` (exit code forwarded; no shell).
- `stagepass upgrade`: bump `@stagepass/*` in the current `package.json` and print Webflow snippets (does not run install).
- macOS platform guard for system commands (`setup`, `start`, `stop`, `reload`, `link`, `unlink`). `--version` / `--help` still work everywhere. Escape hatch `STAGEPASS_SKIP_PLATFORM_CHECK=1` for tests/CI only.
- Manual macOS checklist `packages/cli/TESTING-macos.md`.

#### Changed

- CI test matrix uses Node 22 and 24 (development tooling). Published `engines.node` remains `>=18.0.0` (no consumer impact).

#### Docs

- Documented doctor, certs, autostart/daemon, and project helpers (`new` / `build` / `watch` / `upgrade`).
- Default CDN / install recommendation is major pin `@2` (exact pin optional). jsDelivr is the documented CDN; unpkg noted as an alternative.
- Issue/PR templates and jsDelivr `@2` purge notes.

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

### [2.2.2] - 2026-11-06

Version alignment only (no runtime change). Package version bumped to 2.2.2 for monorepo lockstep with `@stagepass/modules`; `dist/` unchanged.

### [2.2.0] - 2026-11-02

Non-breaking minor release. No runtime behaviour change (only the embedded version string).

#### Added

- Complete TypeScript declarations for `sp` / `window.stagepass` in `global.d.ts` with JSDoc and examples, including typed `sp.on(...)` overloads for the built-in events. Verified by type check fixtures.

### [2.1.0] - 2026-11-02

Non-breaking minor release. 2.0.0 behaviour is preserved (`vars.env`, eager `vars.client`, session/swap contracts unchanged).

#### Added

- Flat helpers: `stagepass.env()` / `is()` / `can()` / `client()` / `on()` / `use()` (module registry with major-version check).
- Optional `data-stagepass-staging-hosts` (comma-separated hostnames treated as staging in addition to `*.webflow.io`).
- Optional `data-stagepass-alias` (custom global name; assigned only when free).
- Debug-mode warning when multiple tagged assets share the same local filename.

#### Docs

- Documented Runtime API helpers, staging hosts, and alias.
- Prefer major CDN pin `@2` (exact pin optional); jsDelivr purge notes for the `@2` alias.

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

### [2.2.2] - 2026-11-06

Patch release of modules. `@stagepass/cli` stays at 2.2.6; `@stagepass/loader` package version aligns to 2.2.2 (no loader runtime change). Runtime `dist/` for inject differs from 2.2.1.

#### Fixed

- `position: 'body-start'` inserts as the first child of `document.body` (was inserting after the first child).
- README `stagepass` option docs match INV-6: no invented page-host `?_cb=` fallback; empty/missing `resolveLocalUrl` keeps production `src`.

### [2.2.1] - 2026-11-06

Patch release of modules only. `@stagepass/cli` stays at 2.2.6; `@stagepass/loader` stays at 2.2.0. Runtime `dist/` for inject differs from 2.2.0 / 2.1.0.

#### Fixed

- NodeNext umbrella re-exports in `global.d.ts` now use explicit `.js` extensions (`./inject.js`, `./cookies.js`, `./maintenance.js`), so `types: ["@stagepass/modules"]` resolves `sp.inject` / `sp.cookies` / `sp.maintenance` under `moduleResolution: "NodeNext"`.
- Inject local swap only when an active Stagepass session yields a non-empty `resolveLocalUrl` (INV-6). On localhost without a session, production `src` is kept (plus optional `version` / `?v=`); the inventing `https://${domain}/…?_cb=` fallback is removed.

### [2.2.0] - 2026-11-02

Non-breaking minor release. Runtime files in `dist/` are unchanged.

#### Added

- Per-module type entries: `@stagepass/modules/inject`, `@stagepass/modules/cookies`, `@stagepass/modules/maintenance` (shipped as `inject.d.ts`, `cookies.d.ts`, `maintenance.d.ts`). Add only the modules your site loads to `compilerOptions.types`, so undeclared `sp.<module>` is a type error.
- Full JSDoc with examples for `sp.inject`, `sp.cookies` and `sp.maintenance`.

#### Changed

- `@stagepass/modules` (the package types entry, `global.d.ts`) still declares all modules, so existing `types: ["@stagepass/modules"]` setups keep working.

### [2.1.0] - 2026-11-02

Non-breaking minor release. Existing `inject` / `cookies` APIs keep working; new behaviour is additive or opt-in. Modules still register without the loader (`inject` / `cookies` warn; `maintenance` skips).

#### Added

- `maintenance.min.js`: opt-in client-side maintenance overlay (`data-stagepass-maintenance="true"`; `sp.maintenance.enable` / `disable` / `isActive`). Text via `textContent` only (not access protection; no `noindex`).
- Cookies: consent categories with queue, `jar` / `crumbs` / `throwAll`, and `sp.cookie` alias.
- Inject: `integrity`, `crossorigin`, `nonce`, and `allowedHosts` options.

#### Security

- Cookie attribute values validated against cookie injection.
- Reserved inject attributes cannot bypass the host allowlist.

#### Docs

- Documented maintenance module, consent helpers, and inject security options.
- Prefer major CDN pin `@2` (exact pin optional); published files list includes `maintenance.min.js`.

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
