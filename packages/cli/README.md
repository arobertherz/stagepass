# `@stagepass/cli`

Local development orchestrator for Webflow projects.

The CLI sets up and manages the local Stagepass infrastructure (`.sp` domains, Caddy, DNS, PHP) so your live Webflow site can load local assets through the Stagepass loader.

## Install

Requires Node.js **18+** (`engines.node`: `>=18.0.0`) on **macOS** with Homebrew. Development and CI use Node 22 or 24; the published package keeps `engines.node` at `>=18.0.0` so existing consumers are not broken by an engines bump.

```bash
npm install -g @stagepass/cli@2
```

Or without a global install:

```bash
npx @stagepass/cli@2 setup
```

## Requirements

- **macOS** (system commands refuse other platforms with exit code 1; this is not a breaking change because those commands never worked off macOS)
- Node.js 18+ at runtime (`engines.node`); use Node 22 or 24 for local development and CI
- Homebrew

`stagepass --version` and `stagepass --help` work on any platform. For tests/CI only, set `STAGEPASS_SKIP_PLATFORM_CHECK=1` to bypass the macOS guard (not for production use).

## Quick Start

Recommended order:

```bash
stagepass setup
stagepass start

# inside your project folder
stagepass link my-project --origin www.example.com --origin my-project.webflow.io
```

Your project is then available at `https://my-project.sp`. Success output:

```text
Linked: https://my-project.sp -> /absolute/path/to/project
```

## Commands

| Command | Description |
| :--- | :--- |
| `stagepass setup` | Install Caddy, PHP, Dnsmasq via Homebrew and configure the local `.sp` resolver (`address=/.sp/127.0.0.1` + `/etc/resolver/sp`). |
| `stagepass start` | Start background Caddy & PHP services. Migrates legacy Caddyfile blocks if needed. |
| `stagepass link [domain]` | Link the current directory to a `.sp` domain, write/update the Caddyfile + `~/.stagepass/projects.json`, reload Caddy. |
| `stagepass unlink [domain]` | Remove the site block and `projects.json` entry, reload Caddy. |
| `stagepass reload` | Reload Caddy configuration. Migrates legacy Caddyfile blocks if needed. |
| `stagepass stop` | Stop background services. Prints a hint when login autostart is enabled. |
| `stagepass doctor` | Read-only diagnostics (Homebrew, Caddy, PHP/php-fpm, dnsmasq, resolver, port 443, Caddyfile, projects, certs, LaunchAgent). Never uses sudo. `--json` available. Exit `1` if any fail. |
| `stagepass certs check` | Read-only Caddy local CA check (validity, System keychain trust, orphans, optional TLS handshake per linked domain). `--json`, `--skip-handshake`. |
| `stagepass certs trust` | Run `caddy trust` after interactive confirmation (or `--yes`). |
| `stagepass autostart on\|off\|status` | Manage a user LaunchAgent (`io.github.arobertherz.stagepass`) that runs `stagepass daemon` at login. |
| `stagepass daemon` | Non-interactive foreground helper for the LaunchAgent (certs check log-only, then `caddy run`). Never uses sudo. |
| `stagepass new [name]` | Scaffold a lean Webflow project (TypeScript + SCSS by default). |
| `stagepass build` | Run `npm run build` in the current project (forwards exit code). |
| `stagepass watch` | Run `npm run watch` in the current project (forwards exit code). |
| `stagepass upgrade` | Bump `@stagepass/*` in the current `package.json` and print Webflow snippets. |

All commands support `-v, --verbose` where applicable.

### Doctor / certificates / autostart

- `doctor` and `certs check` are read-only. They never delete keychain items or certificate files.
- Prefer CDN major pin `@2` in Webflow custom code (doctor warns if recommended snippets would use `@latest`).
- Chrome may require Local Network Access permission for public HTTPS pages that load `https://*.sp` assets.
- Autostart runs as your user (same privilege model as `caddy start` inside `stagepass start`). If port 443 cannot be bound, `daemon` logs a clear error and exits `0` so launchd KeepAlive does not restart-loop. Use interactive `stagepass start` to resolve conflicts.
- Manual macOS checklist: [`TESTING-macos.md`](./TESTING-macos.md).

### `new` options

Scaffold a project with flags for every choice (interactive prompts only on a TTY without `--yes`):

| Option | Behaviour |
| :--- | :--- |
| `--dir <dir>` | Target directory (default: `./<name>`). |
| `--author <name>` | `package.json` author (default: `git config user.name`). |
| `--lang ts\|js` | Language (default: `ts`). |
| `--styles scss\|css` | Styles (default: `scss`). |
| `--modules` / `--no-modules` | Include `@stagepass/modules` (default: yes). |
| `--git` / `--no-git` | `git init` (default: yes). |
| `--remote <url>` | Set `origin` after git init (rejects URLs with embedded credentials). |
| `--install` / `--no-install` | Run `npm install` (default: no). |
| `-y, --yes` | Non-interactive; use defaults for omitted flags. |
| `--dry-run` | Print the file plan without writing. |

The name must be DNS-safe (lowercase `a-z`, `0-9`, hyphens; 1 to 63 chars; no leading/trailing hyphen). Existing files are never overwritten. Generated projects include `scripts/build.mjs` (content-hashed `dist/` + `manifest.json`), Webflow head/footer snippets (jsDelivr `@2` with `loader/dist/loader.min.js` and optional `modules/dist/{inject,cookies}.min.js`; also document `all` / `maintenance`), and an `AGENTS.md` with safe development rules.

### `upgrade` options

| Option | Behaviour |
| :--- | :--- |
| `--version <x>` | Target version (default: this CLI version from its `package.json`). Dist-tags such as `latest` resolve via `npm view`. (Implemented as `--target` internally so it does not collide with `stagepass --version`.) |
| `--dry-run` | Show changes without writing `package.json`. |

Only `package.json` is modified. `npm install` is printed, not run. Snippets use the major pin `@2` plus an optional exact pin note.

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

Matching responses also send `Vary: Origin`. Preflight (`OPTIONS`) for allowed origins returns `204` with reflected ACAO, `Access-Control-Allow-Methods: GET, HEAD, POST, OPTIONS`, reflected `Access-Control-Allow-Headers`, `Access-Control-Max-Age: 86400`, and `Access-Control-Allow-Private-Network: true` (Chrome Private Network Access from public HTTPS → loopback).

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

Recommended after migration:

```bash
stagepass link --origin www.example.com
stagepass link --no-allow-all-origins
```

Hand-written content outside `# START:` / `# END:` markers is left untouched. Unparsable legacy blocks are left unchanged with a warning. Migration is idempotent (second run does nothing and creates no new backup).

## Related Packages

- `@stagepass/loader`: browser runtime for swapping production assets.
- `@stagepass/modules`: optional runtime modules (`inject`, `cookies`).

## Repository

- Docs and full setup: [stagepass repository](https://github.com/arobertherz/stagepass)
