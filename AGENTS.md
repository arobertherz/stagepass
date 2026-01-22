# STAGEPASS AI CONTEXT

## Project Overview
Stagepass is a **modular development bundle** designed to bridge Webflow (or any production site) with local development environments. It consists of two decoupled components that can theoretically function independently:

1.  **The Infrastructure (CLI):** Orchestrates local servers (Caddy, PHP, Dnsmasq) and manages .sp domains.
2.  **The Runtime (Loader):** A standalone client-side script that handles the logic of swapping production assets with local equivalents via URL parameters.

## Architecture & Monorepo Structure
We use a monorepo workspace structure to manage these distinct packages:

### 1. `packages/cli` (Node.js Environment)
-   **Purpose:** Sets up the local environment (HTTPS, DNS, PHP).
-   **Tech:** Node 18+, Commander, Execa, Ora.
-   **Role:** The "Enabler". It creates the environment where local files are served.
-   **Package Name:** `@stagepass/cli`

### 2. `packages/loader` (Browser Environment)
-   **Purpose:** Runs in the browser (Webflow) to inject local scripts and stylesheets.
-   **Tech:** TypeScript, tsup (bundled to IIFE).
-   **Package Name:** `@stagepass/loader`
-   **Key Trait:** **Standalone.** This package must have NO dependencies on the CLI. It is built to be hosted on a CDN (e.g., jsDelivr, unpkg) and works as long as *any* local server is running (created by Stagepass CLI or otherwise).

### 3. `packages/modules` (Browser Environment)
-   **Purpose:** Modular feature extensions (Injector, etc.) that extend the core loader functionality.
-   **Tech:** TypeScript, tsup (bundled to IIFE, code-split by module).
-   **Package Name:** `@stagepass/modules`
-   **Key Trait:** **Loadable via URL parameter OR manually.** Modules can be loaded:
    - Automatically via `?modules=inject` parameter (loaded by core loader)
    - Manually as separate script tags after `loader.min.js` (e.g., `<script src="inject.min.js"></script>`)
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
**Rationale:** The Loader is hosted on CDNs (jsDelivr, unpkg) and must work independently. It can be used with any local server, not just Stagepass CLI. This decoupling allows flexibility and ensures the Loader remains lightweight (<5KB minified).  
**Constraint:** No Node.js dependencies, browser APIs only.

### Session Persistence: localStorage vs sessionStorage
**Decision:** Use `localStorage` instead of `sessionStorage` for dev session persistence.  
**Rationale:** Dev sessions should persist across browser tabs/windows and page reloads. Using `sessionStorage` would require reactivating dev mode in every new tab, which is impractical for development workflows.  
**Trade-off:** Sessions persist even after browser restart (acceptable for a dev tool).  
**Key:** `localStorage.getItem('stagepass_domain')` stores the active domain.

### Asset Injection: Remove Original Tags
**Decision:** Original `<script>` and `<link>` tags are removed (`el.remove()`) after new elements are injected.  
**Rationale:** Prevents double-loading (both production and local versions). The new element is inserted before the original, then the original is removed. This ensures clean DOM state and prevents conflicts.  
**Pattern:** `parentNode.insertBefore(newElement, originalElement)` → `originalElement.remove()`

### Cache Busting: Single Timestamp per Page Load
**Decision:** Generate `Date.now()` once per page load, not per asset. All assets get the same `?_cb=<timestamp>` parameter.  
**Rationale:** Ensures all assets from the same page load have consistent cache state. On reload, a new timestamp forces fresh loading of all assets (desired behavior for development).  
**Implementation:** `const cacheBust = swap ? Date.now() : 0;` (only when swap is active)

### Console Suppression: Environment-Based with Silent Mode
**Decision:** Suppress console logs based on environment and `?silent` parameter:
- **Production:** Always suppressed when no session/parameter
- **Staging:** Only suppressed when `?silent` parameter is present (allows console for free Webflow.io sites)
- **Local:** Never suppressed (always available for debugging)
**Rationale:** Production sites should remain clean, staging sites may need console for debugging, but some staging sites (free cases) should also be clean. The `?silent` parameter gives control.  
**Pattern:** `if (shouldSuppress && (env === 'production' || (env === 'staging' && silentParam !== null))) { suppress console }`  
**Note:** `splog`, `spwarn`, `sperror` are global functions available on `window` for structured logging.  
**Important:** The `?silent` parameter is read from the loader script tag's `src` attribute (e.g., `loader.min.js?silent`), not from the page URL.

### Script Loading: defer as Default
**Decision:** If neither `async` nor `defer` is set on original script, add `defer` to injected script.  
**Rationale:** Ensures proper script execution order (e.g., jQuery loads before dependent scripts). Scripts execute after DOM parsing but maintain order.  
**Pattern:** Existing `async`/`defer` attributes are preserved; only add `defer` if neither exists.

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
**Rationale:** CDNs (jsDelivr, unpkg) serve files directly from the repository. This is necessary for CDN availability without requiring separate npm installs.  
**Trade-off:** Build artifacts in Git (acceptable for CDN distribution model).

### CLI: Silent by Default
**Decision:** CLI commands are quiet by default (spinners only), verbose output only with `-v` flag.  
**Rationale:** Non-intrusive developer experience. Detailed logs go to `~/.stagepass/server.log` when not verbose.  
**Pattern:** All commands support `-v, --verbose` option for detailed output.

### Monorepo: Separation with Shared Maintenance
**Decision:** Two independent packages (`@stagepass/cli`, `@stagepass/loader`) in one repository.  
**Rationale:** CLI and Loader are technically decoupled but logically related. Single repo enables shared versioning, unified testing, and coordinated CI/CD while maintaining clear boundaries.

## Technical Reference

### Loader: HTML Data Attributes
-   `data-stagepass` - Main attribute to mark elements for processing
-   `data-src` - For scripts (instead of `src` attribute)
-   `data-href` - For stylesheets (instead of `href` attribute)
-   `data-stagepass-path` - Optional local path (if omitted, filename is extracted from production URL)
-   `data-stagepass-processed` - Internal flag set after processing (prevents double-processing)

### Loader: CSS Selectors
-   Scripts: `script[data-stagepass]:not([data-stagepass-processed])`
-   Stylesheets: `link[rel="stylesheet"][data-stagepass]:not([data-stagepass-processed])`

### Loader: URL Parameters
-   `?stagepass=<domain.sp>` - Activates session, stores in localStorage
-   `?stagepass=debug` - Debug mode (no asset swapping, logging only)
-   `?stagepass=off` / `?stagepass=0` / `?stagepass=false` - Deactivates session
-   Parameters are removed from URL after processing via `window.history.replaceState()`

### Loader: Script Tag Parameters
The `modules` and `silent` parameters are passed via the loader script tag itself (not as page URL parameters):
-   `loader.min.js` - Loads only the core loader
-   `loader.min.js?modules` - Loads core loader + all modules (`all.min.js`)
-   `loader.min.js?modules=inject` - Loads core loader + only Injector module
-   `loader.min.js?modules=inject,cookies` - Loads core loader + specific modules
-   `loader.min.js?silent` - Suppresses console logs even in staging environment (useful for free Webflow.io sites)
-   `loader.min.js?modules=inject&silent` - Can be combined with other parameters

### Loader: localStorage Keys
-   `stagepass_domain` - Stores active domain (`localStorage.getItem('stagepass_domain')`)

### Loader: Global Functions
-   `window.splog(...args)` - Structured logging (only when session active)
-   `window.spwarn(...args)` - Warning logs
-   `window.sperror(...args)` - Error logs

### Modules: Loading Methods
-   **Automatic (via script tag parameter):** Add `?modules` or `?modules=inject` to the loader script src - Core loader loads modules dynamically
-   **Manual (via script tags):** Load modules as separate scripts after `loader.min.js`:
    ```html
    <script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@1/dist/loader.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@1/dist/inject.min.js"></script>
    ```
-   **Important:** Core loader must be loaded first, as modules require `stagepass.vars` (or `window.stagepass.vars`)
-   **Module Registration:** Modules automatically register themselves on `stagepass` (e.g., `stagepass.inject` or `window.stagepass.inject`)
-   **Global Variable:** `stagepass` is available as a global variable (without `window.` prefix) for convenience, but `window.stagepass` also works
-   **Parameter Source:** The `modules` parameter is read from the loader script tag's `src` attribute, not from the page URL

### CLI: Commands
-   `stagepass setup` - Install dependencies and configure .sp domain
-   `stagepass link [domain]` - Link current directory to .sp domain (domain optional, defaults to folder name)
-   `stagepass unlink [domain]` - Unlink directory from .sp domain (domain optional, defaults to folder name)
-   `stagepass reload` - Reload Caddy configuration
-   `stagepass start` - Start background services (Caddy & PHP)
-   `stagepass stop` - Stop all background services
-   All commands support `-v, --verbose` flag for detailed output

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
    -   Loader CDN: `https://cdn.jsdelivr.net/npm/@stagepass/loader@1/dist/loader.min.js` or `https://unpkg.com/@stagepass/loader@1`