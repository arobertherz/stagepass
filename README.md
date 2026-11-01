# Stagepass

![License](https://img.shields.io/npm/l/@stagepass%2Fcli)
![CLI Version](https://img.shields.io/npm/v/@stagepass/cli)
![Loader Version](https://img.shields.io/npm/v/@stagepass/loader)
![Tests](https://img.shields.io/github/actions/workflow/status/arobertherz/stagepass/test.yml)

**Develop locally. Preview globally. Keep Webflow happy.**

Stagepass is a developer toolchain that bridges the gap between your local IDE and live Webflow projects. It replaces the tedious "Edit -> Publish -> Refresh" loop with instant local code injection via secure SSL proxies.

**Forget manual code drops.** Write TypeScript, SCSS, or PHP locally and see changes instantly on your production URL.

---

## 🎯 The Problem

When developing custom code for Webflow projects, you face a frustrating workflow:

1. **Write code locally** in your IDE (TypeScript, SCSS, PHP, etc.)
2. **Build/compile** your code to production-ready files
3. **Upload to Webflow** via manual code drops or exports
4. **Publish the site** to see changes
5. **Refresh the browser** to test
6. **Repeat** for every small change

This creates a slow, error-prone development cycle. You can't use modern development tools like hot-reload, and testing requires constant publishing to Webflow.

## ✨ The Solution

Stagepass enables **instant local development** on live Webflow sites without touching Webflow's publishing system.

**What Stagepass enables:**
* Write and test code locally while viewing it on your production Webflow URL
* See changes instantly without publishing to Webflow
* Use modern development tools (TypeScript, SCSS, bundlers, hot-reload)
* Test on the actual production site with real content and interactions
* Keep your production site untouched - only you see the local changes

**How it works:**
1. **Local SSL Proxy:** Stagepass creates secure `.sp` domains (e.g., `my-project.sp`) that serve your local files with valid SSL certificates
2. **Universal Loader:** A tiny script injected into your Webflow site detects when you're in "dev mode" and swaps production asset URLs with your local `.sp` domain URLs
3. **Session Persistence:** Once activated via URL parameter (`?stagepass=my-project.sp`), the dev session persists across tabs/reloads until it expires (default 12 hours in v2)
4. **Selective Injection:** Only files tagged with `data-stagepass` attributes are swapped - everything else loads normally from production

**The magic:** Your production site stays live and unchanged. Only you (when dev mode is active) see your local code injected seamlessly into the live site.

---

## 📑 Table of Contents

* [🎯 The Problem](#-the-problem)
* [✨ The Solution](#-the-solution)
* [⚡️ Features](#️-features)
* [📦 Installation](#-installation)
* [📌 Version pinning](#-version-pinning)
* [🚀 Quick Start](#-quick-start)
* [🛠 CLI Reference](#-cli-reference)
* [🔒 Security Architecture](#-security-architecture)
* [🎛 Loader Runtime API](#-loader-runtime-api)
* [🧩 Modules](#-modules)
* [🤖 AGENTS.md Templates](#-agentsmd-templates)
* [🤝 Contributing](#-contributing)
* [📄 License](#-license)
* [🙏 Acknowledgments](#-acknowledgments)

---

## ⚡️ Features

* **Zero-Config SSL:** Automatically generates trusted certificates for local `.sp` domains.
* **Smart Injection:** The universal loader swaps production assets with local files only when you tell it to.
* **CSS & JavaScript Support:** Works with both stylesheets and scripts.
* **Intelligent Loading:** Automatically uses `defer` for scripts to ensure proper dependency loading order.
* **Auto Path Detection:** If `data-stagepass-path` is omitted, filename is automatically extracted from production URL.
* **Debug Mode:** Enable logging without URL swapping for troubleshooting.
* **Quiet Stagepass logs:** Stagepass' own `sp.log` / `sp.warn` / `sp.error` only print when a session is active (optional legacy global console mute via `data-stagepass-mute-console`).
* **Modular Architecture:** Core loader (~9.7 KB minified, ~4.0 KB gzipped) with optional modules loaded as separate script tags.
* **Programmatic API:** Access environment variables and inject assets programmatically via `sp` (preferred) or `stagepass` / `window.stagepass`.
* **Lean Architecture:** Powered by **Caddy** and native Node.js. No Docker bloat, no heavy virtual machines.
* **Legacy Support:** Works with modern bundlers (Vite/Webpack) and legacy PHP setups.
* **Security First:** Strict origin whitelisting ensures only *your* local machine can inject code.

---

## 📦 Installation

Stagepass CLI is distributed via npm (`engines.node`: `>=18.0.0`). Prefer the major pin `@2` (exact pin optional):

```bash
npm install -g @stagepass/cli@2
```

Or run once without a global install:

```bash
npx @stagepass/cli@2 setup
```

### System Requirements
* macOS
* Node.js 18+
* Homebrew (for Caddy, PHP, Dnsmasq)

---

## 📌 Version pinning

Stagepass follows strict semver: **no breaking changes within v2**; breaking changes only land in a new major (v3). For production CDN embeds, pin the **major** (`@2`).

### Recommended (`@2`)

```html
<script
  src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js"
  data-stagepass-version="2.0.0"
></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/inject.min.js"></script>
```

```html
<!-- unpkg short form (package `main`) -->
<script src="https://unpkg.com/@stagepass/loader@2"></script>

<!-- unpkg full path -->
<script src="https://unpkg.com/@stagepass/loader@2/dist/loader.min.js"></script>
```

Same pattern for modules, e.g. `https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/inject.min.js`.

See [MIGRATION.md](MIGRATION.md) for breaking changes from 1.x.

### Optional exact pin

For maximum control (freeze one publish), use an exact version such as `@2.0.0`:

```html
<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2.0.0/dist/loader.min.js"></script>
```

### Legacy 1.x (still valid if you pin it)

Sites that keep `@1` / exact `1.x` pins are unaffected by 2.x:

```html
<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@1.2.0/dist/loader.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@1.1.0/dist/inject.min.js"></script>
```

Why `@2`:
* **Compatible updates**: minor/patch releases within v2 stay backward compatible under strict semver.
* **One intentional major bump**: breaking changes require a new major (v3) and a deliberate URL change.
* **Exact pin when needed**: use `@2.0.0` (or any exact version) for maximum control; prereleases are never resolved by `@2` (pin the exact beta, e.g. `@2.1.0-beta.1`).

---

## 🚀 Quick Start

### 1. Initialize the Environment
Run this once to install the necessary core dependencies (Caddy, Dnsmasq, PHP) and configure your system resolver.

```bash
stagepass setup
stagepass start
```

### 2. Link a Project
Navigate to your local project folder (where your `dist/` or `js/` files live).

```bash
cd my-awesome-project
stagepass link my-project --origin www.example.com --origin my-project.webflow.io
```

* Domain is optional (defaults to the folder name). The `.sp` suffix is added if missing.
* Success looks like: `Linked: https://my-project.sp -> /absolute/path`.
* Default CORS allowlist is local only (`*.sp`, `localhost`, `127.0.0.1`). Live/Webflow hosts are **not** included until you pass `--origin` (repeatable). See [CLI Reference](#-cli-reference).

### 3. Integrate with Webflow
Add the **Universal Loader** to your Webflow project settings (Project Settings > Custom Code > Head Code). The minified loader is ~9.7 KB (~4.0 KB gzipped) and safe for production. Prefer the major pin `@2` (see [Version pinning](#-version-pinning)).

**Option 1 - CDN (jsDelivr & unpkg):**

```html
<!-- Core loader only (major pin @2) -->
<script
  src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js"
  data-stagepass-version="2.0.0"
></script>

<!-- Or using unpkg (short form or full path): -->
<!-- <script src="https://unpkg.com/@stagepass/loader@2"></script> -->
<!-- <script src="https://unpkg.com/@stagepass/loader@2/dist/loader.min.js"></script> -->
```

**Option 2 - Local** (to avoid cross-domain issues):

You can either download the built files manually or install them via npm inside your project:

```bash
# Add loader (and optional modules) to your project
npm install @stagepass/loader @stagepass/modules --save-dev
```

- The compiled files live in `node_modules/@stagepass/loader/dist/loader.min.js`
  (and `node_modules/@stagepass/modules/dist/inject.min.js` for the Injector).
- Copy them into your project’s asset folder (or let your bundler do it), then reference them locally:
```html
<script src="/loader.min.js"></script>
<!-- Or if hosted in a subdirectory: -->
<script src="/js/loader.min.js"></script>
```

**Optional - Load Modules:**
Modules extend the core loader with additional features (e.g., programmatic injection). **Modules depend on the Loader:** include both as separate `<script>` tags in `<head>`, loader first; when using npm, `@stagepass/modules` declares `@stagepass/loader` as a peer dependency (install both, e.g. `npm install @stagepass/loader @stagepass/modules`).

```html
<script
  src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js"
  data-stagepass-version="2.0.0"
></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/inject.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/cookies.min.js"></script>
```

Or load the combined modules bundle:

```html
<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/all.min.js"></script>
```

### 4. Tag Your Scripts & Stylesheets
In the Webflow Designer, instead of hardcoding your script `src` or stylesheet `href`, use data attributes.

**JavaScript - Before:**
```html
<script src="https://cdn.example.com/app.min.js"></script>
```

**JavaScript - After (Stagepass Ready):**
```html
<script 
  data-src="https://cdn.example.com/app.min.js" 
  data-stagepass="true"
  data-stagepass-path="js/app.js"
></script>
```

**CSS - Before:**
```html
<link rel="stylesheet" href="https://cdn.example.com/styles.css">
```

**CSS - After (Stagepass Ready):**
```html
<link 
  rel="stylesheet"
  data-href="https://cdn.example.com/styles.css" 
  data-stagepass="true"
  data-stagepass-path="css/styles.css"
>
```

**Attribute Reference:**
* `data-src` / `data-href`: The production URL (loaded by default for all users).
* `data-stagepass-path`: The relative path to the file on your local machine (optional; if omitted while swapping, the filename is extracted from the production URL).
* `data-stagepass`: Marks the element for processing (presence is enough; `"true"` is conventional).
* `data-stagepass-version` (loader tag) / `data-stagepass-v` (per asset): In production, appends `?v=<version>` for cache busting. `data-stagepass-cachebust` no longer timestamps every production page view.
* `data-stagepass-session-hours` (loader tag): Optional session lifetime in hours (default `12`).
* `data-stagepass-mute-console="true"` (loader tag): Opt-in legacy global console mute in production when no session.

### 5. Activate Dev Mode
Go to your live Webflow URL and append the parameter:

`https://www.my-client.com/?stagepass=my-project.sp`

**That's it.** The loader will persist this state in `localStorage`. You can now reload the page, browse sub-pages, and Stagepass will inject your local code automatically.

**Available Modes:**
* `?stagepass=my-project.sp`: activate local swapping (session stored in `localStorage` as JSON `{ domain, expires }`, default **12 h**)
* `?stagepass=debug`: logging only, no URL swapping
* `?stagepass=off` / `?stagepass=0` / `?stagepass=false`: clear the session

The `?stagepass=` parameter is removed from the address bar via `history.replaceState` after processing.

**Visual indicator (badge):** When a session is active, a fixed top-right badge appears. Click it to clear the session and reload (same as `?stagepass=off`).

| State | Badge text |
| :--- | :--- |
| Active swap | `STAGEPASS ACTIVE` |
| Debug | `STAGEPASS DEBUG` |
| Active + Chrome LNA prompt/denied | `STAGEPASS · ALLOW LOCAL NETWORK` |
| Debug + Chrome LNA prompt/denied | `STAGEPASS DEBUG · LNA` |

When LNA help is needed, the badge `title` and a console warning use the same hint text from the loader.

## 🛠 CLI Reference

Typical order: `setup` → `start` → `link` (then `reload` / `unlink` / `stop` as needed). All commands support `-v, --verbose`.

| Command | Description |
| :--- | :--- |
| `stagepass setup` | Install Caddy, PHP, Dnsmasq via Homebrew and configure the `.sp` resolver. |
| `stagepass start` | Start background Caddy & PHP services (also migrates legacy Caddyfile blocks if needed). |
| `stagepass link [domain]` | Link the current directory to a `.sp` domain and reload Caddy. |
| `stagepass unlink [domain]` | Remove the link (and `projects.json` entry) for that domain. |
| `stagepass reload` | Reload Caddy configuration (also migrates legacy blocks if needed). |
| `stagepass stop` | Stop background services. |

### `link` details

* `[domain]` is optional; defaults to the current folder name. Values are lowercased; `.sp` is appended if missing. Invalid folder names are slugified when the argument is omitted.
* Output on success: `Linked: https://<domain>.sp -> <absolute-root>`.

**`link` options:**

| Option | Behaviour |
| :--- | :--- |
| `--origin <host>` | Allow CORS from this live hostname (**repeatable**). Accepts `example.com`, `www.example.com`, `*.example.com`, or `https://example.com` (bare hostname or `https://` only; no path/port). Merges into the stored list. |
| `--remove-origin <host>` | Remove a stored CORS hostname (**repeatable**; same validation). |
| `--allow-all-origins` | Set `Access-Control-Allow-Origin: *` (prints a warning). Prefer `--origin`. |
| `--no-allow-all-origins` | Disable allow-all and use the origin allowlist. |
| `-v, --verbose` | Show Caddy reload output. |

Omitting both allow-all flags keeps the stored / seeded setting. New links default to allowlist mode (`allowAllOrigins: false`).

**Default CORS allowlist (always):** `https://*.sp`, `http(s)://localhost[:port]`, `http(s)://127.0.0.1[:port]`, plus any `--origin` / `~/.stagepass/projects.json` entries. **`*.webflow.io` is not a default**; add e.g. `--origin my-project.webflow.io`. Explicit `--origin *.webflow.io` is allowed but warns.

Dotfiles / `node_modules` / sensitive extensions always return **404** on linked sites. Full security notes: [Security Architecture](#-security-architecture) and [`packages/cli/README.md`](packages/cli/README.md).

---

## 🔒 Security Architecture

Stagepass does not allow arbitrary remote injection. Controls exist in both the loader and the CLI:

1. **Session domains:** The loader only accepts `*.sp`, `localhost`, `localhost:<port>`, or `debug`. Invalid values are cleared from `localStorage`.
2. **Asset tagging:** Tagged elements use `data-src` / `data-href` as the production source of truth; originals are removed after the replacement is inserted (no double-load).
3. **No session → production URLs:** Without an active session, tagged assets keep production URLs (optional `?v=` from `data-stagepass-version` / `data-stagepass-v`).
4. **Quiet Stagepass logs:** `sp.log` / `sp.warn` / `sp.error` are no-ops without a session; the global console is not muted unless `data-stagepass-mute-console="true"`.
5. **Caddy CORS + path blocking:** Linked `.sp` sites reflect ACAO only for the allowlist above; blocked paths (`.git`, `.env`, `node_modules`, key/cert/db/log extensions) always 404.

---

## 🎛 Loader Runtime API

### Global Variables (`sp.vars`)

Access runtime information via `sp.vars` (preferred), or `stagepass.vars` / `window.stagepass.vars`:

```javascript
sp.vars.isLocal     // boolean - true if Stagepass active or localhost
sp.vars.env         // 'local' | 'staging' | 'production'
sp.vars.domain      // string - Current domain (local or production)
sp.vars.timestamp   // number - Session start time (for cache-busting)
sp.vars.version     // string - Loader version
sp.vars.client      // object - Client runtime info (theme/browser/os/device/viewport/locale/capabilities)
```

### Client Runtime Info (`sp.vars.client`)

The loader exposes technical client/runtime data:

```javascript
sp.vars.client.theme.preferred   // 'light' | 'dark' | 'no-preference'
sp.vars.client.theme.current     // 'light' | 'dark' | 'unknown' (auto-updated)
sp.vars.client.browser.family    // 'chrome' | 'safari' | 'firefox' | 'edge' | 'opera' | 'unknown'
sp.vars.client.browser.major     // number | null
sp.vars.client.os.family         // 'macos' | 'windows' | 'ios' | 'android' | 'linux' | 'unknown'
sp.vars.client.device.type       // 'mobile' | 'tablet' | 'desktop' | 'unknown'
sp.vars.client.device.touch      // boolean
sp.vars.client.viewport.width    // number (auto-updated on resize)
sp.vars.client.viewport.height   // number (auto-updated on resize)
sp.vars.client.viewport.dpr      // number (auto-updated on resize)
sp.vars.client.locale.language   // string (e.g. 'de-DE')
sp.vars.client.locale.timezone   // string | null
sp.vars.client.capabilities.cookiesEnabled // boolean
sp.vars.client.capabilities.localStorage   // boolean
sp.vars.client.capabilities.sessionStorage // boolean
```

Notes:
- Browser/OS/device detection is heuristic (best effort).
- `client` values are runtime data, not analytics consent/tracking signals.
- `theme.current` and `viewport.*` are refreshed while the page is running.

### Local URL helper (`sp.resolveLocalUrl`)

The loader exposes a single place to build local asset URLs (used by modules and by custom code):

```javascript
// Returns local URL when a Stagepass session is active, otherwise ''
sp.resolveLocalUrl('js/app.js');   // e.g. 'https://my-project.sp/js/app.js?_cb=1234567890'
sp.resolveLocalUrl('/lib.js');     // leading slash is normalized
```

### Logging API

Stagepass provides a structured logging API that wraps the browser console when a Stagepass session is active:

```javascript
// Preferred API
sp.log('Hello from Stagepass');          // info / log
sp.log('warn', 'Something looks off');   // warn level
sp.log('error', 'Something went wrong'); // error level

sp.warn('This is a warning');
sp.error('This is an error');
```

`sp.log` automatically prefixes messages with a timestamp and (if available) the calling file and line, e.g. `[🎫 11:58:02 | app.js:830]`. Logging is only active when a Stagepass session is enabled; otherwise the helper functions are effectively no-ops. The deprecated globals `splog` / `spwarn` / `sperror` were **removed in v2**.

---

## 🧩 Modules

Modules depend on the **Loader** at runtime (they use `sp.vars` / `stagepass.vars`). The loader script must be loaded before any module script. For npm users, `@stagepass/modules` lists `@stagepass/loader` as a peer dependency: install the loader when you install modules.

### Available Modules

**Injector Module** (`inject.min.js`)
- Programmatic asset injection API
- Smart source resolution (local vs production)
- Flexible positioning and deduplication
- Include as a separate script tag after `loader.min.js`

**Cookies Module** (`cookies.min.js`)
- Lightweight cookie utility helpers (no consent manager)
- Read, write, delete, existence checks, and list helpers
- Available as `sp.cookies.*`
- Include as a separate script tag after `loader.min.js`

### Injector: Programmatic Injection API

When the Injector module is loaded, use `sp.inject()` (preferred). `stagepass.inject()` and `window.stagepass.inject()` remain available as aliases:

```javascript
// Single injection
await sp.inject({
  src: 'https://cdn.example.com/lib.js',
  stagepass: true,        // Enable local swapping when active
  localPath: 'lib.js',     // Optional: local file path (defaults to filename from src)
  id: 'my-library',        // Optional: for deduplication
  position: 'head',        // 'head' | 'body-start' | 'body-end' | { target: '#id', action: 'before' | 'after' }
  type: 'script',          // Optional: 'script' | 'style' (auto-detected from extension)
  version: '2.0.0',        // Optional: in production, append ?v=<version> for cache busting
  async: false,            // Optional: default false (keeps script order)
  defer: true,             // Optional: default true (unless async is true)
  attributes: {            // Optional: additional HTML attributes
    crossorigin: 'anonymous'
  }
});

// Batch injection (array)
await sp.inject([
  { src: 'https://cdn.example.com/lib1.js', stagepass: true, localPath: 'lib1.js', version: '2.0.0' },
  { src: 'https://cdn.example.com/lib2.css', stagepass: true, localPath: 'lib2.css', type: 'style', version: '2.0.0' }
]);

// Batch injection ({ scripts, styles })
await sp.inject({
  scripts: [{ src: 'https://cdn.example.com/lib1.js', stagepass: true, path: 'lib1.js', version: '2.0.0' }],
  styles: [{ src: 'https://cdn.example.com/lib2.css', stagepass: true, localPath: 'lib2.css', version: '2.0.0' }]
});
```

`path` is an alias for `localPath`. Deprecated `cacheBust` no longer appends production timestamps; use `version` instead.

### Cookies: Utility API

When the Cookies module is loaded, use `sp.cookies`:

```javascript
sp.cookies.bake('token', 'abc123', { days: 7, path: '/' });
sp.cookies.eat('token'); // 'abc123'
sp.cookies.has('token'); // true
sp.cookies.list(); // { token: 'abc123', ... }
sp.cookies.throw('token', { path: '/' });
```

API reference:
- `sp.cookies.bake(name, value, options?)`  
  Creates/updates a cookie.
- `sp.cookies.eat(name, options?)`  
  Reads a cookie value. Returns `null` when not found.
- `sp.cookies.throw(name, options?)`  
  Deletes a cookie (writes `Max-Age=0` + expired date).
- `sp.cookies.has(name)`  
  Boolean existence check.
- `sp.cookies.list(options?)`  
  Returns all visible cookies as an object map.

`bake` options:
- `days?: number` - Expiration in days.
- `maxAge?: number` - Expiration in seconds (`Max-Age`).
- `path?: string` - Cookie path (default: `/`).
- `domain?: string` - Cookie domain.
- `secure?: boolean` - Defaults to `true` on HTTPS pages.
- `sameSite?: 'Lax' | 'Strict' | 'None'` - Default: `Lax`.
- `encode?: boolean` - URL-encode key/value (default: `true`).
- `json?: boolean` - Store value as JSON string.

`eat` / `list` options:
- `decode?: boolean` - URL-decode values (default: `true`).
- `json?: boolean` - Attempt `JSON.parse` for values.

`throw` options:
- `path?: string` (default: `/`)
- `domain?: string`
- `secure?: boolean`
- `sameSite?: 'Lax' | 'Strict' | 'None'`

JSON example:

```javascript
sp.cookies.bake('profile', { id: 7, role: 'editor' }, { json: true, days: 30 });
sp.cookies.eat('profile', { json: true }); // { id: 7, role: 'editor' }
```

Notes and limitations:
- JavaScript cannot read or delete `HttpOnly` cookies.
- To reliably delete a cookie, use the same `path`/`domain` you used when writing it.
- If `sameSite: 'None'` is used, the module enforces `Secure=true` (browser requirement).
- This module provides cookie storage helpers only (bake/eat/throw). It does **not** implement consent management.

---

## 🤖 AGENTS.md Templates

Use one of the following canonical profiles in your project-level `AGENTS.md` so AI coding agents know exactly which Stagepass runtime APIs are available.

### Canonical profile files
- Loader only: [`AGENTS.LOADER.md`](./AGENTS.LOADER.md)
- Loader + Modules (Injector + Cookies): [`AGENTS.MODULES.md`](./AGENTS.MODULES.md)

### How to use
1. Copy the relevant file content into your project `AGENTS.md`.
2. Keep only one active profile per project to avoid ambiguous API assumptions.
3. If your tooling supports remote include/import in AGENTS files, you can reference the raw GitHub URL instead of copy-paste.

Example raw URLs:
- `https://raw.githubusercontent.com/arobertherz/stagepass/master/AGENTS.LOADER.md`
- `https://raw.githubusercontent.com/arobertherz/stagepass/master/AGENTS.MODULES.md`

If your tooling does **not** support remote include/import, use copy-paste from the files above.

---

## 🤝 Contributing

We welcome contributions! This project is a monorepo managed with npm workspaces.

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for setup, the Docker test recipe, commit style, and PR flow.  
For local development details, see [DEVELOPMENT.md](DEVELOPMENT.md).  
To report a vulnerability, see **[SECURITY.md](SECURITY.md)** (private reporting only).

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

Built with AI coding agents and tools, every release reviewed by a human.