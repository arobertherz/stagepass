# CLI reference

Package: `@stagepass/cli`. System commands require macOS (platform guard in `src/lib/platform.js`). Override for tests only: `STAGEPASS_SKIP_PLATFORM_CHECK=1`. `--version` and `--help` work everywhere.

Typical order: `setup` → `start` → `link` (then `dev` / `reload` / `unlink` / `stop` as needed). Most commands support `-v, --verbose`.

## Commands

| Command | Description |
| --- | --- |
| `stagepass setup` | Install Caddy, PHP, Dnsmasq via Homebrew and configure the `.sp` resolver. |
| `stagepass start` | Start Caddy and PHP (certs check; offer repair when interactive; `launchctl kickstart` when autostart is on). Clears stale `devPort` entries. |
| `stagepass stop` | Stop services. With autostart, boots out the LaunchAgent until next login (`autostart off` removes it permanently). |
| `stagepass link [domain]` | Link the current directory to a `.sp` domain and reload Caddy. |
| `stagepass unlink [domain]` | Remove the link and `projects.json` entry. |
| `stagepass reload` | Reload Caddy configuration. |
| `stagepass doctor` | Read-only diagnostics (never sudo). `--json`, `--skip-site`. Exit `1` on fail. |
| `stagepass certs check` | Read-only CA / trust / TLS checks. `--json`, `--skip-handshake`. |
| `stagepass certs trust` | Run `caddy trust` after confirmation or `--yes`. |
| `stagepass certs renew` | Repair site certs; `--root`; `--remove-orphans`. |
| `stagepass autostart on\|off\|status` | Login LaunchAgent (`io.github.arobertherz.stagepass`). |
| `stagepass daemon` | Foreground helper for the LaunchAgent (never sudo). |
| `stagepass new [name]` | Scaffold a Webflow project. |
| `stagepass build` | Run `npm run build` in the current project (no shell). |
| `stagepass watch` | Run `npm run watch` in the current project (no shell). |
| `stagepass dev` | Run watch plus live reload SSE on the linked `.sp` domain. See [dev.md](./dev.md). |
| `stagepass upgrade` | Bump `@stagepass/*`, sync modules / AGENTS / types, print snippets. |

## `link`

Domain is optional (defaults to the folder name; `.sp` is added if missing).

| Option | Behaviour |
| --- | --- |
| `--origin <host>` | Allow CORS from this hostname (repeatable). |
| `--remove-origin <host>` | Remove a stored CORS hostname (repeatable). |
| `--allow-all-origins` | `Access-Control-Allow-Origin: *` (warning). Prefer `--origin`. |
| `--no-allow-all-origins` | Use the origin allowlist. |
| `-v, --verbose` | Show Caddy reload output. |

Default allowlist always includes local `.sp` / localhost / `127.0.0.1`. Webflow hosts are not default; add them with `--origin`. When no `--origin` flags are passed, `stagepass link` uses `origin` / `production` from `stagepass.json` when present.

Sensitive paths (hidden segments, `node_modules`, key/cert/db/log extensions) always 404 on linked sites.

## `new`

Scaffold options (non-exhaustive; see `stagepass new --help`):

* `--lang ts|js`, `--styles scss|css`
* `--modules` / `--no-modules`, `--site-modules <list>`
* `--staging <host>`, `--production <host>`, `--site <host>`
* `--php` / `--no-php`, `--php-examples`
* `--link` / `--no-link`, `--install` / `--no-install`, `--git` / `--no-git`
* `-y, --yes`, `--dry-run`, `-v, --verbose`

Generated projects write stable `dist/main.js` and `dist/styles.css` plus hashed files and SRI in `dist/manifest.json`. `npm run dev` aliases `watch`; prefer `stagepass dev` for live reload.

## `upgrade`

* `--dry-run`, `--site`, `--site-modules`, `--skip-site`, `-y, --yes`
* `--target <version>` (docs often say `--version`; the CLI rewrites that to `--target` so it does not collide with `stagepass --version`)

## Config locations

* `~/.stagepass/Caddyfile`
* `~/.stagepass/projects.json` (roots, CORS, optional `php`, live-reload `devPort` / `devPid` while `stagepass dev` runs)
* Project `stagepass.json` (name, domain, modules, origins, optional `php`, optional `outDir`)
