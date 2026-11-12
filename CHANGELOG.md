# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Packages are versioned independently: `@stagepass/cli`, `@stagepass/loader`, `@stagepass/modules`.

---

## Unreleased

### `@stagepass/cli`

#### Added

- Optional PHP boilerplate from `stagepass new --php` (plain PHP 8.2, no Composer, no mail): `api/action.php`, allowlisted actions, `api/.env.example`, and `.php/config.php`. The interactive wizard always asks. `--php-examples` is deprecated and copies nothing. `doctor`, `dev`, and `watch` warn when PHP is missing, older than 8.2, or has no php-fpm/php-cgi, and the JS build continues. `stagepass build` copies `api/` and `.php/config.php` into `dist/` and skips `.env`, rate-limit files, logs, and pid files.
- A top-level unknown option suggests the subcommand that declares it and keeps the rest of the command line (for example `stagepass --origin <host>` → `stagepass link --origin <host>`, including `--opt=value`). Command and option typos still use Commander's suggestion. Nothing is executed; the hint is stderr-only and the exit code stays non-zero.
- `stagepass upgrade` replaces `scripts/build.mjs` when the file is still an unmodified scaffold from an earlier CLI (2.1.0–2.2.7 string manifests, the SRI template `f7afa80`, published 2.3.0 / 2.3.0-beta.1, and the watch-stable template `688dca9`). Line endings are normalized; scaffold entry paths (`src/main.js`, `src/main.ts`, `src/styles.css`, `src/styles.scss`) still count as unmodified. The interactive prompt defaults to yes. Without a TTY, and with `--yes`, the file is replaced. `--dry-run` writes nothing. An edited script is left unchanged, with a hint that points at `docs/cli.md` and describes `stagepass build`, `stagepass watch` and `stagepass dev`. A missing script stays missing.

#### Fixed

- Interactive `stagepass new --no-link` no longer asks to link on macOS.
- Linked `.sp` responses set a single `Access-Control-Allow-Origin` on HTTP 2xx (Caddy deferred replace), including when the PHP app also sends CORS. A PHP 403 for a disallowed origin is not given that header. Existing `v2` site blocks are rewritten on `link`, `reload`, and `start` with their saved options kept.
- Scaffold `scripts/build.mjs` also removes stale hashed files named by CLI 2.2.x `dist/manifest.json` entries (plain filename strings, not `{ file, integrity }` objects). Paths outside `dist/`, symlinks, and names that are not `<base>.<8 hex><ext>` directly in `dist/` stay in place.

#### Changed

- Scaffold `scripts/build.mjs`: `stagepass watch` / `stagepass dev` write only stable `dist/main.js` and `dist/styles.css` (no hashed files, no `manifest.json` writes or deletes). `stagepass build` still writes hashes, stable copies, and SRI `manifest.json`, then removes hashed files the previous manifest listed that the new one does not (plain hashed names directly in `dist/` only), including CLI 2.2.x manifests whose values are filename strings. `stagepass upgrade` replaces an unmodified copy of an older scaffold (see Added).

### `@stagepass/modules`

- Cookies: `sp.cookies.on('bake' | 'throw', fn)` (also on `sp.cookie`) returns an unsubscribe function. Fires after a successful write/delete (including queued bakes flushed by consent, and each cookie in `throwAll`). Listener errors do not break the operation.
- The peer range is now `>=2.0.0 || >=2.3.0-beta.0`, so the 2.3 loader prerelease satisfies it (prereleases never match a plain `>=2.0.0`). Ships with the next modules release; 2.2.0 is unchanged.

### Repo

- Stable package releases now stage directly on npm dist-tag `latest` (one 2FA approval, no separate promotion); prereleases still stage on `next`.
- master packages now match the published releases: `@stagepass/loader` 2.5.0 (dist byte-identical to npm) and `@stagepass/modules` 2.2.2 plus the unreleased cookie events; CLI pins (`LOADER_VERSION`/`MODULES_VERSION`) synced to 2.5.0 / 2.2.2. Published `@stagepass/cli@2.3.1` still bundles the 2.4.0 loader pin.
- Packed smoke test: the expected `upgrade` types follow the newest published modules of the major, as the CLI does; also covers CSS hot-swap SSE on a generated js project (`node scripts/build.mjs --watch` + packed `createLiveServer`, with hard timeout and process-group cleanup).
- Docs: always embed the full `/dist/loader.min.js` path on unpkg / redirecting CDNs (or set `data-stagepass-flag-base`); short package URLs break session chunk resolution. Live reload docs note content-hash classification and selective watch builds.
- Docs split under `docs/` (#11): getting started, CLI, loader, modules, migration pointer, troubleshooting, live reload. README keeps a short intro and index.
- Headless Playwright E2E under `e2e/` (Chromium, Firefox, WebKit locally). CI `e2e` job on `[self-hosted, cerebro]` runs Chromium only (#11).


---


## `@stagepass/cli`

### [2.3.1] - 2026-11-12

Patch release on top of 2.3.0: fixes the login autostart after a Homebrew node upgrade and makes `stagepass doctor` report a stale LaunchAgent or daemon (#74). Loader and modules are not part of this release. Published on npm as `@stagepass/cli@2.3.1` on 12 November 2026, 12:06 Europe/Berlin, dist-tag `latest`. Source tag `cli-v2.3.1` (`2688c81`), npm gitHead `2688c811cf1beb59a7d460c0df49c73737b8c1b1`, npm shasum `f858a0a83612f2b4e91e7183f908c5e9bec058b1`.

#### Fixed

- LaunchAgent plist uses the Homebrew `bin/node` shim when the running node is a versioned Cellar path, so `brew upgrade node` does not leave login autostart pointed at a deleted binary (#74).
- `stagepass doctor` fails when a LaunchAgent node or CLI path is missing, and warns when that node path is a versioned Cellar path or the running daemon version differs from the CLI (`stagepass autostart on`) (#74).
- `stagepass autostart on` waits for launchd to unload the previous job and retries a racing bootstrap, so re-running it with the daemon loaded no longer leaves autostart unloaded.

### [2.3.0] - 2026-11-11

Stable release of the CLI 2.3 line, on top of `2.3.0-beta.1` (published npm dist-tag `next` on 10 November 2026, shasum `7853bce7d186673aba28a20f4529ee775d9f3f2b`) plus two fixes that landed after the beta published (N-1, N-2); no other behaviour change. Published on npm as `@stagepass/cli@2.3.0` on 11 November 2026, 10:47 Europe/Berlin, dist-tag `latest`. Source tag `cli-v2.3.0` (`89665d1`), npm shasum `db4042723d9c7becde90fd6afdbbaaaea974327c`. The monorepo `packages/loader` and `packages/modules` package.json files remain at the published **2.4.0** / **2.2.2** versions; this release publishes neither loader nor modules. Online `new`/`upgrade` resolve snippet pins from the registry (stable 2.x loader, offline fall back to bundled).

#### Changed interfaces / Notes for upgraders

- **Node engine:** `>=18.0.0` -> `>=20.17.0` (required by `@inquirer/prompts@8`). Node 18 is no longer supported for this CLI.
- **Dependency majors:** `commander` 11 -> 14, `execa` 8 -> 9, `ora` 7 -> 9, `inquirer` -> `@inquirer/prompts`. Minors: `fs-extra` 11.2.0 -> 11.4.1, `vitest` 5.0.5 -> 5.1.0 (dev).
- **start:** Certificate check with repair offer (`certs trust` / site `renew`); PHP-FPM ensure (`brew services start php`, then `restart`); stale `devPort` cleanup; privilege-scoped port-443 handling (no standby `sudo -v`; `sudo kill` only on EPERM; ESRCH = already exited); help text for start/stop/daemon updated.
- **httpd:** port-443 handling still uses `sudo apachectl stop` after the SIGTERM confirmation, unchanged from 2.2.7.
- **doctor:** unpinned-CDN warnings; project/PHP checks; self-hosted loader display.
- **daemon:** PHP-FPM safeguard and macOS notifications via `osascript`.
- **new:** Doctor preflight after input validation (never on `--dry-run`); optional `--staging` / `--production` / `--php` / `--link`.
- **prepack / release:** `scripts/sync-cli-versions.mjs --check` verifies `package-versions.js` against loader/modules versions and writes nothing (exit 1 on drift).
- **certs renew:** `--root` needs two interactive confirmations, or `--yes --i-understand-root-renewal` (`--yes` alone always aborts). Do not combine `--root` with `--remove-orphans`.

#### Notable

- **Node engine:** `engines.node` is now `>=20.17.0` (required by `@inquirer/prompts@8`). Node 18 is no longer supported for this CLI.

#### Added

- `stagepass watch` / `stagepass dev` check whether Stagepass is running before starting (#40). Interactive TTY asks to start (same in-process path as `stagepass start`); non-TTY / CI prints a `stagepass start` hint and continues. `watch` also warns with `stagepass link` when the cwd is not linked; `dev` keeps the existing hard error for unlinked projects.
- Live site detection (#31): also recognise jsDelivr/unpkg package-root URLs (`…/@stagepass/loader@2`, `…/@stagepass/modules@2`, trailing slash / query; modules root → `all` via `main`) and self-hosted embeds (Stagepass build filenames under a `stagepass` / `@stagepass` path, or with a `data-stagepass-*` hint; renamed loader via loader-config attributes). Result `cdn: "self"` is display-only; `upgrade` does not rewrite self-hosted tags to CDN. Bare `loader.js` / `all.min.js` without a Stagepass hint stay unmatched.
- Live reload: content-based change detection in `live-server` (sha256 per file under `outDir`). Identical rewrites are ignored; `manifest.json` is ignored; CSS-only real changes emit `{type:"css"}`, other real changes emit `{type:"reload"}`.
- Scaffold `scripts/build.mjs --watch`: rebuild only the affected part (JS entry/imports via esbuild watch, CSS entry separately); write dist files and `manifest.json` only when bytes change, so CSS-only edits do not rewrite `main.js` and do not force a full page reload.
- `LOADER_VERSION` / `MODULES_VERSION` are generated into `package-versions.js` from the monorepo package.json files (`scripts/sync-cli-versions.mjs`; CLI `prepack` + release workflow). Online snippets prefer the newest published stable 2.x loader from the registry; offline they fall back to installed then bundled. `STAGEPASS_PACKAGES_VERSION` remains a deprecated alias of `LOADER_VERSION`. Drift test fails if the generated file is stale.
- `stagepass doctor` warns on unpinned CDN URLs (`@latest`, bare major `@1`, or bare package with no version) in recommended snippets and in the current project's `README.md`, `stagepass.json`, and `*.html` files directly in the project root and in `snippets/` (non-recursive; regular files ≤ 1 MB; symlinks skipped).
- `stagepass certs renew`: scoped repair of failing linked `.sp` site certificates (`certificates/local/<domain>` + `caddy reload`); `renew --root` moves the local CA folder to a timestamped backup (never deletes) after double confirmation or `--yes --i-understand-root-renewal`; `renew --remove-orphans` deletes orphaned keychain roots by SHA-1 only after per-certificate confirmation (or `--yes`).
- `stagepass start` runs a read-only `certs check` and, when interactive, can offer `certs trust` / site `renew`. Non-interactive prints findings and a hint. Sudo is requested only when a confirmed port conflict kill (or orphan delete) needs it. Port 443 conflicts show process name and PID; SIGTERM first, SIGKILL only after a second confirmation.
- When the login LaunchAgent is installed, `start` uses `launchctl kickstart` and `stop` uses `launchctl bootout` (stopped until next login; `autostart off` removes it permanently). LaunchAgent plists embed a validated Homebrew `PATH` (`brew --prefix` bin/sbin + launchd minimal dirs) so login/`daemon` can resolve `caddy` on Apple Silicon and Intel.
- `stagepass daemon` ensures PHP-FPM (never sudo) and reports problems via macOS notifications (`osascript` with argv-safe AppleScript).
- `stagepass new`: staging / production origins (`--staging`, `--production`; wizard suggests `<name>.webflow.io`), written to `stagepass.json` as `origin` / `production`. Skipping production prints a short `stagepass link --origin` hint. `stagepass link` with no `--origin` flags uses those hosts. `--site` still works and must match `--staging` when both are set.
- `stagepass new`: optional PHP (`--php` / `--no-php`, default off). PHP on creates `api/`, stores `"php": true`, and omits `php_fastcgi` when false. Existing linked projects without a `php` setting keep PHP on (non-breaking). Optional `--php-examples` adds secure samples under `examples/php/`.
- `stagepass new`: interactive macOS doctor preflight can offer `setup` (never automatic, never under `--yes` / no-TTY). Optional `link` at the end (`--link` or interactive ask, macOS only).
- Generated projects: `npm run dev` aliases `watch`; `scripts/build.mjs` writes SRI `integrity` (sha384) per file in `dist/manifest.json`.
- `stagepass doctor`: project-level PHP check when `stagepass.json` has `"php": true|false`.
- `stagepass dev` (#11): project `npm run watch` plus a loopback SSE event server proxied at `/__stagepass/live` on the linked `.sp` domain (no Vite). Caddy `reverse_proxy` with `flush_interval -1`, same CORS / LNA policy as assets; `devPort` stored in `projects.json` only while running and cleared when the PID is dead.

#### Changed

- Dependencies: `inquirer` replaced with `@inquirer/prompts@^8`; `commander@^14`, `execa@^9`, `ora@^9`. Ora spinners use a safe TTY geometry wrapper (width `0` / invalid / resize-to-zero no longer runaway). Chalk 6 / Commander 15 / Execa 10 / Ora 10 were not taken (they require Node 22+).

#### Fixed

- Site TLS handshakes run only when Caddy is serving `:443`; otherwise domains are marked not checkable (no false TLS fail, renew offer, cert deletion, or `caddy reload` while Caddy is down) (M-1).
- Short-lived Caddy leaf certificates no longer warn against the 90-day root threshold; leaves fail only when expired, not yet valid, unparseable, or SAN-mismatched (M-2).
- Forward-ported from published CLI 2.2.3–2.2.7: strict snippet/registry semver (reject whitespace padding, leading zeros, build metadata); live-site / `--site` / stored-origin port checks including `:443`; `upgrade --version` resolves the loader pin before any write and honors the pin when `package.json` lists only `@stagepass/modules`; `start` closes the parent logfile FD after `caddy start`.
- Restored the 2.2.3 guarantee: `stagepass upgrade --site` validates the site host (including rejecting ports such as `:443`) before any npm registry lookup, so a bad `--site` does not touch the network.
- The CLI bin prints a clear Node engine error and exits 1 when Node is older than `>=20.17.0`, instead of crashing later inside a dependency (`string-width` / `@inquirer`).
- Privilege-scoped `start` / port conflict resolution (F-04): no standby `sudo -v`; signal own processes without elevated rights first; `sudo kill` only after unprivileged failure; nginx tries `valet stop` before any sudo; re-export `isSafePid`. Keeps 2.3 cert repair offers, `ensurePhpFpm` (start then restart), stale dev-port cleanup, and autostart kickstart/bootout. `defaultExec` uses spawn-wait for custom stdio so logfile FD inheritance does not hang `caddy start`.
- `link` / `unlink` / `start` now set a non-zero `process.exitCode` on validation and write failures (invalid domain, path traversal, home-directory root, bad `--origin`, unlink write failure). Reload-warning paths stay exit 0 (P-1 / INV-1, INV-3, INV-5).
- `upgrade` / project-sync refuse writes through symlinks: plan skips symlink targets with a note; apply rolls back if a target is a symlink or its parent resolves outside the project; symlinked `package.json` exits 1 with nothing written (P-2 / INV-3).
- `stagepass dev` registers `SIGINT` / `SIGTERM` / `SIGHUP` before storing `devPort`, forwards `SIGHUP` to the watch child, returns `128+signo` when signaled before spawn, and `SIGKILL`s a child that ignores the stop signal after a short grace period so `devPort` is always cleared (P-3 / AC-7 / F-08).
- Doctor live-site check: self-hosted loader (`cdn: "self"`) is reported as self-hosted instead of `@stagepass/loader@latest`; a concrete version is appended only when known (P-4 / AC-3).
- Doctor unpinned-CDN scan also covers `*.html` in the project root and `snippets/` (non-recursive; regular files ≤ 1 MB; symlinks skipped) (P-5 / AC-18).
- Aborting (Ctrl+C or EOF) at any confirmation prompt now ends with a single `Aborted.` line instead of an `ExitPromptError` stack trace, exiting 130 for SIGINT and 1 for EOF/closed stdin (N-1).
- `stagepass start` no longer prints `Certificates: ok` when site TLS was not checked or not ok. The line names the root status (`ok` / `warning` / `not checked`) and says site TLS was not checkable, adding "Caddy not serving :443" only when that was the skip reason (N-2).

### [2.3.0-beta.1] - 2026-11-10 (prerelease, npm `next`)

Prerelease of the CLI only. First 2.3.0 line candidate. Published on npm as `@stagepass/cli@2.3.0-beta.1` on 10 November 2026, 20:09 Europe/Berlin, dist-tag `next` only; `latest` stays on 2.2.7. Source tag `cli-v2.3.0-beta.1` (`81a7e80`), npm shasum `7853bce7d186673aba28a20f4529ee775d9f3f2b`. The monorepo `packages/loader` and `packages/modules` package.json files already sit on the published **2.4.0** / **2.2.2** versions; this release publishes neither loader nor modules. Online `new`/`upgrade` resolve snippet pins from the registry (stable 2.x loader, offline fall back to bundled). Superseded by the stable `[2.3.0]` entry above, which adds N-1 and N-2 on top of everything below.

#### Changed interfaces / Notes for upgraders

- **Node engine:** `>=18.0.0` -> `>=20.17.0` (required by `@inquirer/prompts@8`). Node 18 is no longer supported for this CLI.
- **Dependency majors:** `commander` 11 -> 14, `execa` 8 -> 9, `ora` 7 -> 9, `inquirer` -> `@inquirer/prompts`. Minors: `fs-extra` 11.2.0 -> 11.4.1, `vitest` 5.0.5 -> 5.1.0 (dev).
- **start:** Certificate check with repair offer (`certs trust` / site `renew`); PHP-FPM ensure (`brew services start php`, then `restart`); stale `devPort` cleanup; privilege-scoped port-443 handling (no standby `sudo -v`; `sudo kill` only on EPERM; ESRCH = already exited); help text for start/stop/daemon updated.
- **httpd:** port-443 handling still uses `sudo apachectl stop` after the SIGTERM confirmation, unchanged from 2.2.7.
- **doctor:** unpinned-CDN warnings; project/PHP checks; self-hosted loader display.
- **daemon:** PHP-FPM safeguard and macOS notifications via `osascript`.
- **new:** Doctor preflight after input validation (never on `--dry-run`); optional `--staging` / `--production` / `--php` / `--link`.
- **prepack / release:** `scripts/sync-cli-versions.mjs --check` verifies `package-versions.js` against loader/modules versions and writes nothing (exit 1 on drift).
- **certs renew:** `--root` needs two interactive confirmations, or `--yes --i-understand-root-renewal` (`--yes` alone always aborts). Do not combine `--root` with `--remove-orphans`.

#### Notable

- **Node engine:** `engines.node` is now `>=20.17.0` (required by `@inquirer/prompts@8`). Node 18 is no longer supported for this CLI.

#### Added

- `stagepass watch` / `stagepass dev` check whether Stagepass is running before starting (#40). Interactive TTY asks to start (same in-process path as `stagepass start`); non-TTY / CI prints a `stagepass start` hint and continues. `watch` also warns with `stagepass link` when the cwd is not linked; `dev` keeps the existing hard error for unlinked projects.
- Live site detection (#31): also recognise jsDelivr/unpkg package-root URLs (`…/@stagepass/loader@2`, `…/@stagepass/modules@2`, trailing slash / query; modules root → `all` via `main`) and self-hosted embeds (Stagepass build filenames under a `stagepass` / `@stagepass` path, or with a `data-stagepass-*` hint; renamed loader via loader-config attributes). Result `cdn: "self"` is display-only; `upgrade` does not rewrite self-hosted tags to CDN. Bare `loader.js` / `all.min.js` without a Stagepass hint stay unmatched.
- Live reload: content-based change detection in `live-server` (sha256 per file under `outDir`). Identical rewrites are ignored; `manifest.json` is ignored; CSS-only real changes emit `{type:"css"}`, other real changes emit `{type:"reload"}`.
- Scaffold `scripts/build.mjs --watch`: rebuild only the affected part (JS entry/imports via esbuild watch, CSS entry separately); write dist files and `manifest.json` only when bytes change, so CSS-only edits do not rewrite `main.js` and do not force a full page reload.
- `LOADER_VERSION` / `MODULES_VERSION` are generated into `package-versions.js` from the monorepo package.json files (`scripts/sync-cli-versions.mjs`; CLI `prepack` + release workflow). Online snippets prefer the newest published stable 2.x loader from the registry; offline they fall back to installed then bundled. `STAGEPASS_PACKAGES_VERSION` remains a deprecated alias of `LOADER_VERSION`. Drift test fails if the generated file is stale.
- `stagepass doctor` warns on unpinned CDN URLs (`@latest`, bare major `@1`, or bare package with no version) in recommended snippets and in the current project's `README.md`, `stagepass.json`, and `*.html` files directly in the project root and in `snippets/` (non-recursive; regular files ≤ 1 MB; symlinks skipped).
- `stagepass certs renew`: scoped repair of failing linked `.sp` site certificates (`certificates/local/<domain>` + `caddy reload`); `renew --root` moves the local CA folder to a timestamped backup (never deletes) after double confirmation or `--yes --i-understand-root-renewal`; `renew --remove-orphans` deletes orphaned keychain roots by SHA-1 only after per-certificate confirmation (or `--yes`).
- `stagepass start` runs a read-only `certs check` and, when interactive, can offer `certs trust` / site `renew`. Non-interactive prints findings and a hint. Sudo is requested only when a confirmed port conflict kill (or orphan delete) needs it. Port 443 conflicts show process name and PID; SIGTERM first, SIGKILL only after a second confirmation.
- When the login LaunchAgent is installed, `start` uses `launchctl kickstart` and `stop` uses `launchctl bootout` (stopped until next login; `autostart off` removes it permanently). LaunchAgent plists embed a validated Homebrew `PATH` (`brew --prefix` bin/sbin + launchd minimal dirs) so login/`daemon` can resolve `caddy` on Apple Silicon and Intel.
- `stagepass daemon` ensures PHP-FPM (never sudo) and reports problems via macOS notifications (`osascript` with argv-safe AppleScript).
- `stagepass new`: staging / production origins (`--staging`, `--production`; wizard suggests `<name>.webflow.io`), written to `stagepass.json` as `origin` / `production`. Skipping production prints a short `stagepass link --origin` hint. `stagepass link` with no `--origin` flags uses those hosts. `--site` still works and must match `--staging` when both are set.
- `stagepass new`: optional PHP (`--php` / `--no-php`, default off). PHP on creates `api/`, stores `"php": true`, and omits `php_fastcgi` when false. Existing linked projects without a `php` setting keep PHP on (non-breaking). Optional `--php-examples` adds secure samples under `examples/php/`.
- `stagepass new`: interactive macOS doctor preflight can offer `setup` (never automatic, never under `--yes` / no-TTY). Optional `link` at the end (`--link` or interactive ask, macOS only).
- Generated projects: `npm run dev` aliases `watch`; `scripts/build.mjs` writes SRI `integrity` (sha384) per file in `dist/manifest.json`.
- `stagepass doctor`: project-level PHP check when `stagepass.json` has `"php": true|false`.
- `stagepass dev` (#11): project `npm run watch` plus a loopback SSE event server proxied at `/__stagepass/live` on the linked `.sp` domain (no Vite). Caddy `reverse_proxy` with `flush_interval -1`, same CORS / LNA policy as assets; `devPort` stored in `projects.json` only while running and cleared when the PID is dead.

#### Changed

- Dependencies: `inquirer` replaced with `@inquirer/prompts@^8`; `commander@^14`, `execa@^9`, `ora@^9`. Ora spinners use a safe TTY geometry wrapper (width `0` / invalid / resize-to-zero no longer runaway). Chalk 6 / Commander 15 / Execa 10 / Ora 10 were not taken (they require Node 22+).

#### Fixed

- Site TLS handshakes run only when Caddy is serving `:443`; otherwise domains are marked not checkable (no false TLS fail, renew offer, cert deletion, or `caddy reload` while Caddy is down) (M-1).
- Short-lived Caddy leaf certificates no longer warn against the 90-day root threshold; leaves fail only when expired, not yet valid, unparseable, or SAN-mismatched (M-2).
- Forward-ported from published CLI 2.2.3–2.2.7: strict snippet/registry semver (reject whitespace padding, leading zeros, build metadata); live-site / `--site` / stored-origin port checks including `:443`; `upgrade --version` resolves the loader pin before any write and honors the pin when `package.json` lists only `@stagepass/modules`; `start` closes the parent logfile FD after `caddy start`.
- Restored the 2.2.3 guarantee: `stagepass upgrade --site` validates the site host (including rejecting ports such as `:443`) before any npm registry lookup, so a bad `--site` does not touch the network.
- The CLI bin prints a clear Node engine error and exits 1 when Node is older than `>=20.17.0`, instead of crashing later inside a dependency (`string-width` / `@inquirer`).
- Privilege-scoped `start` / port conflict resolution (F-04): no standby `sudo -v`; signal own processes without elevated rights first; `sudo kill` only after unprivileged failure; nginx tries `valet stop` before any sudo; re-export `isSafePid`. Keeps 2.3 cert repair offers, `ensurePhpFpm` (start then restart), stale dev-port cleanup, and autostart kickstart/bootout. `defaultExec` uses spawn-wait for custom stdio so logfile FD inheritance does not hang `caddy start`.
- `link` / `unlink` / `start` now set a non-zero `process.exitCode` on validation and write failures (invalid domain, path traversal, home-directory root, bad `--origin`, unlink write failure). Reload-warning paths stay exit 0 (P-1 / INV-1, INV-3, INV-5).
- `upgrade` / project-sync refuse writes through symlinks: plan skips symlink targets with a note; apply rolls back if a target is a symlink or its parent resolves outside the project; symlinked `package.json` exits 1 with nothing written (P-2 / INV-3).
- `stagepass dev` registers `SIGINT` / `SIGTERM` / `SIGHUP` before storing `devPort`, forwards `SIGHUP` to the watch child, returns `128+signo` when signaled before spawn, and `SIGKILL`s a child that ignores the stop signal after a short grace period so `devPort` is always cleared (P-3 / AC-7 / F-08).
- Doctor live-site check: self-hosted loader (`cdn: "self"`) is reported as self-hosted instead of `@stagepass/loader@latest`; a concrete version is appended only when known (P-4 / AC-3).
- Doctor unpinned-CDN scan also covers `*.html` in the project root and `snippets/` (non-recursive; regular files ≤ 1 MB; symlinks skipped) (P-5 / AC-18).

### [2.2.7] - 2026-11-08

Patch release of the CLI only. `@stagepass/loader` stays at **2.4.0**; `@stagepass/modules` latest **2.2.0** / next **2.2.2** are unchanged. `engines.node` remains `>=18.0.0`. No dependency major bumps.

#### Fixed

- LaunchAgent autostart embeds a validated Homebrew `PATH` (`brew --prefix` bin/sbin + launchd minimal dirs) so login/`daemon` can resolve `caddy` on Apple Silicon and Intel. PATH shims must live in `prefix/bin` or `prefix/sbin`; Cellar realpaths under the same prefix are accepted. Prerequisites are validated before the plist is written.
- Ora spinners no longer treat TTY width `0` / invalid / live resize-to-zero as usable geometry (avoids runaway ANSI clears).
- `stagepass start` closes the parent logfile FD after `caddy start` (execa@8 does not hang when a daemon grandchild inherits the log handles).
- `stagepass start` no longer runs unconditional `sudo -v` or a `sudo lsof | …` shell pipeline. Port 443 is inspected with argv `lsof` (no sudo). Conflicting listeners are signalled only after confirmation: **SIGTERM** first, **SIGKILL** only after a separate confirm if still listening. Non-interactive runs refuse to signal. Privilege (`sudo kill` / `apachectl`) is used only when the confirmed operation needs it.
- When a LaunchAgent plist is installed, `start` bootstraps if needed then `launchctl kickstart` (falls back to direct `caddy start`). `stop` `launchctl bootout`s first (until next login) before stopping Caddy/PHP. PHP `brew services` behaviour is unchanged.

#### Docs

- Autostart / Homebrew PATH / start/stop LaunchAgent contract; macOS permissions split into system CA trust, browser Local Network Access, and Node folder TCC (e.g. Desktop), not conflated with firewall/FDA. Stable global install vs temporary Desktop test packs; LaunchAgent absolute paths need deliberate `autostart off`/`on` after CLI moves (upgrade does not auto-migrate). `RELEASING.md` single-package `cli-v*` → stage `next` → 2FA approve → explicit `latest`. Bundled offline snippet constant stays lockstep with this release line (`2.2.2`); `new`/`upgrade` still resolve live loader pins from the registry (currently 2.4.0).

#### Verified on macOS (compatible 2.2.7 artifact; not a cold-boot claim)

Interactive accept of the compatible CLI build (product tree `bb07d46`): normal start ~2.1s, verbose ~1.8s, direct stop, `autostart on`/bootstrap, verbose kickstart ~10.6s, agent stop/bootout, normal bootstrap start ~10.6s, off/on retained; 14 TLS checks (12 HTTP 404 + 2 HTTP 200); CA/config/backup hashes unchanged. Global `@stagepass/cli@2.2.6` left installed for rollback. **Cold-boot/login LaunchAgent PASS remains scoped to the earlier `dc927de` observation only**: do not treat it as proven for published 2.2.7. Remaining open limits: full P1 negatives, fresh demo, `.sp`/Webflow scoped cases, and a dedicated cold boot of the 2.2.7 artifact.

### [2.2.6] - 2026-11-06

Patch release of the CLI only. At publish time `@stagepass/loader` and `@stagepass/modules` were 2.2.0; `STAGEPASS_PACKAGES_VERSION` later tracks 2.2.2 without a CLI version bump.

#### Fixed

- Registry and `node_modules` version strings with leading or trailing whitespace are no longer treated as stable semver. `parseSemver` checks the raw value; padded entries are ignored so snippets and `upgrade` ranges stay clean `X.Y.Z` / `^X.Y.Z`.

### [2.2.5] - 2026-11-05 (not published to npm; changes shipped in 2.2.6/2.2.7)

CLI-only notes that were never published as their own npm version. `@stagepass/loader` and `@stagepass/modules` stay at 2.2.0. The fix below shipped in published 2.2.6/2.2.7.

#### Fixed

- `stagepass upgrade --version`: the loader pin is resolved before any file is written. If it cannot be resolved (version not published for the loader, registry offline), the command exits 1 and leaves `package.json` and project files unchanged.

### [2.2.4] - 2026-11-05 (not published to npm; changes shipped in 2.2.6/2.2.7)

CLI-only notes that were never published as their own npm version. `@stagepass/loader` and `@stagepass/modules` stay at 2.2.0. The fix below shipped in published 2.2.6/2.2.7.

#### Fixed

- `stagepass upgrade --version <v>` now pins the Webflow snippet (`data-stagepass-version` and the exact-pin hint) to that loader version even when `package.json` lists only `@stagepass/modules`.

### [2.2.3] - 2026-11-05 (not published to npm; changes shipped in 2.2.6/2.2.7)

CLI-only notes that were never published as their own npm version. `@stagepass/loader` and `@stagepass/modules` stay at 2.2.0. 2.2.2 was also never published; its changes and the notes below shipped in published 2.2.6/2.2.7.

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

### [2.5.0] - 2026-11-12

Loader-only minor release on top of 2.4.0: adds `data-stagepass-nocache`; the visitor path without that attribute is unchanged; CLI and modules are not part of this release. Published on npm as `@stagepass/loader@2.5.0` on 12 November 2026, 12:06 Europe/Berlin, dist-tag `latest`. Source tag `loader-v2.5.0` (`1e88b52`), npm gitHead `1e88b5237e7d9cd4d9cdbfdfd9b51479dfcbb27d`, npm shasum `7be5dec96404e7f95b339411485c07369ecf1429`. jsDelivr `@2.5.0/dist/loader.min.js` serves the published file (15065 bytes). Published `@stagepass/modules` stays 2.2.2. The CLI's bundled `LOADER_VERSION` snapshot moves to 2.5.0 only in this repo and ships with the next CLI release.

#### Added

- `data-stagepass-nocache` (per-asset, boolean: present or `="true"` on, `="false"` off): permanent production cache busting for a single tagged asset, for every visitor on every page view. Sets exactly one `?_cb=<timestamp>`; an existing `_cb` query parameter is replaced (only in the query string, so `&` in the path and `_cb` in the hash stay), and a second `_cb` is not appended. Use case: a script that embeds forms via iframes and must never be served stale. Combines with `data-stagepass-v` / `data-stagepass-version` as original query (without `_cb`), then `?v=<version>`, then `_cb` (other query parameters and the hash preserved). No effect during an active local/dev swap session or on `data-stagepass-live-src="true"` assets (zero-cost mode stays untouched in production by design). `data-stagepass-cachebust` remains legacy and unchanged.

#### Changed

- Measured `loader.min.js`: 15065 / 6664 / 5958 (min / gzip / brotli); 2.4.0 was 14852 / 6562 / 5856.

#### Docs

- npm README: version references updated for 2.5.0; nocache marked as 2.5.0+; existing `_cb` is documented as replaced by exactly one fresh `_cb`.
- Package README: nocache section and 2.5.0 pins; also the post-2.4.0 docs already on master (MIGRATION link moved, GitHub issue #8 / P1 sentence removed, live.min.js since 2.4.0, Two layers for `sp.vars` vs `sp.env`, link to `docs/loader.md`, `certs renew` no longer marked unreleased).

### [2.4.0] - 2026-11-08

Loader-only release (`loader-v2.4.0`, `cddec72`). Published on npm and jsDelivr as `@stagepass/loader@2.4.0` on 2026-11-08 (17:00:11 Europe/Berlin). First published under dist-tag `next`; `latest` now points to 2.4.0.

#### Added

- Opt-in zero-cost production mode via `data-stagepass-live-src="true"` on the loader tag: tagged assets keep a normal `src` / `href` (optional `integrity`); without a session the loader does not touch them; with an active swap session they are rewritten to the local `.sp` URL before classic scripts run (MutationObserver; Firefox uses `beforescriptexecute` → convert to `data-src` → existing swap path). Legacy `data-src` / `data-href` is unchanged and remains the default. The "Live-src script already executing" warning is dropped (silent skip when the loader is not sync in `<head>` before tagged assets).
- Lazy `live.min.js` during an active swap session (EventSource to `/__stagepass/live`). CSS-only events replace local stylesheets (cache-bust / swap, no full reload); other events call `location.reload()`. The chunk is never loaded without a session. It closes after the first error when the unpublished `stagepass dev` SSE server is not running.

#### Changed

- Session-only work moved into `flag.min.js` (core slim). The live-reload hook (`stagepass.live.v1` + appending `live.min.js`) and the one-time debug `sp.vars` hint now live in the flag chunk; duplicate local-path warnings (`Multiple assets resolve to local file…`) also run there (core only marks explicit `data-stagepass-path` on tracked files). `sp.vars` is again a plain frozen property in the core (2.3.1 form); reads in debug before the flag chunk has loaded simply do not hint. Visitor path without a session is unchanged (no new requests, same globals / `sp` API / production `data-src`/`data-href` / `?v=` / console behaviour). `sp` and `stagepass` remain always assigned (2.x compatibility; custom `data-stagepass-alias` still only when free). Client detection stays eager (2.0.0 behaviour).
- Measured `loader.min.js`: ~14882 / 6566 / 5866 (raw / gzip / brotli); 2.3.1 was 13798 / 6257 / 5588. The remaining core size stays above the 2.3.1 ceiling that 2.3.3 used. That was accepted as a **documented individual Donna exception**, not as a new permanent size baseline, and not as a full-review PASS.

#### Known limits

- Live reload acceptance is scoped localhost only. Not accepted: full default lifecycle `setup` / `start` / `stop`, System Trust / `certs renew`, autostart, login, boot, OS-crash recovery, or a real `.sp` + production Webflow origin path.

#### Fixed

- Retains published 2.3.3 guards: localhost ports 1 to 65535 without leading zeros; shared `isValidDomain` via `FlagState.vd`; ×N and time separated by a real space.

### [2.3.3] - 2026-11-05

Patch release of the loader only. CLI and modules are unchanged. 2.3.2 was not published; its changes ship in 2.3.3.

#### Fixed

- "Back to local" in the session card also returns to a previous session on `localhost` or `localhost:<port>`, not only `*.sp`.
- Valid ports for `localhost:<port>` (session domain, URL mode and return target) are exactly 1 to 65535 without leading zeros; `localhost:0`, `localhost:080`, an empty port and 65536+ are rejected and keep the button disabled.
- The message meta shows a real space between `×N` and the time (text, not only CSS).

#### Changed

- Size: `SFMono-Regular` was removed from the card's monospace font stack on purpose to save bytes (the stack falls back to the next monospace fonts); no shipped file is larger than in 2.3.1. `loader.min.js`: 13768 B / 6254 B gzip / 5575 B brotli; `flag-card.min.js`: 11852 B (2.3.1: 13798 / 6257 / 5588 and 11894).

### [2.3.1] - 2026-11-02

Patch release of the loader only. CLI and modules are unchanged. Visitors without a session see no change: same single request, no flag code runs, no extra listeners, storage or DOM.

#### Fixed

- Self-hosted loaders under another file name (for example `/js/stagepass.js`) loaded `flag.min.js` and `flag-card.min.js` from jsDelivr. The flag files now always come from the folder of the loader's own script URL, so a copy from `node_modules/@stagepass/loader/dist/` stays fully local. CDN embeds (`@2`, exact pins) request the same URLs as before.

#### Added

- `data-stagepass-flag-base` on the loader tag (or `window.stagepassFlagBase`) sets the folder of the flag files for an inlined or bundled loader. Only `http(s)` or relative URLs are used; `javascript:`, `data:`, `blob:` and URLs with credentials are ignored with a warning. Read only during a session.
- Without a script URL and without the option the flag files still load from jsDelivr at the same version, and debug sessions now show a warning about it.
- Size budget also checks brotli. `loader.min.js`: 13798 B minified / 6257 B gzip / 5588 B brotli (2.3.0: 13395 / 6067 / 5407). `flag.min.js` and `flag-card.min.js` are unchanged.

### [2.3.0] - 2026-11-02

Stable release of the 2.3 loader, identical in behaviour to 2.3.0-beta.4 (only the embedded version string changes). Non-breaking minor release: the public `sp` API, attributes, events, session handling and URL swapping behave as in 2.2.0. `@stagepass/cli` (2.2.1) and `@stagepass/modules` (2.2.0) are unchanged; the published modules peer range `>=2.0.0` accepts 2.3.0 without `--legacy-peer-deps`.

Visitors without a session load only `loader.min.js`, see nothing and get no extra listeners, no console wrapping and no `crossorigin` changes. Everything below appears only while a session (`?stagepass=<project>.sp` or `?stagepass=debug`) is active.

Summary of 2.3.0-beta.0 to 2.3.0-beta.4:

#### Changed

- New dev flag in three stages instead of the `STAGEPASS ACTIVE` / `STAGEPASS DEBUG` badge: a small pass-icon pill with a status dot at rest (amber for warnings, red for errors), expanded on hover or keyboard focus with `LOCAL` / `DEBUG` and the counters, and a session card on click. On touch devices the first tap expands and the second opens the card.
- No glow, shadow, blur or filter in any state; dark ink text and icons on the gradient, 1px low-opacity border.
- Clicking the flag no longer ends the session. Only "End session" in the card disconnects (same as `?stagepass=off`); Esc or a click outside closes the card and returns focus to the pill.
- The flag UI moved out of the loader into `dist/flag.min.js` and `dist/flag-card.min.js`, fetched only during a session (the card on first expand).
- The Chrome Local Network Access check runs once per page, and its hint is shown in the card only when a local file fails at the network level.
- "Script error." from another origin is shown as "Error in a cross-origin script (details only in DevTools console)" with source `external`.

#### Added

- Session card: project, session domain, a collapsed list of swapped files (live → local, `js`/`css`, `ok` / `404` / `failed`; only loaded files count as swapped) and the latest 50 message groups. Fixed header and footer with an inner scroll area that stays inside the viewport; `max-width: calc(100vw - 24px)` and 44px touch targets on mobile.
- Inspector with error context: each message keeps its source (`local`, `live`, `external`), `file:line:col` and a collapsible stack; repeats are grouped as `×N` with the last time. "Always expanded" (stored per origin), "Copy all" and per-message "Copy" as Markdown (page URL without query, project, loader version, messages; no cookies or storage).
- Locally swapped files load with `crossorigin="anonymous"` for full error details. Without a CORS header from the local server the file loads again without it and a warning says so.
- Counters and messages from `sp.warn` / `sp.error` / `sp.log`, `console.warn` / `console.error` (the original console still runs; arguments are serialized safely with limits), uncaught errors, failed resource loads and unhandled rejections (with stack). Failed local files report "Local file not found (404)" or "Local server not reachable … Run stagepass doctor".
- Card footer: Reload, "Debug mode" / "Back to local" (works in both directions, also from a new tab or a restored session; disabled with a reason when there is no session to return to) and End session.
- Shadow DOM rendering with DOM APIs only (no `innerHTML`, no `eval`), keyboard and screen reader support, `prefers-reduced-motion`.
- Size budget tests in CI for `loader.min.js`, `flag.min.js` and `flag-card.min.js`.
- Sizes: `loader.min.js` 13.1 KB minified / 5.9 KB gzip (2.2.0: 12.1 KB / 5.0 KB), `flag.min.js` 2.7 KB gzip, `flag-card.min.js` 4.8 KB gzip.

### [2.3.0-beta.4] - 2026-11-02

Prerelease of the loader only, on top of 2.3.0-beta.3. CLI and modules are unchanged. Visitors without a session see no change: no console wrapping, no `crossorigin`, no extra requests.

#### Added

- Inspector details: every message keeps its source (`local`, `live`, `external`), `file:line:col` and the stack. Rows are one-liners; a click shows the details. Repeats are grouped as `×N` with the last time.
- Locally swapped files load with `crossorigin="anonymous"`, so their errors keep message, location and stack. If the local server sends no CORS header, the file loads again without it and a warning explains that details are limited.
- `console.warn` and `console.error` on the page are captured during a session (the original still runs; arguments are serialized safely with depth and size limits). Unhandled rejections show the message and stack.
- Failed local files report "Local file not found (404)" or "Local server not reachable … Run stagepass doctor". The Local Network Access hint is added only to that network-level failure.
- Collapsed list of swapped files (live → local, `js`/`css`, `ok` / `404` / `failed`, full URLs in the tooltip).
- "Always expanded" toggle (stored per origin), "Copy all" and per-message "Copy" as Markdown (page URL without query, project, loader version, messages; no cookies or storage).

#### Changed

- "Script error." from another origin is shown as "Error in a cross-origin script (details only in DevTools console)" with source `external`.
- The swapped-files count only includes files that actually loaded.
- The Debug toggle is labelled by its action ("Debug mode" / "Back to local"). After the reload the pill expands briefly to show the new mode. The session to return to is stored in `localStorage`, so it also works from a new tab or a restored session. Without one the button is visibly disabled and the card says why.
- Card layout: fixed header and footer with an inner scroll area that never leaves the viewport; `max-width: calc(100vw - 24px)` and 44px touch targets on mobile.
- After a click outside the card, focus returns to the pill (unless the click focused something on the page).
- Sizes: `loader.min.js` 13.1 KB minified / 5.9 KB gzip (beta.3: 11.0 KB / 5.0 KB), `flag.min.js` 2.7 KB gzip, `flag-card.min.js` 4.8 KB gzip. Size budgets raised accordingly.

### [2.3.0-beta.3] - 2026-11-02

Prerelease of the loader only, on top of 2.3.0-beta.2. CLI and modules are unchanged. The public `sp` API, attributes, events and URL swapping behave as before.

#### Changed

- Dev flag v2, in three stages. At rest it is a small pass-icon pill with a status dot (amber for warnings, red for errors). On hover or keyboard focus it expands to the left and shows `LOCAL` / `DEBUG` and the counters. A click opens a session card. On touch devices the first tap expands and the second opens the card.
- Clicking the flag no longer ends the session. Only "End session" in the card disconnects (same as `?stagepass=off`). Esc or a click outside closes the card.
- The flag text, counters and icons are dark ink on the gradient. There is still no glow, shadow, blur or filter in any state, and the pill has a 1px low-opacity border.
- The Local Network Access hint is shown as a warning in the card instead of the tooltip.

#### Added

- Session card (340px, opaque, follows a dark or light page): project, session domain, number of files swapped locally, and the latest 50 warnings and errors with time and `file:line`. Messages are always rendered as text and long messages are truncated. Clicking a message copies it to the clipboard ("Copied").
- Card footer: Reload, a Debug on/off toggle (reloads with `?stagepass=debug` and back to the previous session) and End session.
- When the local dev server cannot be reached, the flag shows the error dot and the message "Local server not reachable … Run stagepass doctor".
- The card ships as a separate file, `dist/flag-card.min.js`, fetched on first expand next to `flag.min.js`.
- Accessibility: the pill is a button with `aria-expanded`, the card is a `role="dialog"` with an `aria-label`. Focus moves into the card on open and back to the pill on close, there is a visible focus ring, and with reduced motion all changes are instant.
- Size budget test for `flag-card.min.js`. Sizes: `loader.min.js` 11.3 KB minified / 5.1 KB gzip (beta.2: 10.5 KB / 4.7 KB), `flag.min.js` 2.6 KB gzip, `flag-card.min.js` 3.4 KB gzip.

### [2.3.0-beta.2] - 2026-11-02

Prerelease of the loader only, on top of 2.3.0-beta.1. CLI and modules are unchanged.

#### Changed

- Dev flag: the glow is removed. The pill has no shadows, glow layers or filters in any state (rest, hover, focus, entry animation), which also removes the glow artefacts Chrome showed on hover. Hover now slightly lightens the red gradient; keyboard focus keeps the crisp 2px outline. Label, icons, counters and click behaviour are unchanged.

### [2.3.0-beta.1] - 2026-11-02

Prerelease of the loader only, on top of 2.3.0-beta.0. CLI and modules are unchanged.

#### Fixed

- Dev flag: the glow could show a straight edge in Chrome (a hard horizontal line next to the pill, most visible on dark pages). The glow is now a radial gradient on its own layer that fades out completely inside its box instead of a large blurred `box-shadow`, and the entry animation fades and scales in place instead of sliding in from above the viewport. The flag sits 12px from the top right corner (was 10px) so the glow fades out before the window edge at the top.

### [2.3.0-beta.0] - 2026-11-02

Non-breaking minor prerelease of the loader only. `@stagepass/cli` (2.2.1) and `@stagepass/modules` (2.2.0) are unchanged; any 2.x CLI and modules work with it. The public `sp` API, attributes, events and URL swapping behave as in 2.2.0.

#### Changed

- New dev flag: a red `LOCAL` pill (or `DEBUG`) replaces the old `STAGEPASS ACTIVE` / `STAGEPASS DEBUG` badge. The LNA hint moves from the badge text to the tooltip and the warning counter.
- The flag UI moved to a separate file, `dist/flag.min.js`, fetched only while a session is active. Visitors without a session load less code: `loader.min.js` is 10.5 KB minified / 4.7 KB gzip (2.2.0: 12.1 KB / 5.0 KB).
- The Chrome Local Network Access check runs once per page instead of twice.

#### Added

- Warning and error counters on the flag: `sp.warn` / `sp.error` / `sp.log('warn' | 'error')`, uncaught errors, failed resource loads and unhandled rejections (listeners are only added during a session).
- The flag renders in a Shadow DOM, uses DOM APIs only and respects `prefers-reduced-motion`.
- Size budget test in CI for `loader.min.js` and `flag.min.js`.

### [2.2.2] - 2026-11-07

Republish of the 2.2 line from tag `v2.2.2` / commit `d531d30` alongside `@stagepass/modules` 2.2.2. Diff versus `v2.2.0` is only `packages/loader/package.json` version `2.2.0` → `2.2.2`; no functional loader changes.

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

### [2.2.2] - 2026-11-07

Published on npm 2026-11-07T13:48Z. Already on dist-tag `next` before promotion to `latest`. No further republish, tag, or version bump for the promotion. 2.2.1 was never published; its changes shipped in 2.2.2.

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
