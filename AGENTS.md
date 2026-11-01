# STAGEPASS AI CONTEXT

## Project Overview
Stagepass is a **modular development bundle** designed to bridge Webflow (or any production site) with local development environments. It consists of two decoupled components that can theoretically function independently:

1.  **The Infrastructure (CLI):** Orchestrates local servers (Caddy, PHP, Dnsmasq) and manages .sp domains.
2.  **The Runtime (Loader):** A standalone client-side script that handles the logic of swapping production assets with local equivalents via URL parameters.

## Architecture & Monorepo Structure
We use a monorepo workspace structure to manage these distinct packages:

### 1. `packages/cli` (Node.js Environment)
-   **Purpose:** Sets up the local environment (HTTPS, DNS, PHP).
-   **Tech:** Node 18+ (`engines`; development/CI: Node 22 or 24), Commander, Execa, Ora.
-   **Platform:** macOS only for system commands. Guard in `src/lib/platform.js`; override with `STAGEPASS_SKIP_PLATFORM_CHECK=1` for tests/CI only.
-   **Role:** The "Enabler". It creates the environment where local files are served.
-   **Package Name:** `@stagepass/cli`

### 2. `packages/loader` (Browser Environment)
-   **Purpose:** Runs in the browser (Webflow) to inject local scripts and stylesheets.
-   **Tech:** TypeScript, tsup (bundled to IIFE).
-   **Package Name:** `@stagepass/loader`
-   **Key Trait:** **Standalone.** This package must have NO dependencies on the CLI. It is built to be hosted on jsDelivr and works as long as *any* local server is running (created by Stagepass CLI or otherwise).

### 3. `packages/modules` (Browser Environment)
-   **Purpose:** Modular feature extensions (Injector, Cookies, etc.) that extend the core loader functionality.
-   **Tech:** TypeScript, tsup (bundled to IIFE, code-split by module).
-   **Package Name:** `@stagepass/modules`
-   **Key Trait:** **Loaded as separate script tags.** Include modules explicitly after `loader.min.js` (e.g., `<script src="inject.min.js"></script>`). The loader does not auto-load modules via script-tag query parameters.
-   **Requirement:** Core loader (`loader.min.js`) must be loaded first, as modules depend on `stagepass.vars` (or `window.stagepass.vars`).

## Tech Stack & Conventions
-   **Package Manager:** NPM Workspaces.
-   **Linting:** ESLint with appropriate environments (Node for CLI, Browser for Loader).
-   **Builds:**
    -   CLI is run directly via Node (ESM).
    -   Loader is bundled via `tsup` to `dist/` and committed to Git for CDN usage.

## Architecture Decisions & Rationale

### Loader: Standalone Architecture
**Decision:** The Loader must have zero dependencies on the CLI package.  
**Rationale:** The Loader is hosted on jsDelivr and must work independently. It can be used with any local server, not just Stagepass CLI. This decoupling allows flexibility and keeps the Loader small (~12.0 KB minified for `loader.min.js` after Runtime API helpers).  
**Constraint:** No Node.js dependencies, browser APIs only.

### Session Persistence: localStorage with expiry
**Decision:** Use `localStorage` (not `sessionStorage`) with a JSON `{ domain, expires }` record (default **12 h**, configurable via `data-stagepass-session-hours`).  
**Rationale:** Dev sessions should persist across tabs/reloads, but not forever. Legacy plain-string values are cleared.  
**Key:** `localStorage.getItem('stagepass_domain')` stores the serialized session object.

### Asset Injection: Remove Original Tags
**Decision:** Original `<script>` and `<link>` tags are removed (`el.remove()`) after new elements are injected.  
**Rationale:** Prevents double-loading (both production and local versions). The new element is inserted before the original, then the original is removed. This ensures clean DOM state and prevents conflicts.  
**Pattern:** `parentNode.insertBefore(newElement, originalElement)` → `originalElement.remove()`

### Cache Busting: Timestamp in session, version in production
**Decision:** While a local session is active, swapped assets use a single `?_cb=<timestamp>` per page load. In production, use `data-stagepass-version` (loader) or `data-stagepass-v` (asset) to append `?v=<version>`.  
**Rationale:** Per-view `Date.now()` busting on every production page load defeats CDN caching.  
**Note:** `data-stagepass-cachebust="true"` no longer appends a timestamp on every production view.

### Console: Stagepass logs only (opt-in global mute)
**Decision:** Do **not** mute the global console by default. Only Stagepass `sp.log` / `sp.warn` / `sp.error` are silent without a session.  
**Opt-in:** `data-stagepass-mute-console="true"` on the loader tag restores the legacy 1.x global mute in production when no session is active.  
**Note:** Deprecated globals `splog` / `spwarn` / `sperror` are **removed** in v2.

### Script Loading: async=false + defer as Default
**Decision:** Dynamically created scripts default to `async=true` in browsers; Stagepass forces `script.async = false` (unless the original had `async`) and adds `defer` when neither async nor defer was set.  
**Rationale:** Keeps classic script execution order. Same fix in `@stagepass/modules` inject.

### URL Parameter: Remove After Processing
**Decision:** Remove `?stagepass=domain.sp` from URL after storing in localStorage.  
**Rationale:** Keeps URLs clean. Session persists via localStorage, so the parameter is only needed for initial activation.  
**Pattern:** `window.history.replaceState()` without page reload.

### Domain Validation: Strict Whitelist
**Decision:** Only allow `.sp` domains, `localhost`, `localhost:*`, or `debug`. Invalid domains are removed from localStorage.  
**Rationale:** Security - prevents injection from external domains. Domain validation happens on every page load to catch stale/invalid entries.  
**Function:** `isValidDomain(d)` checks: `d === 'debug' || d.endsWith('.sp') || d === 'localhost' || d.startsWith('localhost:')`

### Double Processing Prevention: data-stagepass-processed Flag
**Decision:** Set `data-stagepass-processed` attribute on processed elements. Selector uses `:not([data-stagepass-processed])`.  
**Rationale:** `process()` can be called multiple times (initial + DOMContentLoaded). The flag prevents re-processing the same elements.  
**Pattern:** `document.querySelectorAll('script[data-stagepass]:not([data-stagepass-processed])')`

### Build Strategy: Commit dist Files to Git
**Decision:** Both `loader.js` (unminified) and `loader.min.js` (minified) are committed to Git.  
**Rationale:** jsDelivr serves files directly from the repository. This is necessary for CDN availability without requiring separate npm installs.  
**Trade-off:** Build artifacts in Git (acceptable for CDN distribution model).

### CLI: Silent by Default
**Decision:** CLI commands are quiet by default (spinners only), verbose output only with `-v` flag.  
**Rationale:** Non-intrusive developer experience. Detailed logs go to `~/.stagepass/server.log` when not verbose.  
**Pattern:** All commands support `-v, --verbose` option for detailed output.

### Monorepo: Separation with Shared Maintenance
**Decision:** Independent packages (`@stagepass/cli`, `@stagepass/loader`, `@stagepass/modules`) in one repository.  
**Rationale:** CLI, Loader, and Modules are technically decoupled but logically related. Single repo enables shared versioning, unified testing, and coordinated CI/CD while maintaining clear boundaries.

## Technical Reference

### Loader: HTML Data Attributes
-   `data-stagepass` - Main attribute to mark elements for processing
-   `data-src` - For scripts (instead of `src` attribute)
-   `data-href` - For stylesheets (instead of `href` attribute)
-   `data-stagepass-path` - Optional local path (if omitted, filename is extracted from production URL)
-   `data-stagepass-version` - Optional on the loader tag; production appends `?v=<version>` to assets without a per-asset override
-   `data-stagepass-v` - Optional per asset; production appends `?v=<version>`
-   `data-stagepass-session-hours` - Optional on the loader tag; session lifetime in hours (default 12)
-   `data-stagepass-mute-console="true"` - Optional; legacy global console mute in production without a session
-   `data-stagepass-cachebust="true"` - Legacy; no longer timestamps every production page view
-   `data-stagepass-staging-hosts` - Optional comma-separated hostnames treated as staging (in addition to `*.webflow.io`)
-   `data-stagepass-alias` - Optional custom global alias (valid JS identifier; assigned only when free)
-   `data-stagepass-processed` - Internal flag set after processing (prevents double-processing)

### Loader: CSS Selectors
-   Scripts: `script[data-stagepass]:not([data-stagepass-processed])`
-   Stylesheets: `link[rel="stylesheet"][data-stagepass]:not([data-stagepass-processed])`

### Loader: URL Parameters
-   `?stagepass=<domain.sp>` - Activates session, stores in localStorage
-   `?stagepass=debug` - Debug mode (no asset swapping, logging only)
-   `?stagepass=off` / `?stagepass=0` / `?stagepass=false` - Deactivates session
-   Parameters are removed from URL after processing via `window.history.replaceState()`

### Loader: localStorage Keys
-   `stagepass_domain` - JSON session `{ domain, expires }` (legacy plain strings are cleared)

### Loader: Runtime API (stagepass / sp)
-   `stagepass.vars` - Read-only object: `isLocal`, `env`, `domain`, `timestamp`, `version` (build-time from package.json)
-   `stagepass.vars.client` - Runtime client info: `theme`, `browser`, `os`, `device`, `viewport`, `locale`, `capabilities` (best effort)
-   `stagepass.env()` / `stagepass.is(name)` - Flat helpers (`local` = active `.sp` swap session; staging = `*.webflow.io` or `data-stagepass-staging-hosts`; else production). Independent of `vars.env` localhost semantics.
-   `stagepass.can(capability)` - Capability probe (`localStorage`, `sessionStorage`, `cookies`, `serviceWorker`)
-   `stagepass.client(key?)` - Read `vars.client` key (or whole object)
-   `stagepass.on(event, fn)` - Subscribe (`theme`, `session`); returns unsubscribe
-   `stagepass.use(name, version, factory)` - Module registry with major-version check
-   `stagepass.log`, `stagepass.warn`, `stagepass.error` - Logging (only when session active)
-   `stagepass.resolveLocalUrl(relativePath)` - Builds local asset URL when session is active; returns `''` otherwise. Modules (e.g. Injector) use this to avoid duplicating URL logic.
-   Types: `@stagepass/loader` ships `global.d.ts` (`types` field); modules extend via declaration merging.

### Modules: Loading Methods
-   **Separate script tags only:** Load modules as separate scripts after `loader.min.js` in `<head>`:
    ```html
    <script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/inject.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/cookies.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/maintenance.min.js"></script>
    ```
-   **Important:** Core loader should be loaded first. Without it, `inject`/`cookies` still attach APIs and warn; `maintenance` skips registration.
-   **Module Registration:** Modules register via `stagepass.use(...)` when available (e.g. `sp.inject`, `sp.cookies` / `sp.cookie`, `sp.maintenance`)
-   **Global Variable:** `sp` is preferred; `stagepass` and `window.stagepass` remain available; optional `data-stagepass-alias`
-   **Version pinning:** Prefer major CDN pin `@2` in production (strict semver within v2). Exact pin (e.g. `@2.0.0`) is optional for maximum control. See README "Version pinning".

### CLI: Commands
-   `stagepass setup` - Install dependencies and configure .sp domain
-   `stagepass link [domain]` - Link current directory to .sp domain (domain optional, defaults to folder name)
-   `stagepass unlink [domain]` - Unlink directory from .sp domain (domain optional, defaults to folder name)
-   `stagepass reload` - Reload Caddy configuration
-   `stagepass start` - Start background services (Caddy & PHP)
-   `stagepass stop` - Stop all background services (hints when autostart is enabled)
-   `stagepass doctor` - Read-only diagnostics (never sudo); `--json`; exit 1 on fail
-   `stagepass certs check` - Read-only Caddy local CA / trust / TLS checks
-   `stagepass certs trust` - Run `caddy trust` after confirmation or `--yes`
-   `stagepass autostart on|off|status` - Login LaunchAgent (`io.github.arobertherz.stagepass`)
-   `stagepass daemon` - Foreground helper for LaunchAgent (`caddy run`; never sudo)
-   All commands support `-v, --verbose` flag for detailed output where applicable

### CLI: Domain Handling
-   If domain argument is omitted, defaults to current folder name
-   `.sp` suffix is automatically added if missing
-   Domain is normalized (removes `https://`, trailing slashes)

## Coding Rules
1.  **Separation of Concerns:** Never import code from `packages/cli` into `packages/loader`. The Loader must remain lightweight and browser-compatible.
2.  **Silent CLI:** CLI commands should be quiet by default (use spinners), with verbose logging only on `-v`.
3.  **Loader Robustness:** The loader must fail gracefully if the local server is unreachable (fallback to production).
4.  **Code Language:** All code and comments must be in English (ignore `/dist` folder for loader).
5.  **Specific Files:**
    -   Global Config: `~/.stagepass/`
    -   Loader CDN 2.x: `https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js`
    -   Loader CDN 1.x (legacy pins): `https://cdn.jsdelivr.net/npm/@stagepass/loader@1.2.0/dist/loader.min.js`
