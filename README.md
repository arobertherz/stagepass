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
3. **Session Persistence:** Once activated via URL parameter (`?stagepass=my-project.sp`), the dev session persists across page reloads and navigation
4. **Selective Injection:** Only files tagged with `data-stagepass` attributes are swapped - everything else loads normally from production

**The magic:** Your production site stays live and unchanged. Only you (when dev mode is active) see your local code injected seamlessly into the live site.

---

## 📑 Table of Contents

* [🎯 The Problem](#️-the-problem)
* [✨ The Solution](#️-the-solution)
* [⚡️ Features](#️-features)
* [📦 Installation](#-installation)
* [🚀 Quick Start](#-quick-start)
* [🛠 CLI Reference](#-cli-reference)
* [🎛 Loader Runtime API](#-loader-runtime-api)
* [🧩 Modules](#-modules)
* [🤖 AGENTS.md Templates](#-agentsmd-templates)
* [🔒 Security Architecture](#-security-architecture)
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
* **Console Suppression:** Automatically suppresses console logs in production mode (configurable for staging).
* **Modular Architecture:** Core loader (<3KB) with optional modules loaded on-demand.
* **Programmatic API:** Access environment variables and inject assets programmatically via `sp` (preferred) or `stagepass` / `window.stagepass`.
* **Lean Architecture:** Powered by **Caddy** and native Node.js. No Docker bloat, no heavy virtual machines.
* **Legacy Support:** Works with modern bundlers (Vite/Webpack) and legacy PHP setups.
* **Security First:** Strict origin whitelisting ensures only *your* local machine can inject code.

---

## 📦 Installation

Stagepass is a CLI tool distributed via npm.

```bash
npm install -g @stagepass/cli
```

### System Requirements
* macOS (Windows/Linux support maybe coming soon)
* Node.js 18+
* Homebrew (for dependency management)

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
cd ~/Sites/my-awesome-project
stagepass link my-project
```
*Your local folder is now served at `https://my-project.sp` with valid SSL.*

### 3. Integrate with Webflow
Add the **Universal Loader** to your Webflow project settings (Project Settings > Custom Code > Head Code). This script is lightweight (<3KB) and safe for production.

**Option 1 - CDN (jsDelivr & unpkg):**
```html
<!-- Core loader only -->
<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@1/dist/loader.min.js"></script>

<!-- Or using unpkg: -->
<script src="https://unpkg.com/@stagepass/loader@1"></script>
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
Modules extend the core loader with additional features (e.g., programmatic injection). **Modules depend on the Loader:** the loader script must always be included first; when using npm, `@stagepass/modules` declares `@stagepass/loader` as a peer dependency (install both, e.g. `npm install @stagepass/loader @stagepass/modules`). Load modules via script tag parameter or manually:

**Automatic (via script tag parameter):**
```html
<!-- Load all modules -->
<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@1/dist/loader.min.js?modules"></script>

<!-- Load specific modules -->
<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@1/dist/loader.min.js?modules=inject"></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@1/dist/loader.min.js?modules=inject,cookies"></script>
```

**Manual (via script tags):**
```html
<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@1/dist/loader.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@1/dist/inject.min.js"></script>
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
* `data-stagepass-path`: The relative path to the file on your local machine (optional - if omitted, filename is extracted from production URL and used as root path).
* `data-stagepass="true"`: Enables Stagepass for this element.
* `data-stagepass-cachebust="true"`: In production, appends `?_cb=timestamp` to the asset URL so the browser loads a fresh copy each page load (optional).

### 5. Activate Dev Mode
Go to your live Webflow URL and append the parameter:

`https://www.my-client.com/?stagepass=my-project.sp`

**That's it.** The loader will persist this state in `localStorage`. You can now reload the page, browse sub-pages, and Stagepass will inject your local code automatically.

**Available Modes:**
* `?stagepass=my-project.sp` - Activates dev mode with URL swapping (page URL parameter)
* `?stagepass=debug` - Activates debug mode (logging only, no URL swapping) (page URL parameter)
* `?stagepass=off` - Deactivates Stagepass (page URL parameter)

**Script Tag Parameters:**
* `?modules` or `?modules=inject` - Loads modules automatically (script tag parameter)
* `?silent` - Suppresses console logs even in staging environment (script tag parameter, useful for free Webflow.io sites)

**Note:** The `modules` and `silent` parameters are passed via the loader script tag (e.g., `loader.min.js?modules=inject&silent`), not as page URL parameters.

**Visual Indicator:** When Stagepass is active, a small badge appears in the top-right corner of the page. Click it to disconnect and deactivate Stagepass (equivalent to `?stagepass=off`).

## 🛠 CLI Reference

| Command | Description |
| :--- | :--- |
| `stagepass setup` | Installs dependencies and configures DNS/SSL logic (`.sp` resolver). |
| `stagepass start` | Starts the background Caddy/PHP services. |
| `stagepass link [domain]` | Links current directory to a `.sp` domain. |
| `stagepass unlink [domain]` | Removes the link for the current directory. |
| `stagepass reload` | Reloads Caddy configuration. |
| `stagepass stop` | Stops all background services. |

---

## 🔒 Security Architecture

Stagepass does not allow arbitrary code injection. The loader implements strict **Origin Whitelisting**:

1.  It only accepts injection from domains ending in `.sp`, `localhost`, or `localhost:*`.
2.  It uses `data-src` as the source of truth, preventing race conditions or double-loading scripts.
3.  Production users never see or load the Stagepass logic (it exits early if no localStorage key is found).
4.  Console logs are automatically suppressed in production mode to prevent information leakage.

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
```

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

// Legacy aliases (deprecated but still supported)
splog('message');   // use sp.log instead
spwarn('warning');  // use sp.warn instead
sperror('error');   // use sp.error instead
```

`sp.log` automatically prefixes messages with a timestamp and (if available) the calling file and line, e.g. `[🎫 11:58:02 | app.js:830]`. Logging is only active when a Stagepass session is enabled; otherwise the helper functions are effectively no-ops.

---

## 🧩 Modules

Modules depend on the **Loader** at runtime (they use `sp.vars` / `stagepass.vars`). The loader script must be loaded before any module script. For npm users, `@stagepass/modules` lists `@stagepass/loader` as a peer dependency—install the loader when you install modules.

### Available Modules

**Injector Module** (`inject.min.js`)
- Programmatic asset injection API
- Smart source resolution (local vs production)
- Flexible positioning and deduplication
- Load via `?modules=inject` or manually as script tag

**Cookies Module** (`cookies.min.js`)
- Lightweight cookie utility helpers (no consent manager)
- Read, write, delete, existence checks, and list helpers
- Available as `sp.cookies.*`

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
  cacheBust: true,        // Optional: in production, append ?_cb=timestamp to force fresh load
  async: false,            // Optional: default false
  defer: true,             // Optional: default true (unless async is true)
  attributes: {            // Optional: additional HTML attributes
    crossorigin: 'anonymous'
  }
});

// Batch injection
await sp.inject([
  { src: 'https://cdn.example.com/lib1.js', stagepass: true, localPath: 'lib1.js' },
  { src: 'https://cdn.example.com/lib2.css', stagepass: true, localPath: 'lib2.css', type: 'style' }
]);
```

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
sp.cookies.bake('profile', { id: 7, plan: 'pro' }, { json: true, days: 30 });
sp.cookies.eat('profile', { json: true }); // { id: 7, plan: 'pro' }
```

Notes and limitations:
- JavaScript cannot read or delete `HttpOnly` cookies.
- To reliably delete a cookie, use the same `path`/`domain` you used when writing it.
- If `sameSite: 'None'` is used, the module enforces `Secure=true` (browser requirement).
- This module provides cookie storage helpers only (bake/eat/throw). It does **not** implement consent management.

---

## 🤖 AGENTS.md Templates

Use one of the following canonical profiles in your project-level `AGENTS.md` so IDE agents (e.g., Cursor) know exactly which Stagepass runtime APIs are available.

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

1.  Clone the repo: `git clone https://github.com/arobertherz/stagepass.git`
2.  Install dependencies: `npm install`
3.  Build packages: `npm run build`

**For detailed local development setup, see [DEVELOPMENT.md](DEVELOPMENT.md).**

### Project Goals & Philosophy

Stagepass is designed with a clear mission: **to lower the barrier for less technical Webflow developers** and enable professional development workflows without requiring deep technical expertise.

**Our Core Principles:**
- **Accessibility First:** All features are opt-in and can be used independently
- **No Breaking Changes:** New features must maintain backward compatibility
- **Developer Experience:** Focus on ease of use and intuitive workflows
- **Professional Standards:** Enable best practices (TypeScript, SCSS, Git workflows) without complexity

**Current Development Priorities:**

1. **Variables API** (Issue #2) – ⭐ Lowest complexity, high value
   - Quick to implement, immediately useful
   - Low risk, high developer satisfaction

2. **Code Injection** (Issue #1) – ⭐⭐ Medium complexity, high value
   - Significantly extends functionality
   - Requires careful security considerations

3. **Git Simplification** (Issue #4) – ⭐⭐ Medium complexity, medium value
   - Improves developer workflow
   - Moderate implementation effort

4. **New Project Scaffolding** (Issue #3) – ⭐⭐⭐ High complexity, high value
   - Greatest impact on developer experience
   - Requires significant development effort

**Recommended Implementation Order:**
1. Start with Variables (#2) – Quick win that provides immediate value
2. Then Code Injection (#1) – Builds on variables, extends core functionality
3. Follow with Git Simplification (#4) – Improves workflow without core changes
4. Finally New Project (#3) – Comprehensive feature that ties everything together

**Risk Considerations:**
- ⚠️ **Security:** CSP/XSS concerns with Code Injection require careful implementation
- ⚠️ **Compatibility:** Git commands may vary across Git versions and platforms
- ⚠️ **Maintainability:** Additional features increase codebase complexity
- ⚠️ **User Experience:** Need to balance simplicity with power and flexibility

For detailed specifications of planned features, see [GitHub Issues](https://github.com/arobertherz/stagepass/issues).

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

Vibe-Coded with friendly support from Google Gemini and Cursor.