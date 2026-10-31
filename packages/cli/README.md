# `@stagepass/cli`

Local development orchestrator for Webflow projects.

The CLI sets up and manages the local Stagepass infrastructure (`.sp` domains, Caddy, DNS, PHP) so your live Webflow site can load local assets through the Stagepass loader.

## Install

```bash
npm install -g @stagepass/cli
```

## Requirements

- macOS
- Node.js 18+
- Homebrew

## Quick Start

```bash
stagepass setup
stagepass start

# inside your project folder
stagepass link my-project
```

Your project is now available at `https://my-project.sp`.

## Commands

- `stagepass setup` — install dependencies and configure local resolver.
- `stagepass start` — start Caddy + PHP background services.
- `stagepass link [domain]` — link current directory to a `.sp` domain.
- `stagepass unlink [domain]` — remove link from Caddy config.
- `stagepass reload` — reload Caddy config.
- `stagepass stop` — stop background services.

All commands support `-v, --verbose`.

### `link` options

- `--origin <host>` — allow CORS from a live hostname (repeatable). Accepts `example.com`, `www.example.com`, `*.example.com`, or `https://example.com`.
- `--remove-origin <host>` — remove a previously stored CORS hostname (repeatable; same validation as `--origin`).
- `--allow-all-origins` — restore permissive `Access-Control-Allow-Origin: *` (prints a security warning). Prefer `--origin` instead.
- `--no-allow-all-origins` — turn off allow-all mode and use the origin allowlist.

Examples:

```bash
stagepass link my-project --origin www.example.com --origin example.com
stagepass link my-project --remove-origin old.example.com
stagepass link my-project --no-allow-all-origins
stagepass link my-project --allow-all-origins   # emergency / legacy compatibility only
```

Re-running `stagepass link` keeps stored origins / allow-all setting unless you change them with flags. If `projects.json` is missing an entry but a v2 Caddyfile block exists, CORS options are restored from the `# stagepass-options:` marker instead of being reset.

## Security

Linked sites are hardened automatically:

### Blocked paths (always)

These always return **404**, including with `--allow-all-origins`, and never reach PHP or `file_server`:

- Any path segment starting with `.` (covers `.git`, `.env`, `.env.local`, `.DS_Store`, `.ssh`, `.npmrc`, …)
- `node_modules/`
- Extensions: `.pem`, `.key`, `.p12`, `.pfx`, `.crt`, `.cer`, `.sqlite`, `.db`, `.log`

### CORS (cross-origin embedding)

Stagepass reflects `Access-Control-Allow-Origin` for **allowed** browser `Origin` values (no credentials):

**Default allowlist (always on):**

- `https://*.webflow.io` and `https://*.webflow.com` (any subdomain depth; lookalikes like `evilwebflow.example` / `webflow.io.attacker.example` do **not** match)
- `https://*.sp`
- `http(s)://localhost[:port]` and `http(s)://127.0.0.1[:port]`
- Per-project live domains from `--origin` / `~/.stagepass/projects.json`

Matching responses also send `Vary: Origin`. Preflight (`OPTIONS`) returns `204` with reflected ACAO, `Access-Control-Allow-Methods: GET, HEAD, POST, OPTIONS`, reflected `Access-Control-Allow-Headers`, `Access-Control-Max-Age: 86400`, and `Access-Control-Allow-Private-Network: true` (Chrome Private Network Access from public HTTPS → loopback).

Non-matching origins get **no** ACAO.

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

- `@stagepass/loader` — browser runtime for swapping production assets.
- `@stagepass/modules` — optional runtime modules (`inject`, `cookies`).

## Repository

- Docs and full setup: [stagepass repository](https://github.com/arobertherz/stagepass)
