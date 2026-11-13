# CLI reference

Package: `@stagepass/cli`. System commands require macOS (platform guard in `src/lib/platform.js`). Override for tests only: `STAGEPASS_SKIP_PLATFORM_CHECK=1`. `--version` and `--help` work everywhere.

**Requirements:** macOS (system commands exit with code 1 on other platforms). Published CLI 2.4.0 (`@stagepass/cli`) `engines.node` is `>=20.17.0`. Node 18 is no longer supported; stay on `@stagepass/cli@2.2.7` if you must remain on Node 18. Contributors develop and test on Node 22 or 24. The v3 site block needs Caddy 2.9 or newer (`brew upgrade caddy`). `brew install caddy` does not upgrade an existing install.

Typical order: `setup` → `start` → `link`, then `stagepass build` / `stagepass watch` / `stagepass dev` (then `reload` / `unlink` / `stop` as needed). Most commands support `-v, --verbose`.

This reference describes the published CLI **2.4.0** (npm `latest`).

## Commands

| Command | Description |
| --- | --- |
| `stagepass setup` | Install Caddy, PHP, Dnsmasq via Homebrew and configure the `.sp` resolver. |
| `stagepass start` | Start Caddy & PHP (certs check; offer repair when interactive; `launchctl kickstart` when autostart is on). Migrates legacy Caddyfile blocks if needed, except when Caddy is known to be older than 2.9 (`brew upgrade caddy`); those blocks stay as they are. Clears stale `devPort` entries. Non-interactive prints findings and a hint. No standby `sudo -v`: port 443 conflicts show process name and PID; SIGTERM first, SIGKILL only after a second confirmation; own processes without elevated rights first, `sudo kill` only after unprivileged failure. |
| `stagepass stop` | Stop services. With autostart enabled, uses `launchctl bootout` until next login (`autostart off` removes the LaunchAgent permanently). |
| `stagepass link [domain]` | Link the current directory to a `.sp` domain and reload Caddy. Writes a v3 site block. On Caddy older than 2.9, does not rewrite other existing blocks and warns that CORS on success responses may be missing (`brew upgrade caddy`). |
| `stagepass unlink [domain]` | Remove the link (and `projects.json` entry) for that domain. |
| `stagepass reload` | Reload Caddy configuration (also migrates legacy blocks if needed). Skips that rewrite when Caddy is older than 2.9 (`brew upgrade caddy`). |
| `stagepass doctor` | Read-only stack diagnostics (never sudo), plus project modules vs. live site, project PHP when `stagepass.json` has `"php": true\|false`. Unpinned CDN warnings (`@latest`, bare major `@1`, or bare package) in recommended snippets and project files. Reports the Caddy version and warns (does not fail) below 2.9 (`brew upgrade caddy`). Published CLI 2.3.1 and later also fails when a LaunchAgent node or CLI path is missing, and warns when that node path is a versioned Homebrew Cellar path or the running daemon version differs from the CLI. The fix hint on those checks is `stagepass autostart on`. `--json`, `--skip-site`. Exit `1` on any fail. |
| `stagepass certs check` | Read-only Caddy local CA / trust / TLS checks. `--json`, `--skip-handshake`. |
| `stagepass certs trust` | Run `caddy trust` after confirmation (or `--yes`). |
| `stagepass certs renew` | Repair failing linked `.sp` site certificates (`certificates/local/<domain>` + `caddy reload`). `--root` moves the local CA folder to a timestamped backup (never deletes) after double confirmation or `--yes --i-understand-root-renewal`. `--remove-orphans` deletes orphaned keychain roots by SHA-1 only after per-certificate confirmation (or `--yes`). |
| `stagepass autostart on\|off\|status` | User LaunchAgent (`io.github.arobertherz.stagepass`) for login start via `stagepass daemon`. |
| `stagepass daemon` | Foreground LaunchAgent helper (PHP-FPM, certs log-only, `caddy run`, macOS notifications via `osascript`); never sudo. |
| `stagepass new [name]` | Scaffold a lean Webflow project with `stagepass.json`, `AGENTS.stagepass.md`, a short `AGENTS.md` pointer, Cursor rule and typed `sp` (`--site` / `--site-modules`, `--staging` / `--production`, `--php` / `--no-php`, `--link`; `--yes` for non-interactive). |
| `stagepass build` | Run `npm run build` in the current project (no shell; exit code forwarded). |
| `stagepass watch` | Run `npm run watch` in the current project (no shell; exit code forwarded). Checks whether Stagepass is running and whether the cwd is linked: interactive TTY offers `stagepass start`; non-TTY / CI prints a one-line hint and continues; unlinked cwd gets a `stagepass link` hint. |
| `stagepass dev` | Run `stagepass watch` plus a loopback SSE event server proxied at `/__stagepass/live` on the linked `.sp` domain (CSS can swap without a full reload). Same running check as `watch` (offer/hint to start). Requires a linked project (`stagepass link`). See [dev.md](./dev.md). |
| `stagepass upgrade` | Bump `@stagepass/*`, detect the modules your live site loads, sync `stagepass.json`, `AGENTS.stagepass.md`, the short `AGENTS.md` pointer, the Cursor rule and editor types (`types` or `stagepass.d.ts`), print Webflow snippets. `--dry-run` writes nothing. Replaces an unmodified `scripts/build.mjs`, and a hand-edited `AGENTS.stagepass.md`, with `--yes` or a TTY confirmation. Since 2.4.1, writes a missing PHP `.htaccess` when `"php": true`. |

If the domain argument is omitted, commands default to the current folder name. The `.sp` suffix is added automatically if missing. Domain values are normalized (strips `https://`, trailing slashes).

## Declared modules, AI guide and types

Projects created or upgraded with CLI 2.2+ declare in `stagepass.json` which modules their Webflow site loads: `"modules": []`, `["cookies"]` (any of `inject`, `cookies`, `maintenance`) or `["all"]`. `stagepass new --site <host>` and `stagepass upgrade` read this from the live site (public https GET, no cookies; regex on `<script src>` only, nothing executed): jsDelivr/unpkg `/dist/…` and package-root URLs, plus self-hosted Stagepass build files (path or `data-stagepass-*` hint). Self-hosted matches report `cdn: "self"` for display only — `upgrade` does not rewrite those tags to CDN. See [Live site detection](../packages/cli/README.md#live-site-detection). They ask you to confirm. `stagepass doctor` warns when the declared list and the live site differ.

From that list the CLI generates `AGENTS.stagepass.md` (the `sp` API reference, plus the rest of the Stagepass guide), a short pointer in `AGENTS.md` (between `<!-- stagepass:begin -->` and `<!-- stagepass:end -->`), `.cursor/rules/stagepass.mdc` (`alwaysApply: true`, `@AGENTS.stagepass.md`), and `compilerOptions.types`:

```json
{ "compilerOptions": { "types": ["@stagepass/loader", "@stagepass/modules/cookies"] } }
```

`@stagepass/loader` types `sp` / `window.stagepass`; `@stagepass/modules/inject`, `/cookies`, `/maintenance` add one module each, and `@stagepass/modules` adds all of them (unchanged from 2.0). See [`packages/cli/README.md`](../packages/cli/README.md) for details.

Published `@stagepass/loader` 2.5.0 `global.d.ts` augments `Window` with `sp` and `stagepass` (both `StagepassAPI`, including `resolveLocalUrl`, `vars`, and `log`) and declares global `var sp` / `var stagepass`. `stagepass new` and `stagepass upgrade` write `compilerOptions.types` including `@stagepass/loader`. The scaffold `src/main.ts` still uses a narrow manual cast for `sp.log`. The official types are wider.

## `link`

* `[domain]` is optional; defaults to the current folder name. Values are lowercased; `.sp` is appended if missing. Invalid folder names are slugified when the argument is omitted.
* Output on success: `Linked: https://<domain>.sp -> <absolute-root>`.

| Option | Behaviour |
| --- | --- |
| `--origin <host>` | Allow CORS from this live hostname (**repeatable**). Accepts `example.com`, `www.example.com`, `*.example.com`, or `https://example.com` (bare hostname or `https://` only; no path/port). Merges into the stored list. |
| `--remove-origin <host>` | Remove a stored CORS hostname (**repeatable**; same validation). |
| `--allow-all-origins` | Set `Access-Control-Allow-Origin: *` (prints a warning). Prefer `--origin`. |
| `--no-allow-all-origins` | Disable allow-all and use the origin allowlist. |
| `-v, --verbose` | Show Caddy reload output. |

Omitting both allow-all flags keeps the stored / seeded setting. New links default to allowlist mode (`allowAllOrigins: false`).

`link` uses `origin` / `production` from `stagepass.json` when no `--origin` flags are passed. You can still pass `--origin` explicitly for CORS.

**Default CORS allowlist (always):** `https://*.sp`, `http(s)://localhost[:port]`, `http(s)://127.0.0.1[:port]`, plus any `--origin` / `~/.stagepass/projects.json` entries. **`*.webflow.io` is not a default**; add e.g. `--origin my-project.webflow.io`. Explicit `--origin *.webflow.io` is allowed but warns.

Dotfiles / `node_modules` / sensitive extensions always return **404** on linked sites. Full security notes: [Security Architecture](./loader.md#security-architecture) and [`packages/cli/README.md`](../packages/cli/README.md).

## `new`

Scaffold a lean Webflow project (TypeScript + SCSS by default). Flags for every option; `--yes` / `--dry-run`.

| Option | Behaviour |
| --- | --- |
| `--dir <dir>` | Target directory (default: `./<name>`) |
| `--author <author>` | Author for `package.json` (default: git `user.name`) |
| `--lang ts\|js` | Language (default: `ts`) |
| `--styles scss\|css` | Styles (default: `scss`) |
| `--modules` / `--no-modules` | Include `@stagepass/modules` (npm, types) |
| `--site <host>` | Live Webflow site to detect loaded modules from (https); also sets `origin` in `stagepass.json`. Must match `--staging` when both are set. |
| `--site-modules <list>` | Modules the site loads: `none`, `all`, or `inject,cookies,maintenance` |
| `--staging <domain>` | Staging hostname written to `stagepass.json` as `origin` (wizard suggests `<name>.webflow.io`) |
| `--production <domain>` | Optional production hostname written to `stagepass.json`. Skipping production prints a short `stagepass link --origin` hint. |
| `--php` / `--no-php` | Enable the PHP boilerplate (`api/` + `.php/config.php`, `php_fastcgi` on link). Default off. The interactive wizard always asks this unless the flag is set. Existing linked projects without a `php` setting keep PHP on (non-breaking). |
| `--php-examples` / `--no-php-examples` | Deprecated. Sample actions (`ping`, `contact`) ship with `--php` under `api/actions/`. Accepted, no extra files. |
| `--link` / `--no-link` | Run `stagepass link` after scaffolding (macOS only; interactive ask unless `--link` / `--yes`) |
| `--git` / `--no-git` | Initialize a git repository |
| `--remote <url>` | Git remote URL (requires git) |
| `--install` / `--no-install` | Run `npm install` after scaffolding (default off) |
| `-y, --yes` | Non-interactive; accept defaults for omitted flags |
| `--dry-run` | Print the file plan without writing |
| `-v, --verbose` | Show detailed output |

Interactive macOS doctor preflight can offer `setup` (never automatic, never under `--yes` / no-TTY).

Prefer `stagepass build`, `stagepass watch` and `stagepass dev` (the last also starts live reload). `npm run dev` still aliases `watch`. `stagepass build` writes stable `dist/main.js` and `dist/styles.css` plus content-hashed copies and SRI (`integrity` sha384) in `dist/manifest.json`, and rewrites a dist file only when its bytes change. CLI 2.4.0 `stagepass watch` and `stagepass dev` write only the stable files and leave hashes and `manifest.json` as the last `stagepass build` left them. Published CLI 2.3.1 still writes hashes and `manifest.json` from watch when bytes change. That same scaffold's `stagepass build` still writes hashes, then deletes hashed names the previous manifest listed that the new one does not, including CLI 2.2.x string manifests (`"main.js": "main.<hash>.js"`) and later `{ "file", "integrity" }` entries. Only plain `<base>.<8 hex><ext>` files directly in `dist/` are removed. When `stagepass.json` has `"php": true`, that build also copies `api/`, `.php/config.php`, and, since 2.4.1, a project-root `.htaccess` into `dist/` (never `.env`, `.php/.env`, `.php/rate-limit/`, logs, pid files, or key, certificate, or database files: `.pem`, `.key`, `.p12`, `.pfx`, `.crt`, `.cer`, `.sqlite`, `.db`; `.htaccess` and `.env.example` are kept). Generated projects depend on `@stagepass/loader` / `@stagepass/modules` `^2` (same major as the CDN pin `@2`).

## PHP

Optional plain PHP 8.2 (no Composer, no mail). `stagepass new --php` writes `api/action.php` (the only public file), `api/actions.php`, `api/.env.example`, `.php/config.php`, and, since 2.4.1, a web-root `.htaccess`. Copy the example to `.env` and set `ALLOWED_ORIGINS`, including `https://<name>.sp`. Linked sites serve `https://<name>.sp/api/action.php` through Caddy `php_fastcgi`. Caddy returns 404 for hidden segments (`/.env`, `/api/.env`, `/.php/`). `doctor`, `dev`, and `watch` warn if PHP is missing, older than 8.2, or has no `php-fpm` / `php-cgi`, and the JS build continues. On macOS install PHP with `brew install php`. `stagepass dev` and `stagepass watch` on a `"php": true` project start Homebrew php-fpm (`brew services start php`, and `brew services restart php` only if start fails), the same helper `stagepass start` has used since 2.3. `stagepass build` copies `api/`, `.php/config.php`, and a project-root `.htaccess` into `dist/` for upload (document root is the folder that contains `api/`, so the public URL stays `/api/action.php`) and never copies `.env`, rate-limit files, logs, pid files, or key, certificate, or database files (`.pem`, `.key`, `.p12`, `.pfx`, `.crt`, `.cer`, `.sqlite`, `.db`). It keeps `.htaccess` and `.env.example`. Watch does not copy PHP; FastCGI reads the project root. The website guide is live at [https://stagepass.one/docs/php/](https://stagepass.one/docs/php/) (source outline: [php.md](./php.md)).

`load_config()` reads `.env` in the project root (the copy of `api/.env.example`) and `.php/.env`. It never reads `api/.env`. `stagepass build` does not copy those files into `dist/`. It does copy `.php/config.php`. After you upload `dist/`, that folder is the web root, so `.php/` (including `.php/config.php`) is public on Apache and nginx unless hidden paths are denied. The starter comments that say the config sits "outside the public root" and "outside the public api/ directory" describe the layout relative to `api/`, not a second directory outside the web root. Since 2.4.1 those comments name the document root (the folder that contains `api/`). Published CLI 2.4.0 still has the old wording. Caddy already returns 404 for any path segment that starts with `.` (`/.env`, `/.php/`, `/api/.env`). Published CLI 2.4.0 does not ship an Apache or nginx deny rule. Since 2.4.1 the PHP scaffold ships the Apache `.htaccess` below. nginx still needs the snippet on the host. Prefer real environment variables so a `.env` file is not required in the web root. `stagepass new` does not overwrite an existing `.htaccess`. `stagepass build` copies a project `.htaccess` into `dist/` and leaves a `dist/.htaccess` in place when the project has none. [quYArF43](https://trello.com/c/quYArF43).

Apache, in the web root `.htaccess`. The host needs `AllowOverride All` and `mod_rewrite`. The rule follows HTML5 Boilerplate [`file_access.conf`](https://github.com/h5bp/server-configs-apache/blob/main/h5bp/security/file_access.conf), wrapped in `IfModule`:

```apache
<IfModule mod_rewrite.c>
    RewriteEngine On
    RewriteCond %{REQUEST_URI} "!(^|/)\.well-known/([^./]+./?)+$" [NC]
    RewriteCond %{SCRIPT_FILENAME} -d [OR]
    RewriteCond %{SCRIPT_FILENAME} -f
    RewriteRule "(^|/)\." - [F]
</IfModule>
```

nginx, inside the server block, before the PHP `location ~ \.php$` block. If this location comes later, `/.php/config.php` can be passed to php-fpm. The rule follows HTML5 Boilerplate [`security_file_access.conf`](https://github.com/h5bp/server-configs-nginx/blob/main/h5bp/location/security_file_access.conf):

```nginx
location ~* /\.(?!well-known\/) {
    deny all;
}
```

Both rules were tested on 12 November 2026 on php:8.2-apache (`AllowOverride All`, `a2enmod rewrite`) and on nginx 1.27 with php:8.2-fpm. `/.env`, `/.php/config.php`, `/api/.env.example`, and `/.git/HEAD` returned HTTP 403, with no secret or config leak. `/api/action.php?action=ping` returned HTTP 200, `{"status":"success","data":{"pong":true},"message":null}`. `/.well-known/test.txt` returned HTTP 200, body `well-known-ok`. `/.well-known/` as a directory with no index file returned HTTP 403 on both servers (no DirectoryIndex). Visible files under `/.well-known/` stay reachable. The longer page is [php.md](./php.md).

The document root is the folder that contains `api/`. Caddy sets `root *` to the project path, then `php_fastcgi 127.0.0.1:9000` and `file_server`, so the public URL is `/api/action.php`. Upload `dist/` after `stagepass build` (it contains `api/` and `.php/config.php`). From that same folder, `php -S 127.0.0.1:8080 -t .` keeps the URL `/api/action.php`. The published npm 2.4.0 package README already uses `-t .`. `php -S 127.0.0.1:8080 -t api` serves `/action.php` and does not match this layout. PHP's built-in server does not apply Caddy's hidden-path 404. Prefer `stagepass dev` or the linked `.sp` domain, and do not point `php -S -t .` at a folder that already contains a real `.env`. The package README includes that `php -S` warning since 2.4.1. Published CLI 2.4.0 does not.

`sp.resolveLocalUrl` (`@stagepass/loader` 2.5.0) returns a local HTTPS URL only during an active `.sp` session, otherwise `''`. On a Webflow page the production fallback is the absolute URL of the PHP host, for example `https://php.example.com/api/action.php`. `origin` and `production` in `stagepass.json` are Webflow hosts. There is no helper that turns them into the PHP base URL. `contact.php` validates a JSON or form POST and does not send mail. A native Webflow form needs its own submit listener (`preventDefault`, then `fetch` to that PHP host). There is no shipped helper for that.

`stagepass upgrade` does not add the PHP `api/` or `.php/` boilerplate. Since 2.4.1, when `stagepass.json` has `"php": true` and the project root has no `.htaccess`, upgrade writes the shipped template (same bytes as `stagepass new --php`). An existing `.htaccess` is not overwritten or modified. If it has no `RewriteRule "(^|/)\." - [F]` line, upgrade prints a hint (https://stagepass.one/docs/php/ and `api/README.md`) and still exits 0. A symlink or directory named `.htaccess` is left in place. Projects without `"php": true` are unchanged. `--dry-run` writes nothing. Published CLI 2.4.0 does not write this file. Scaffold a throwaway project with `stagepass new tmp --php --yes --no-link` and copy `api/` and `.php/` into the existing project (do not overwrite files you already edited, including an existing `.htaccess`). Or copy from the installed CLI templates, renaming `api/env.example` to `api/.env.example` and `php-private/config.php` to `.php/config.php` (npm pack drops dot paths; the `htaccess` template ships since 2.4.1 and upgrade writes it when the file is missing). Set `"php": true` in `stagepass.json`, copy `api/.env.example` to `.env`, set `ALLOWED_ORIGINS`, and run `stagepass link` again so the Caddy block gets `php_fastcgi`. If `scripts/build.mjs` is still an unmodified older scaffold, `stagepass upgrade` can replace it so `publishPhp` is included. An edited script stays as-is and needs that copy logic added by hand. Upgrade does not replace `api/action.php`. A project created with published CLI 2.4.0 keeps that file, so an allowed OPTIONS preflight still sends `X-Powered-By`. Before `http_response_code(204)`, insert `if (!headers_sent()) { header_remove('X-Powered-By'); }`, the same lines 2.4.1 ships. Or set `expose_php = Off` in php.ini. `php_flag expose_php off` in `.htaccess` and `ini_set('expose_php', '0')` do not change it (`expose_php` is `PHP_INI_SYSTEM`). Verified 13 November 2026 on php:8.2-apache.

`rate_limit_allows()` logs storage faults (directory, file, `flock`, or a thrown error). The response is HTTP 503, JSend `error`, `Retry-After: 60`, and no internals, unless `APP_ENV` is `local`, `development`, or `dev` (trimmed, any case). Empty, unset, and every other value stay closed. Those three names allow the request and write the same log line. A limit hit stays HTTP 429. `client_ip()` uses `REMOTE_ADDR` unless that peer is in `TRUSTED_PROXIES` (IPv4 or IPv6 addresses and CIDRs). Only then does it read `TRUSTED_PROXY_HEADER` (`x-forwarded-for` by default, or RFC 7239 `forwarded`) and walk the hops from right to left, skipping trusted proxies. Hops to the left of the client are ignored. An invalid hop in the trusted-proxy suffix falls back to `REMOTE_ADDR` without logging the raw header. This applies to projects created with the next release. `stagepass upgrade` does not change `api/`. Copy `api/lib/security.php`, `api/lib/request.php`, `api/lib/config.php`, `.php/config.php`, and `api/action.php` from a new scaffold, or re-scaffold. [sgt7wKlT](https://trello.com/c/sgt7wKlT).

## `upgrade`

* `--dry-run`: show changes without writing any file
* `--site <host>`: live Webflow site to detect loaded modules from (https)
* `--site-modules <list>`: modules the site loads (`none`, `all`, or `inject,cookies,maintenance`)
* `--skip-site`: do not fetch the live site
* `-y, --yes`: non-interactive; accept detected or existing modules, replace an unmodified `scripts/build.mjs`, and replace a hand-edited `AGENTS.stagepass.md`. Required for those replacements when there is no TTY.
* `--target <version>`: docs often say `--version`; the CLI rewrites that to `--target` so it does not collide with `stagepass --version`
* `-v, --verbose`

`upgrade` only writes ranges that a published version satisfies. An explicit `--target` that is not published is refused before any file is written. Without a TTY it maps the legacy `"modules": true` to `["all"]` instead of `[]`, and prints a hint for narrowing (`--site-modules cookies`).

`AGENTS.stagepass.md` is refreshed without a prompt when its managed hash still matches. A hand edit, or a file with no managed header, is replaced only with `--yes` or a TTY confirmation (default yes). See [AGENTS.stagepass.md](#agentsstagepassmd).

`scripts/build.mjs` is replaced when it is still an unmodified scaffold from an earlier CLI. The check hashes the file against known templates from this repo after normalizing line endings. The scaffold entry lines (`src/main.js`, `src/main.ts`, `src/styles.css`, `src/styles.scss`) still count as unmodified. On a TTY the prompt defaults to yes. `--yes` replaces it without asking, including when there is no TTY. Without a TTY and without `--yes`, the file stays and the CLI prints a hint (Trello `jd36WpR1`). `--dry-run` writes nothing. An edited script is left in place. The CLI then prints what `stagepass build`, `stagepass watch` and `stagepass dev` do in the current scaffold and points at this section. A missing `scripts/build.mjs` is left missing. A symlink is left unchanged. Published CLI 2.3.1 does not replace `scripts/build.mjs`. Published CLI 2.4.0 still replaces an unmodified scaffold without a TTY and without `--yes`. `upgrade --json` is not a mode: published CLI 2.4.0 and this CLI both reject the flag, write nothing, and print no JSON object.

Since 2.4.1, when `stagepass.json` has `"php": true` and the project root has no `.htaccess`, `upgrade` writes the shipped template. An existing file is left unchanged. If it has no `RewriteRule "(^|/)\." - [F]` line, a hint is printed and the command still exits 0. A symlink or directory named `.htaccess` is left in place. Published CLI 2.4.0 does not write that file.

### Types in existing projects

Unreleased (ships in CLI 2.5.0). Published CLI 2.4.0 only updates a plain `compilerOptions.types` array and otherwise prints a hint. The next CLI, still via `stagepass upgrade`:

1. `stagepass upgrade` (`--dry-run` writes nothing). Adds a missing `@stagepass/loader` devDependency, and `@stagepass/modules` only when modules are declared. Does not run `npm install`. A plain config that already has a `types` array is updated. Otherwise it writes `stagepass.d.ts` (`// @stagepass-types` plus `/// <reference types="..." />`) where `include` already covers it. With no config the file is still written at the project root. Editors load it only as part of a project, so the command notes that you should add a `jsconfig.json` or `tsconfig.json` that includes your sources and `stagepass.d.ts`, for example `{"include": ["src", "stagepass.d.ts"]}`, then run `stagepass upgrade` again. Upgrade does not create that config. The note is printed on `--dry-run` as well. Comments and invalid JSON are not edited. If `include` or `files` would miss the file, the command reports that and leaves the config unchanged. A `stagepass.d.ts` without the marker is left unchanged. Missing `stagepass.json` does not skip this step.
2. `npm install`
3. Editor command palette: `TypeScript: Restart TS Server`.

See [Troubleshooting](./troubleshooting.md#editor-reports-cannot-find-name-sp).

## Config locations

* `~/.stagepass/Caddyfile`
* `~/.stagepass/projects.json` (roots, CORS, optional `php`, live-reload `devPort` / `devPid` while `stagepass dev` runs)
* `~/.stagepass/server.log` (detailed logs when not verbose)
* Project `stagepass.json` (name, domain, modules, origins, optional `php`, optional `outDir`)

## AGENTS.stagepass.md

`stagepass new` and `stagepass upgrade` write `AGENTS.stagepass.md` in the project root. The CLI owns that file. The header is `<!-- stagepass:managed cli=<version> sha256=<hash of the body> -->`, then one sentence: generated by `@stagepass/cli`, do not edit by hand, `stagepass upgrade` rewrites it, and your own notes belong in `AGENTS.md`.

The body follows the CLI version and `stagepass.json`: declared `modules`, `php`, `lang`, `origin`, and `production`. It contains the feature set, safe rules, the local workflow (`stagepass build`, `stagepass watch`, `stagepass dev`, `stagepass start`, `stagepass link`; npm scripts only as a fallback), editor types, the loader API, and only the declared modules. When `"php": true` and `api/lib/` exists, it also documents the PHP request flow, helper signatures, and the three-step action recipe. When `"php": true` but `api/lib/` is missing, the PHP section tells the agent to ask the user to add the boilerplate with the CLI, and upgrade prints a hint. Upgrade does not copy `api/`.

`AGENTS.md` is yours. The CLI only maintains the short block between `<!-- stagepass:begin -->` and `<!-- stagepass:end -->`. Text outside the markers stays byte for byte. Older scaffold sections that used to live outside the block (feature set, safe rules) are not deleted. Upgrade names them so you can remove them. A missing `AGENTS.md` is created with a title and that short block.

A hand-edited `AGENTS.stagepass.md` (the body hash does not match the header, or there is no managed header) is replaced only with `--yes` or after a TTY confirmation. Otherwise it stays, and the CLI tells you to rerun with `--yes`. A second upgrade writes nothing when the file is already current. Symlinks are left unchanged. `.cursor/rules/stagepass.mdc` uses `alwaysApply: true` and points at `@AGENTS.stagepass.md`. A rule file without stagepass markers is left unchanged. An existing `CLAUDE.md` receives the same short pointer. That file is not created.

`upgrade --json` is still not a mode. Published CLI 2.4.0 and this CLI reject the flag, write nothing, and print no JSON object.

For projects without the CLI, use one of the following canonical profiles in your project-level `AGENTS.md` so coding agents know exactly which Stagepass runtime APIs are available. A project created with the CLI should follow `AGENTS.stagepass.md` instead of pasting these profiles.

### Canonical profile files

* Loader only: [`AGENTS.LOADER.md`](../AGENTS.LOADER.md)
* Loader + Modules (Injector + Cookies): [`AGENTS.MODULES.md`](../AGENTS.MODULES.md)

### How to use

1. Copy the relevant file content into your project `AGENTS.md`.
2. Keep only one active profile per project to avoid ambiguous API assumptions.
3. If your tooling supports remote include/import in AGENTS files, you can reference the raw GitHub URL instead of copy-paste.

Example raw URLs:

* `https://raw.githubusercontent.com/arobertherz/stagepass/master/AGENTS.LOADER.md`
* `https://raw.githubusercontent.com/arobertherz/stagepass/master/AGENTS.MODULES.md`

If your tooling does **not** support remote include/import, use copy-paste from the files above.
