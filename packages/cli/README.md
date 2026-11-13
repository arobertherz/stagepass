# `@stagepass/cli`

Local development orchestrator for Webflow projects.

The CLI sets up and manages the local Stagepass infrastructure (`.sp` domains, Caddy, DNS, PHP) so your live Webflow site can load local assets through the Stagepass loader.

## Install

Published CLI 2.4.0 requires Node.js **20.17+** (`engines.node`: `>=20.17.0`) on **macOS** with Homebrew, because `@inquirer/prompts@8` requires it. Node 18 is no longer supported; stay on `@stagepass/cli@2.2.7` if you must remain on Node 18. Development and CI use Node 22 or 24.

```bash
npm install -g @stagepass/cli@2
```

Or without a global install:

```bash
npx @stagepass/cli@2 setup
```

## Requirements

- **macOS** (system commands refuse other platforms with exit code 1; this is not a breaking change because those commands never worked off macOS)
- Published CLI 2.4.0: Node.js `>=20.17.0`. Use Node 22 or 24 for local development and CI
- Homebrew

`stagepass --version` and `stagepass --help` work on any platform. For tests/CI only, set `STAGEPASS_SKIP_PLATFORM_CHECK=1` to bypass the macOS guard (not for production use).

## Quick Start

Recommended order:

```bash
stagepass setup
stagepass start

# inside your project folder
stagepass link my-project --origin www.example.com --origin my-project.webflow.io
stagepass build
stagepass dev
```

Your project is then available at `https://my-project.sp`. Success output:

```text
Linked: https://my-project.sp -> /absolute/path/to/project
```

## Commands

| Command | Description |
| :--- | :--- |
| `stagepass setup` | Install Caddy, PHP, Dnsmasq via Homebrew and configure the local `.sp` resolver (`address=/.sp/127.0.0.1` + `/etc/resolver/sp`). |
| `stagepass start` | Start Caddy & PHP. Runs `certs check` (offers repair when interactive). No unconditional root warm-up: inspects port 443 without sudo; signals only after confirm (TERM then optional KILL; sudo only if unprivileged kill fails). With autostart installed, bootstraps/kickstarts the LaunchAgent (else direct `caddy start`). Migrates legacy Caddyfile blocks if needed, except when Caddy is known to be older than 2.9 (`brew upgrade caddy`). |
| `stagepass link [domain]` | Link the current directory to a `.sp` domain, write/update the Caddyfile + `~/.stagepass/projects.json`, reload Caddy. The linked block is v3. On Caddy older than 2.9, other existing blocks are left unchanged and CORS on success responses may be missing (`brew upgrade caddy`). |
| `stagepass unlink [domain]` | Remove the site block and `projects.json` entry, reload Caddy. |
| `stagepass reload` | Reload Caddy configuration. Migrates legacy Caddyfile blocks if needed, except when Caddy is known to be older than 2.9 (`brew upgrade caddy`). |
| `stagepass stop` | Stop Caddy & PHP. If autostart is installed/loaded, `launchctl bootout` first (until next login); use `autostart off` to disable permanently. |
| `stagepass doctor` | Read-only diagnostics (Homebrew, Caddy, PHP/php-fpm, dnsmasq, resolver, port 443, Caddyfile, projects, certs, LaunchAgent, declared modules vs. live site). CDN pin warnings in docs + project files. Reports the Caddy version and warns (does not fail) when it is older than 2.9 (`brew upgrade caddy`); the v3 site block needs 2.9 or newer. Published CLI 2.3.1 and later fails when a LaunchAgent node or CLI path is missing, and warns on a versioned Homebrew Cellar node path or a daemon version that differs from the CLI (fix hint: `stagepass autostart on`). Never uses sudo. `--json`, `--skip-site`. Exit `1` if any fail. |
| `stagepass certs check` | Read-only Caddy local CA check (validity, System keychain trust, orphans, optional TLS handshake per linked domain). `--json`, `--skip-handshake`. |
| `stagepass certs trust` | Run `caddy trust` after interactive confirmation (or `--yes`). |
| `stagepass certs renew` | Repair failing linked site certs; `--root` moves the CA folder to a backup (double confirm, or `--yes --i-understand-root-renewal`); `--remove-orphans` deletes keychain orphans by SHA-1 after confirm. |
| `stagepass autostart on\|off\|status` | Manage a user LaunchAgent (`io.github.arobertherz.stagepass`) that runs `stagepass daemon` at login. |
| `stagepass daemon` | Non-interactive LaunchAgent helper (PHP-FPM ensure, certs log-only, `caddy run`, macOS notifications). Never uses sudo. |
| `stagepass new [name]` | Scaffold a lean Webflow project (TypeScript + SCSS by default). |
| `stagepass build` | Run `npm run build` in the current project (forwards exit code). |
| `stagepass watch` | Run `npm run watch` in the current project (forwards exit code). If Stagepass is not running, asks to start it (TTY) or prints a `stagepass start` hint (non-TTY / CI); warns with `stagepass link` when the cwd is not linked. |
| `stagepass dev` | Like `stagepass watch`, plus live reload on the linked `.sp` domain (CSS can swap without a full reload). Same running check as watch; requires `stagepass link` (hard error if unlinked). |
| `stagepass upgrade` | Bump `@stagepass/*`, sync declared modules, `AGENTS.md`, the Cursor rule and `types`, print Webflow snippets. Since 2.4.1, writes a missing PHP `.htaccess` when `"php": true`. |

All commands support `-v, --verbose` where applicable.

### Doctor / certificates / autostart

- `doctor` and `certs check` are read-only. They never delete keychain items or certificate files.
- Prefer CDN major pin `@2` in Webflow custom code. Doctor warns on unpinned CDN URLs (`@latest`, bare `@1`, or unversioned `@stagepass/loader` / `@stagepass/modules` in recommended snippets and in the current project's `README.md`, `stagepass.json`, and `*.html` files directly in the project root and in `snippets/`; non-recursive, regular files ≤ 1 MB, symlinks skipped).
- `certs renew` is opt-in and confirmation-gated. Site repair only deletes `certificates/local/<linked-domain>` after checks fail. `--root` moves the CA folder to a timestamped backup (never deletes; needs two interactive confirmations without `--yes`, or `--yes --i-understand-root-renewal`). `--yes` alone always aborts for `--root` (TTY or not). Do not combine `--root` with `--remove-orphans`; run them as separate commands. Orphans are removed only by SHA-1 via `renew --remove-orphans`.
- Chrome may require Local Network Access permission for public HTTPS pages that load `https://*.sp` assets.
- Autostart runs as your user (same privilege model as interactive `caddy start`). `start` kickstarts the agent when present; `stop` bootouts until the next login. If port 443 cannot be bound, `daemon` logs a clear error, may notify, and exits `0` so launchd KeepAlive does not restart-loop. Interactive `start` confirms before signalling any non-caddy listener (name + PID; SIGTERM then optional SIGKILL). Own processes are signalled without elevated rights first; `sudo` only when needed after confirmation. There is no standby `sudo -v`.
- `stagepass autostart on` records a launchd-safe `PATH` from `brew --prefix` (Apple Silicon `/opt/homebrew`, Intel `/usr/local`) plus `/usr/bin:/bin:/usr/sbin:/sbin`. It does **not** copy your interactive shell environment. `brew` and `caddy` must resolve to shims under that prefix's `bin`/`sbin` (normal Homebrew Cellar symlinks are fine). Missing Homebrew/Caddy aborts **before** writing the plist. Published CLI 2.3.1 and later uses the Homebrew `bin/node` shim when the running node is a versioned Cellar path.
- Published CLI 2.3.1 and later `stagepass doctor` fails when a LaunchAgent node or CLI path is missing. It warns when that node path is a versioned Homebrew Cellar path, or when the running daemon version differs from the CLI. The fix hint is `stagepass autostart on`.
- Published CLI requires Node `>=20.17.0`. Node 18 is no longer supported; stay on `@stagepass/cli@2.2.7` if you must remain on Node 18.
- Manual macOS checklist: [`TESTING-macos.md`](./TESTING-macos.md).

#### macOS permissions (keep these separate)

These are different prompts. Grant only the narrow dialog macOS shows. Stagepass never asks for Full Disk Access or any security bypass.

| Concern | What it is | Typical fix |
| :--- | :--- | :--- |
| **System CA trust** | Trusting Caddy's local CA in the System keychain (`stagepass certs trust` / `caddy trust`) so browsers accept `https://*.sp`. | Run `stagepass certs check`, then `certs trust` if needed. Unrelated to TCC file access. |
| **Browser Local Network Access** | Chrome (and similar) gating public HTTPS pages that fetch `https://*.sp` / loopback. | Allow Local Network for the **browser** when it prompts. Not a Node Desktop-files grant. |
| **Node files access (TCC)** | macOS may ask the **Node** binary for access to a folder (commonly **Desktop**) when the CLI or LaunchAgent reads a project / test package living there. | Grant that folder to Node if you intentionally keep projects on Desktop. Prefer installing the CLI in a stable location (below) so everyday use does not depend on Desktop TCC. |

#### Install location and LaunchAgent paths

- Prefer a **stable** global install (`npm install -g @stagepass/cli` into the normal npm prefix, or another fixed absolute path). Avoid pointing autostart at a temporary Desktop unpack / ad-hoc test tarball when you can use the published package instead.
- `autostart on` records **absolute** Node and CLI paths plus the validated Homebrew `PATH`. Published CLI 2.3.1 and later uses the Homebrew `bin/node` shim when the running node is a versioned Cellar path (it does not store that versioned binary). It does not follow later `brew` upgrades automatically.
- After a Homebrew Node upgrade/cleanup, moving the CLI, or changing the npm prefix, run `stagepass autostart on` again so ProgramArguments stay valid. A brief local outage while the agent reloads is expected.
- Upgrading the global CLI package does **not** rewrite an existing LaunchAgent that still points at an older test path. Switch deliberately: `stagepass autostart off` then `autostart on` with the stable CLI you want. Do **not** delete a test directory while a loaded agent still references it; disable/refresh the agent first.
- Development checkouts (`packages/cli`, Desktop test packs) and the published global install are different binaries; compare behaviour with one style at a time.

### `new` options

Scaffold a project with flags for every choice (interactive prompts only on a TTY without `--yes`):

| Option | Behaviour |
| :--- | :--- |
| `--dir <dir>` | Target directory (default: `./<name>`). |
| `--author <name>` | `package.json` author (default: `git config user.name`). |
| `--lang ts\|js` | Language (default: `ts`). |
| `--styles scss\|css` | Styles (default: `scss`). |
| `--modules` / `--no-modules` | Include `@stagepass/modules` as npm dependency (default: yes; forced on when `--site-modules` lists a module). |
| `--site <host>` | Live Webflow site (https) to detect the loaded modules from. Also sets `origin` in `stagepass.json`. |
| `--staging <domain>` | Staging hostname (hostname only; same validation as `--origin`). Stored as `origin`. Must match `--site` when both are set. |
| `--production <domain>` | Optional production hostname. Stored as `production`. When omitted, prints a short hint to add it later via `stagepass link --origin`. |
| `--site-modules <list>` | Modules the site loads: `none`, `all`, or a comma list of `inject`, `cookies`, `maintenance`. Takes precedence over `--site`. |
| `--php` / `--no-php` | Enable the PHP boilerplate (`api/`, `.php/config.php`, `php_fastcgi` on link). Default: off. Existing linked projects without `"php"` keep PHP on. |
| `--php-examples` / `--no-php-examples` | Deprecated. Sample actions ship with `--php` in `api/actions/`. The flags are accepted and do not copy a second sample set. |
| `--link` / `--no-link` | After scaffolding, run `stagepass link` (macOS only). Default: off; interactive macOS may offer it. |
| `--git` / `--no-git` | `git init` (default: yes). |
| `--remote <url>` | Set `origin` after git init (rejects URLs with embedded credentials). |
| `--install` / `--no-install` | Run `npm install` (default: no). |
| `-y, --yes` | Non-interactive; use defaults for omitted flags. |
| `--dry-run` | Print the file plan without writing. |

The name must be DNS-safe (lowercase `a-z`, `0-9`, hyphens; 1 to 63 chars; no leading/trailing hyphen). Existing files are never overwritten. Generated projects include `scripts/build.mjs` (content-hashed `dist/` + SRI `integrity` in `manifest.json`), scripts `build` / `watch` / `dev` (`dev` aliases `watch`), Webflow head/footer snippets (jsDelivr `@2`, loader plus the declared modules), `stagepass.json`, an `AGENTS.md` with the full `sp` API reference, `.cursor/rules/stagepass.mdc`, and a `.gitignore`. `@stagepass/loader` / `@stagepass/modules` are added as `^2` (same major as the CDN pin `@2`; npm installs the newest published 2.x). Per-module types are written only when the published or installed `@stagepass/modules` ships them (2.2.0 and later); otherwise `types` lists the umbrella `@stagepass/modules`.

Interactively (macOS), `new` runs a read-only `doctor` preflight and can offer `stagepass setup` if the local stack looks incomplete (never automatic, never under `--yes` / no-TTY, never sudo by itself). Without a TTY (or with `--yes`) it uses `--site-modules`, then `--site` detection, else `[]` with a hint. The interactive wizard always asks whether to enable PHP unless `--php` / `--no-php` was passed. Staging / production prompts, `--staging` detection, and `link` reading `origin` / `production` from `stagepass.json` are part of this release.

### PHP

`--php` writes a plain PHP 8.2 boilerplate: `api/action.php` is the only public entry, actions are an allowlist in `api/actions.php`, and `.php/config.php` sits in the same folder as `api/`. That folder is the document root (the project root locally, `dist/` after `stagepass build`). Copy `api/.env.example` to `.env` in the project root (or use `.php/.env`) and set `ALLOWED_ORIGINS` (include `https://<name>.sp`). There is no mail. `load_config()` reads that project-root `.env` and `.php/.env`. It never reads `api/.env`.

Caddy already returns 404 for any path segment that starts with `.` (`/.env`, `/api/.env`, `/.php/`). Since 2.4.1, `stagepass new --php` ships a web-root `.htaccess` with the Apache rule below, and `stagepass build` copies it into `dist/` when the project has one. Published CLI 2.4.0 does not ship that file. `stagepass new` refuses to overwrite an existing `.htaccess`. nginx does not read `.htaccess`; add the snippet below in the server block before `location ~ \.php$`. Prefer real environment variables so a `.env` file is not required in the web root.

`stagepass new` and `doctor` warn when `php` is missing, older than 8.2, or has no `php-fpm` / `php-cgi` (`brew install php` on macOS). `stagepass dev` and `stagepass watch` on a `"php": true` project do the same check and start Homebrew php-fpm (`brew services start php`, and `brew services restart php` only if start fails), the same helper `stagepass start` has used since 2.3. The JS build still runs. `stagepass build` copies `api/` to `dist/api/`, `.php/config.php` to `dist/.php/config.php`, and a project-root `.htaccess` to `dist/.htaccess` when `"php": true` and the file exists. It does not copy `.env`, `.php/.env`, or `.php/rate-limit/`. The copy also skips logs, pid files, and key, certificate, or database files (`.pem`, `.key`, `.p12`, `.pfx`, `.crt`, `.cer`, `.sqlite`, `.db`). It keeps `.htaccess` and `.env.example`. A `dist/.htaccess` already on disk stays when the project has none. Upload `dist/` (the folder that contains `api/`). That folder is the web root, so `.php/` is public on Apache and nginx unless hidden paths are denied. The public URL stays `/api/action.php`.

Apache, in the web root `.htaccess`. `AllowOverride All` and `mod_rewrite` are required. The rule follows HTML5 Boilerplate [`file_access.conf`](https://github.com/h5bp/server-configs-apache/blob/main/h5bp/security/file_access.conf), wrapped in `IfModule`:

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

Both rules were tested on 12 November 2026 on php:8.2-apache (`AllowOverride All`, `a2enmod rewrite`) and on nginx 1.27 with php:8.2-fpm. `/.env`, `/.php/config.php`, `/api/.env.example`, and `/.git/HEAD` returned HTTP 403, with no secret or config leak. `/api/action.php?action=ping` returned HTTP 200, `{"status":"success","data":{"pong":true},"message":null}`. `/.well-known/test.txt` returned HTTP 200, body `well-known-ok`. `/.well-known/` as a directory with no index file returned HTTP 403 on both servers (no DirectoryIndex). Visible files under `/.well-known/` stay reachable. Published CLI 2.4.0 still needs these rules added by hand. Since 2.4.1 the Apache rule ships in the PHP scaffold, and `stagepass upgrade` writes a missing project `.htaccess` when `"php": true` ([quYArF43](https://trello.com/c/quYArF43)). nginx still needs the snippet on the host.

`stagepass dev` / `watch` serve PHP from the project root, so edits show up on the next request. From the folder that contains `api/`, `php -S 127.0.0.1:8080 -t .` matches `/api/action.php`. `php -S` does not apply Caddy's hidden-path 404. Do not point it at a folder that already contains a real `.env`. Prefer `stagepass dev` or the linked `.sp` domain. `sp.resolveLocalUrl` returns a URL only during an active `.sp` session. On Webflow, `window.location.origin` is the Webflow host, which does not run PHP. Fetch the absolute PHP host, for example `https://php.example.com/api/action.php`. `rate_limit_allows()` logs storage faults (directory, file, `flock`, or a thrown error). The response is HTTP 503, JSend `error`, `Retry-After: 60`, and no internals, unless `APP_ENV` is `local`, `development`, or `dev` (trimmed, any case). Empty, unset, and every other value stay closed. A limit hit stays HTTP 429. `client_ip()` uses `REMOTE_ADDR` unless that peer is in `TRUSTED_PROXIES`, then reads `TRUSTED_PROXY_HEADER` (`x-forwarded-for` or RFC 7239 `forwarded`) from right to left. This applies to projects created with the next release. `stagepass upgrade` does not change `api/`. Copy `api/lib/security.php`, `api/lib/request.php`, `api/lib/config.php`, `.php/config.php`, and `api/action.php` from a new scaffold, or re-scaffold. [sgt7wKlT](https://trello.com/c/sgt7wKlT). `stagepass upgrade` does not add the `api/` or `.php/` boilerplate. When `"php": true` and the project root has no `.htaccess`, it writes the shipped template (same bytes as `stagepass new --php`). An existing `.htaccess` is left unchanged. If that file has no `RewriteRule "(^|/)\." - [F]` line, upgrade prints a hint and still exits 0. Published CLI 2.4.0 does not write that file. The website guide is live at [https://stagepass.one/docs/php/](https://stagepass.one/docs/php/) (source outline: [docs/php.md](https://github.com/arobertherz/stagepass/blob/master/docs/php.md)).

### Declared modules (`stagepass.json`)

```json
{ "name": "my-project", "modules": ["cookies"] }
```

`modules` is `[]` (loader only), a list of `inject`, `cookies`, `maintenance`, or `["all"]`. It must match what your Webflow site loads. From it the CLI generates:

- the managed block in `AGENTS.md` (between `<!-- stagepass:begin -->` and `<!-- stagepass:end -->`): loader API always, full sections for declared modules, a "not available; enable by …" line for the others, and the rule never to use undeclared `sp.<module>`;
- `.cursor/rules/stagepass.mdc` (globs `src/**`) with the same content;
- `compilerOptions.types` in `tsconfig.json` / `jsconfig.json`: `@stagepass/loader` plus `@stagepass/modules/<module>` for each declared module (`@stagepass/modules` for `all`), so undeclared modules are type errors. Published `@stagepass/loader` 2.5.0 `global.d.ts` augments `Window` with `sp` and `stagepass` (both `StagepassAPI`) and declares global `var sp` / `var stagepass`. The scaffold `src/main.ts` still narrows `sp` to `log` for the ready line. The official types are wider.

The legacy boolean `"modules": true|false` is still read; `upgrade` replaces it with a list (`true` becomes `["all"]` without a TTY).

### Live site detection

`new --site`, `upgrade` and `doctor` read the modules from the live site: one public `GET` of the origin, https only, no cookies or auth headers, about 5 s timeout, a size cap, at most 3 redirects (all https). Only `<script src>` attributes are parsed with a regex (HTML comments ignored); nothing is executed. Recognised:

- CDN (`cdn.jsdelivr.net/npm/` or `unpkg.com/`): full `/dist/{loader,inject,cookies,maintenance,all}(.min).js` paths, any version (`@2`, `@2.0.0`, none), and package-root URLs such as `…/@stagepass/loader@2` or `…/@stagepass/modules@2` (optional trailing slash / query). Package-root maps from each package’s `main` field (loader → `loader`, modules → `all`); there is no `unpkg` / `jsdelivr` / `exports` override in those packages.
- Self-hosted: a Stagepass build filename under a `/stagepass/` path segment (relative or other-origin absolute), a relative `…/@stagepass/…` path (e.g. copied from `node_modules`), or the same filename on a `<script>` that also has a `data-stagepass-*` attribute; renamed loader files that carry a loader-config attribute (`data-stagepass-version`, `data-stagepass-live-src`, …). Result `cdn` is `self`. Bare `loader.js` / `all.min.js` from other libraries without a Stagepass hint are ignored. Absolute URLs on foreign hosts that only mimic an `@stagepass` CDN path (no `/stagepass/` segment and no data attribute) are ignored.

Still not recognised: tags without `src`, `data-src` only, other hosts without a Stagepass hint, and module ids that cannot be inferred from the filename. `upgrade` syncs the detected modules list into the project; it does not rewrite self-hosted embeds to CDN URLs (printed Webflow snippets remain the recommended CDN form). The npm dependency in `package.json` is only a hint.

### `upgrade` options

| Option | Behaviour |
| :--- | :--- |
| `--version <x>` | Target loader/modules version, range or dist-tag. It must be published on npm (staged releases are refused until approved). Default: `^<latest published 2.x>` from `npm view`, or `^2` when the registry is not reachable. (Implemented as `--target` internally so it does not collide with `stagepass --version`.) |
| `--site <host>` | Live site to detect modules from (default: the origin linked in `~/.stagepass/projects.json` for this folder). Stored in `stagepass.json` when given. |
| `--site-modules <list>` | Set the modules list directly (`none`, `all`, or a comma list). |
| `--skip-site` | Do not fetch the live site. |
| `-y, --yes` | Accept the detected or existing list without asking. With `--yes`, CLI 2.4.0 also replaces an unmodified `scripts/build.mjs`. |
| `--dry-run` | Print every planned change; write no file. |

`upgrade` bumps `@stagepass/*` in `package.json`, then resolves the modules list (`--site-modules`, else live detection, confirmed interactively; if the site is unreachable or no origin is known it asks; without a TTY it keeps the existing list or `[]` and prints a hint). It then syncs the project:

- `stagepass.json`: writes the `modules` list.
- `AGENTS.md`: created if missing, otherwise only the managed block is replaced (or appended when there is none). Your own text stays. Broken markers are left alone with a hint.
- `.cursor/rules/stagepass.mdc`: created if missing, otherwise only its managed block is refreshed.
- `tsconfig.json` / `jsconfig.json`: only `compilerOptions.types` changes, the rest of the JSON is preserved. Files with comments, or without a `types` array, are skipped with a hint.
- `scripts/build.mjs`: CLI 2.4.0 replaces it when it is still an unmodified scaffold from an earlier CLI (line endings ignored; `src/main.js` / `src/main.ts` and `src/styles.css` / `src/styles.scss` still count). The interactive prompt defaults to yes. Without a TTY, and with `--yes`, the file is replaced. `--dry-run` writes nothing. An edited script is left unchanged and the CLI prints what `stagepass build`, `stagepass watch` and `stagepass dev` do now. A missing script stays missing. Published CLI 2.3.1 does not replace that file.
- `.htaccess`: since 2.4.1, when `stagepass.json` has `"php": true` and the project root has no `.htaccess`, upgrade writes the shipped template (same bytes as `stagepass new --php`). An existing file is not modified. If it has no `RewriteRule "(^|/)\." - [F]` line, a hint points at https://stagepass.one/docs/php/ and `api/README.md` and the command still exits 0. A symlink or directory at that name is left in place. Projects without `"php": true` are unchanged. `--dry-run` writes nothing. Published CLI 2.4.0 does not write this file.

Every change is printed as `file: action` (unchanged files are not listed; skipped files appear as hints). `npm install` is printed, not run. Snippets use the major pin `@2` plus an optional exact pin note.

### Domain argument (`link` / `unlink`)

- Optional. When omitted, defaults to the **current folder name**.
- Values are lowercased; accidental `https://` and trailing `/` are stripped.
- The `.sp` suffix is **always** applied (pass `my-project` or `my-project.sp`).
- Labels must be DNS-safe (`[a-z0-9]`, inner hyphens). When derived from a folder and invalid, the CLI slugifies and prints a dim notice.
- Explicit invalid domains are rejected (nothing is written).

### `link` options

| Option | Behaviour |
| :--- | :--- |
| `--origin <host>` | Allow CORS from this live hostname (**repeatable**). Merges into the stored list (deduped). |
| `--remove-origin <host>` | Remove a previously stored CORS hostname (**repeatable**). |
| `--allow-all-origins` | Enable `Access-Control-Allow-Origin: *` (prints a security warning). Prefer `--origin`. |
| `--no-allow-all-origins` | Disable allow-all mode and use the origin allowlist. |
| `-v, --verbose` | Show Caddy reload output / errors. |

`link` reads `origin` / `production` from `stagepass.json` when no `--origin` / `--remove-origin` flags are passed. You can still pass `--origin` explicitly for CORS. The project's `"php"` flag (when set) controls whether the Caddy site block includes `php_fastcgi`; missing `"php"` keeps the legacy PHP-on behaviour.

**`--origin` / `--remove-origin` format:** `example.com`, `www.example.com`, `*.example.com`, or `https://example.com`. Hostnames only (optional leading `*.`); no path, port, or `http://` for live origins.

If Caddy reload fails after a successful write, the CLI warns and suggests `stagepass start`.

Examples:

```bash
stagepass link my-project --origin www.example.com --origin example.com
stagepass link my-project --origin my-project.webflow.io
stagepass link my-project --remove-origin old.example.com
stagepass link my-project --no-allow-all-origins
stagepass link my-project --allow-all-origins   # emergency / legacy compatibility only
```

Re-running `stagepass link` keeps stored origins / allow-all setting unless you change them with flags. Omitting both `--allow-all-origins` and `--no-allow-all-origins` leaves the stored value unchanged. New projects default to `allowAllOrigins: false`.

If `projects.json` is missing an entry but a v2 Caddyfile block exists, CORS options are restored from the `# stagepass-options:` marker instead of being reset.

## Security

Linked sites are hardened automatically:

### Blocked paths (always)

These always return **404** (including `OPTIONS`), including with `--allow-all-origins`, and never reach PHP or `file_server`:

- Any path segment starting with `.` (covers `.git`, `.env`, `.env.local`, `.DS_Store`, `.ssh`, `.npmrc`, …)
- `node_modules/`
- Extensions: `.pem`, `.key`, `.p12`, `.pfx`, `.crt`, `.cer`, `.sqlite`, `.db`, `.log`

### CORS (cross-origin embedding)

Stagepass reflects `Access-Control-Allow-Origin` for **allowed** browser `Origin` values (no credentials):

**Default allowlist (always on):**

- `https://*.sp`
- `http(s)://localhost[:port]` and `http(s)://127.0.0.1[:port]`
- Per-project live domains from `--origin` / `~/.stagepass/projects.json`

Webflow staging/live hosts are **not** included by default. Add them per project, e.g. `--origin my-project.webflow.io`. An explicit `--origin *.webflow.io` (or `*.webflow.com`) is accepted but prints a warning (any Webflow user's site would then be allowed).

Matching responses also send `Vary: Origin`. On HTTP 2xx, Caddy sets a single `Access-Control-Allow-Origin` with a deferred replace, so a PHP app that sends the same header does not produce a second value. Other status codes are not given an ACAO by Caddy. Preflight (`OPTIONS`) for allowed origins returns `204` with reflected ACAO, `Access-Control-Allow-Methods: GET, HEAD, POST, OPTIONS`, reflected `Access-Control-Allow-Headers`, `Access-Control-Max-Age: 86400`, and `Access-Control-Allow-Private-Network: true` (Chrome Private Network Access from public HTTPS → loopback).

Non-matching origins get **no** ACAO. Non-allowlisted `OPTIONS` still get `204` without CORS headers.

### Domain & path validation

- Domains are lowercased, must be DNS-safe labels, and always end with `.sp`. Invalid folder names are slugified when the domain is omitted.
- Project roots refuse `/`, your home directory, and common system roots (`/Users`, `/System`, `/Library`, …). Paths are escaped for the Caddyfile.

### Project config

Per-domain settings live in `~/.stagepass/projects.json`:

```json
{
  "version": 1,
  "projects": {
    "my-project.sp": {
      "root": "/Users/you/Sites/my-project",
      "origins": ["www.example.com"],
      "allowAllOrigins": false
    }
  }
}
```

## Migration from older CLI versions

On `stagepass link`, `reload`, and `start`, legacy Caddyfile blocks (no `# stagepass-block: v2` marker) are upgraded automatically:

1. A timestamped backup is written once: `~/.stagepass/Caddyfile.bak-YYYYMMDD-HHMMSS`
2. Blocks are rewritten with path blocking + the version marker
3. **`allowAllOrigins` is enabled** for migrated blocks so existing Webflow / live-domain embedding keeps working
4. A short notice recommends tightening CORS

Blocks already marked `# stagepass-block: v2` are rewritten to the current marker on those same commands. Saved options (`allowAllOrigins`, origins, `php`, `devPort`) stay as they are.

Recommended after migration:

```bash
stagepass link --origin www.example.com
stagepass link --no-allow-all-origins
```

Hand-written content outside `# START:` / `# END:` markers is left untouched. Unparsable legacy blocks are left unchanged with a warning. Migration is idempotent (second run does nothing and creates no new backup).

The v3 block needs Caddy 2.9 or newer (`brew upgrade caddy`). Homebrew does not upgrade an existing Caddy when you `brew install caddy`. On a known older Caddy, `link`, `reload`, and `start` do not rewrite existing blocks. `link` still writes that project's block as v3 and warns that CORS on success responses may be missing until you upgrade. If `caddy version` cannot be read, the rewrite stays as before. `stagepass doctor` reports the version and warns below 2.9.

## Troubleshooting (CLI)

| Symptom | What to check |
| :--- | :--- |
| Autostart runs at login but `caddy: command not found` / daemon exits | Re-run `stagepass autostart on` so the plist embeds Homebrew `PATH`. Confirm `brew --prefix` and that `which caddy` points at `$prefix/bin/caddy` (Cellar symlink OK). |
| macOS asks Node for Desktop access | Normal TCC when the CLI/agent reads a project under Desktop. Grant the folder or move the project / use a stable global CLI install. Not the same as browser Local Network or CA trust. |
| Autostart still runs an old Desktop test binary after `npm i -g` | Global upgrade does not migrate LaunchAgent ProgramArguments. `autostart off` then `on` with the stable CLI; do not remove the old path while the agent still references it. |
| Login autostart points at a deleted Homebrew Node, or `doctor` warns that the daemon version differs from the CLI | Published CLI 2.3.1 and later. Run `stagepass autostart on`. `doctor` fails on a missing LaunchAgent node or CLI path, and warns on a versioned Cellar node path or a daemon/CLI version mismatch. The fix hint is `stagepass autostart on`. |
| `stagepass start` spinner floods the terminal (weird ANSI) | Upgrade to a build with the spinner geometry guard. Rare with TTY width `0`. |
| `start` asks for a password at every boot | There is no unconditional `sudo -v`. Only confirmed conflict resolution may use `sudo kill` / `apachectl`. |
| Port 443 bind failure under LaunchAgent | Expected when something else owns 443; daemon exits `0` (no restart loop). Free the port or use interactive `stagepass start`. |

## Related Packages

- `@stagepass/loader`: browser runtime for swapping production assets.
- `@stagepass/modules`: optional runtime modules (`inject`, `cookies`).

## Repository

- Docs and full setup: [stagepass repository](https://github.com/arobertherz/stagepass)
