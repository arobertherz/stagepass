# CLI reference

Package: `@stagepass/cli`. System commands require macOS (platform guard in `src/lib/platform.js`). Override for tests only: `STAGEPASS_SKIP_PLATFORM_CHECK=1`. `--version` and `--help` work everywhere.

**Requirements:** macOS (system commands exit with code 1 on other platforms). Published CLI 2.3.0 (`@stagepass/cli`) `engines.node` is `>=20.17.0`. Node 18 is no longer supported; stay on `@stagepass/cli@2.2.7` if you must remain on Node 18. Contributors develop and test on Node 22 or 24.

Typical order: `setup` → `start` → `link`, then `stagepass build` / `stagepass watch` / `stagepass dev` (then `reload` / `unlink` / `stop` as needed). Most commands support `-v, --verbose`.

## Commands

| Command | Description |
| --- | --- |
| `stagepass setup` | Install Caddy, PHP, Dnsmasq via Homebrew and configure the `.sp` resolver. |
| `stagepass start` | Start Caddy & PHP (certs check; offer repair when interactive; `launchctl kickstart` when autostart is on). Migrates legacy Caddyfile blocks if needed. Clears stale `devPort` entries. Non-interactive prints findings and a hint. No standby `sudo -v`: port 443 conflicts show process name and PID; SIGTERM first, SIGKILL only after a second confirmation; own processes without elevated rights first, `sudo kill` only after unprivileged failure. |
| `stagepass stop` | Stop services. With autostart enabled, uses `launchctl bootout` until next login (`autostart off` removes the LaunchAgent permanently). |
| `stagepass link [domain]` | Link the current directory to a `.sp` domain and reload Caddy. |
| `stagepass unlink [domain]` | Remove the link (and `projects.json` entry) for that domain. |
| `stagepass reload` | Reload Caddy configuration (also migrates legacy blocks if needed). |
| `stagepass doctor` | Read-only stack diagnostics (never sudo), plus project modules vs. live site, project PHP when `stagepass.json` has `"php": true\|false`. Unpinned CDN warnings (`@latest`, bare major `@1`, or bare package) in recommended snippets and project files. `--json`, `--skip-site`. Exit `1` on any fail. |
| `stagepass certs check` | Read-only Caddy local CA / trust / TLS checks. `--json`, `--skip-handshake`. |
| `stagepass certs trust` | Run `caddy trust` after confirmation (or `--yes`). |
| `stagepass certs renew` | Repair failing linked `.sp` site certificates (`certificates/local/<domain>` + `caddy reload`). `--root` moves the local CA folder to a timestamped backup (never deletes) after double confirmation or `--yes --i-understand-root-renewal`. `--remove-orphans` deletes orphaned keychain roots by SHA-1 only after per-certificate confirmation (or `--yes`). |
| `stagepass autostart on\|off\|status` | User LaunchAgent (`io.github.arobertherz.stagepass`) for login start via `stagepass daemon`. |
| `stagepass daemon` | Foreground LaunchAgent helper (PHP-FPM, certs log-only, `caddy run`, macOS notifications via `osascript`); never sudo. |
| `stagepass new [name]` | Scaffold a lean Webflow project with `stagepass.json`, `AGENTS.md`, Cursor rule and typed `sp` (`--site` / `--site-modules`, `--staging` / `--production`, `--php` / `--php-examples`, `--link`; `--yes` for non-interactive). |
| `stagepass build` | Run `npm run build` in the current project (no shell; exit code forwarded). |
| `stagepass watch` | Run `npm run watch` in the current project (no shell; exit code forwarded). Checks whether Stagepass is running and whether the cwd is linked: interactive TTY offers `stagepass start`; non-TTY / CI prints a one-line hint and continues; unlinked cwd gets a `stagepass link` hint. |
| `stagepass dev` | Run `stagepass watch` plus a loopback SSE event server proxied at `/__stagepass/live` on the linked `.sp` domain (CSS can swap without a full reload). Same running check as `watch` (offer/hint to start). Requires a linked project (`stagepass link`). See [dev.md](./dev.md). |
| `stagepass upgrade` | Bump `@stagepass/*`, detect the modules your live site loads, sync `stagepass.json`, `AGENTS.md`, the Cursor rule and `types`, replace an unmodified `scripts/build.mjs`, print Webflow snippets. `--dry-run` writes nothing. |

If the domain argument is omitted, commands default to the current folder name. The `.sp` suffix is added automatically if missing. Domain values are normalized (strips `https://`, trailing slashes).

## Declared modules, AI guide and types

Projects created or upgraded with CLI 2.2+ declare in `stagepass.json` which modules their Webflow site loads: `"modules": []`, `["cookies"]` (any of `inject`, `cookies`, `maintenance`) or `["all"]`. `stagepass new --site <host>` and `stagepass upgrade` read this from the live site (public https GET, no cookies; regex on `<script src>` only, nothing executed): jsDelivr/unpkg `/dist/…` and package-root URLs, plus self-hosted Stagepass build files (path or `data-stagepass-*` hint). Self-hosted matches report `cdn: "self"` for display only — `upgrade` does not rewrite those tags to CDN. See [Live site detection](../packages/cli/README.md#live-site-detection). They ask you to confirm. `stagepass doctor` warns when the declared list and the live site differ.

From that list the CLI generates the `sp` API reference in `AGENTS.md` (managed block between `<!-- stagepass:begin -->` and `<!-- stagepass:end -->`), `.cursor/rules/stagepass.mdc` (globs `src/**`), and `compilerOptions.types`:

```json
{ "compilerOptions": { "types": ["@stagepass/loader", "@stagepass/modules/cookies"] } }
```

`@stagepass/loader` types `sp` / `window.stagepass`; `@stagepass/modules/inject`, `/cookies`, `/maintenance` add one module each, and `@stagepass/modules` adds all of them (unchanged from 2.0). See [`packages/cli/README.md`](../packages/cli/README.md) for details.

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
| `--php` / `--no-php` | Enable PHP (`api/` + `php_fastcgi` on link). Default off. Existing linked projects without a `php` setting keep PHP on (non-breaking). |
| `--php-examples` / `--no-php-examples` | Secure samples under `examples/php/` (requires `--php`) |
| `--link` / `--no-link` | Run `stagepass link` after scaffolding (macOS only; interactive ask unless `--link` / `--yes`) |
| `--git` / `--no-git` | Initialize a git repository |
| `--remote <url>` | Git remote URL (requires git) |
| `--install` / `--no-install` | Run `npm install` after scaffolding (default off) |
| `-y, --yes` | Non-interactive; accept defaults for omitted flags |
| `--dry-run` | Print the file plan without writing |
| `-v, --verbose` | Show detailed output |

Interactive macOS doctor preflight can offer `setup` (never automatic, never under `--yes` / no-TTY).

`stagepass build` writes stable `dist/main.js` and `dist/styles.css`, content-hashed copies, and SRI (`integrity` sha384) in `dist/manifest.json`, then deletes hashed names the previous manifest listed that the new one does not. CLI 2.2.x manifests store those names as strings (`"main.js": "main.<hash>.js"`); later manifests store `{ "file", "integrity" }`. Both forms are pruned. Only plain `<base>.<8 hex><ext>` files directly in `dist/` are removed. `stagepass watch` and `stagepass dev` write only the stable files and leave hashes and `manifest.json` as the last `stagepass build` left them. Prefer `stagepass build`, `stagepass watch` and `stagepass dev` (the last also starts live reload). `npm run dev` still aliases `watch`. Generated projects depend on `@stagepass/loader` / `@stagepass/modules` `^2` (same major as the CDN pin `@2`).

## `upgrade`

* `--dry-run`: show changes without writing any file
* `--site <host>`: live Webflow site to detect loaded modules from (https)
* `--site-modules <list>`: modules the site loads (`none`, `all`, or `inject,cookies,maintenance`)
* `--skip-site`: do not fetch the live site
* `-y, --yes`: non-interactive; accept detected or existing modules and replace an unmodified `scripts/build.mjs`
* `--target <version>`: docs often say `--version`; the CLI rewrites that to `--target` so it does not collide with `stagepass --version`
* `-v, --verbose`

`upgrade` only writes ranges that a published version satisfies. An explicit `--target` that is not published is refused before any file is written. Without a TTY it maps the legacy `"modules": true` to `["all"]` instead of `[]`, and prints a hint for narrowing (`--site-modules cookies`).

`scripts/build.mjs` is replaced when it is still an unmodified scaffold from an earlier CLI. The check hashes the file against known templates from this repo after normalizing line endings. The scaffold entry lines (`src/main.js`, `src/main.ts`, `src/styles.css`, `src/styles.scss`) still count as unmodified. On a TTY the prompt defaults to yes. Without a TTY, and with `-y` / `--yes`, the replacement is applied. `--dry-run` prints that plan and writes nothing. An edited script is left in place. The CLI then prints what `stagepass build`, `stagepass watch` and `stagepass dev` do in the current scaffold and points at this section. A missing `scripts/build.mjs` is left missing. A symlink is left unchanged.

## Config locations

* `~/.stagepass/Caddyfile`
* `~/.stagepass/projects.json` (roots, CORS, optional `php`, live-reload `devPort` / `devPid` while `stagepass dev` runs)
* `~/.stagepass/server.log` (detailed logs when not verbose)
* Project `stagepass.json` (name, domain, modules, origins, optional `php`, optional `outDir`)

## AGENTS.md Templates

`stagepass new` and `stagepass upgrade` generate the project `AGENTS.md` block and `.cursor/rules/stagepass.mdc` from the declared modules (see [Declared modules, AI guide and types](#declared-modules-ai-guide-and-types)). For projects without the CLI, use one of the following canonical profiles in your project-level `AGENTS.md` so coding agents know exactly which Stagepass runtime APIs are available.

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
