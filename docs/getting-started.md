# Getting started

Stagepass bridges a live Webflow (or any production) site with files on your Mac. The CLI creates HTTPS `.sp` domains; the loader swaps tagged assets to those local URLs while a session is active.

## The Problem

When developing custom code for Webflow projects, you face a frustrating workflow:

1. **Write code locally** in your IDE (TypeScript, SCSS, PHP, etc.)
2. **Build/compile** your code to production-ready files
3. **Upload to Webflow** via manual code drops or exports
4. **Publish the site** to see changes
5. **Refresh the browser** to test
6. **Repeat** for every small change

This creates a slow, error-prone development cycle. You cannot use modern development tools like hot-reload, and testing requires constant publishing to Webflow.

## The Solution

Stagepass enables **instant local development** on live Webflow sites without touching Webflow's publishing system.

**What Stagepass enables:**

* Write and test code locally while viewing it on your production Webflow URL
* See changes instantly without publishing to Webflow
* Use modern development tools (TypeScript, SCSS, bundlers, hot-reload)
* Test on the actual production site with real content and interactions
* Keep your production site untouched: only you see the local changes

**How it works:**

1. **Local SSL Proxy:** Stagepass creates secure `.sp` domains (e.g., `my-project.sp`) that serve your local files with valid SSL certificates
2. **Universal Loader:** A tiny script injected into your Webflow site detects when you are in "dev mode" and swaps production asset URLs with your local `.sp` domain URLs
3. **Session Persistence:** Once activated via URL parameter (`?stagepass=my-project.sp`), the dev session persists across tabs/reloads until it expires (default 12 hours in v2)
4. **Selective Injection:** Only files tagged with `data-stagepass` attributes are swapped: everything else loads normally from production

**The result:** Your production site stays live and unchanged. Only you (when dev mode is active) see your local code injected seamlessly into the live site.

## Features

* **Zero-Config SSL:** Automatically generates trusted certificates for local `.sp` domains.
* **Smart Injection:** The universal loader swaps production assets with local files only when you tell it to.
* **CSS & JavaScript Support:** Works with both stylesheets and scripts.
* **Intelligent Loading:** Automatically uses `defer` for scripts to ensure proper dependency loading order.
* **Auto Path Detection:** If `data-stagepass-path` is omitted, the filename is automatically extracted from the production URL.
* **Debug Mode:** Enable logging without URL swapping for troubleshooting.
* **Quiet Stagepass logs:** Stagepass' own `sp.log` / `sp.warn` / `sp.error` only print when a session is active (optional legacy global console mute via `data-stagepass-mute-console`).
* **Modular Architecture:** Core loader (~16.5 KB minified, ~7.1 KB gzipped) with optional modules loaded as separate script tags.
* **Programmatic API:** Access environment variables and inject assets programmatically via `sp` (preferred) or `stagepass` / `window.stagepass`.
* **Lean Architecture:** Powered by **Caddy** and native Node.js. No Docker bloat, no heavy virtual machines.
* **Legacy Support:** Works with modern bundlers (Vite/Webpack) and legacy PHP setups.
* **Security First:** Strict origin whitelisting ensures only *your* local machine can inject code.
* **Live reload:** `stagepass dev` (unreleased, CLI 2.3.0; preview or repository CLI) watches `dist/` and pushes CSS swaps / full reloads over SSE on the linked `.sp` domain; it checks whether Stagepass is running first (see [dev.md](./dev.md)).
* **Zero-cost production mode:** Opt-in `data-stagepass-live-src` so visitors load normal `src` / `href` without depending on the loader (see [loader.md](./loader.md#zero-cost-production-mode)).

## Installation

Stagepass CLI is distributed via npm. Published CLI 2.2.7 requires Node `>=18.0.0`; CLI 2.3.0 (unreleased) raises `engines.node` to `>=20.17.0`. Prefer the major pin `@2` (exact pin optional for production embeds; see [loader.md](./loader.md#version-pinning)):

```bash
npm install -g @stagepass/cli@2
```

Or run once without a global install:

```bash
npx @stagepass/cli@2 setup
```

### System Requirements

* **macOS only** (Homebrew-based setup). System commands (`setup`, `start`, `stop`, `reload`, `link`, `unlink`; `dev` is unreleased, CLI 2.3.0) refuse to run on other platforms with a clear error. This is not a breaking change: those commands never worked off macOS. `stagepass --version` and `--help` still work everywhere.
* Node.js `>=18.0.0` at runtime for the published CLI (`engines.node`). CLI 2.3.0 (unreleased) raises the floor to `>=20.17.0`. Development and CI use Node 22 or 24 (see [DEVELOPMENT.md](../DEVELOPMENT.md)).
* Homebrew (for Caddy, PHP, Dnsmasq)

## Quick Start

### 1. Initialize the Environment

Run this once to install the necessary core dependencies (Caddy, Dnsmasq, PHP) and configure your system resolver.

```bash
stagepass setup
stagepass start
```

`start` runs a read-only certs check and, when interactive, can offer `certs trust` (site `renew` is unreleased, CLI 2.3.0). When the login LaunchAgent is installed, `start` uses `launchctl kickstart`.

### 2. Scaffold or link a project

**Option A: scaffold with `stagepass new`**

```bash
stagepass new my-project --yes --site my-project.webflow.io
cd my-project
stagepass link --origin my-project.webflow.io
npm run build
```

Published CLI 2.2.7 supports `--site` for live-module detection. Flags `--staging` / `--production`, `--php` / `--php-examples`, and `--link` are **(unreleased, CLI 2.3.0)**; on that release staging / production hosts are written to `stagepass.json` as `origin` / `production` and `link` without `--origin` flags uses those hosts. See [cli.md](./cli.md#new).

**Option B: link an existing folder**

```bash
cd my-awesome-project
stagepass link my-project --origin www.example.com --origin my-project.webflow.io
```

* Domain is optional (defaults to the folder name). The `.sp` suffix is added if missing.
* Success looks like: `Linked: https://my-project.sp -> /absolute/path`.
* Default CORS allowlist is local only (`*.sp`, `localhost`, `127.0.0.1`). Live/Webflow hosts are **not** included until you pass `--origin` (repeatable). See [cli.md](./cli.md#link).

### 3. Integrate with Webflow

Add the **Universal Loader** to your Webflow project settings (Project Settings > Custom Code > Head Code). Prefer the major pin `@2` for docs and trials; prefer an exact pin in production (see [Version pinning](./loader.md#version-pinning)).

**Option 1: CDN (jsDelivr):**

```html
<!-- Core loader only (major pin @2) -->
<script
  src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js"
  data-stagepass-version="2.4.0"
></script>
```

Use the full `/dist/loader.min.js` path on unpkg and any CDN that redirects (short package URLs keep the pre-redirect location on the script element, so `flag.min.js` / `live.min.js` 404). Or set `data-stagepass-flag-base`.

**Option 2: Local** (to avoid cross-domain issues):

```bash
# Add loader (and optional modules) to your project
npm install @stagepass/loader @stagepass/modules --save-dev
```

* The compiled files live in `node_modules/@stagepass/loader/dist/loader.min.js` (and `node_modules/@stagepass/modules/dist/inject.min.js` for the Injector).
* Copy them into your project’s asset folder (or let your bundler do it), then reference them locally:

```html
<script src="/loader.min.js"></script>
<!-- Or if hosted in a subdirectory: -->
<script src="/js/loader.min.js"></script>
```

When you self-host, copy `flag.min.js`, `flag-card.min.js`, and `live.min.js` into the same folder as the loader (or set `data-stagepass-flag-base`).

**Optional: Load Modules**

Modules extend the core loader with additional features (e.g., programmatic injection). **Modules depend on the Loader:** include both as separate `<script>` tags in `<head>`, loader first. When using npm, `@stagepass/modules` declares `@stagepass/loader` as a peer dependency (install both).

```html
<script
  src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js"
  data-stagepass-version="2.4.0"
></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/inject.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/cookies.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/maintenance.min.js"></script>
```

Or load the combined modules bundle:

```html
<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/all.min.js"></script>
```

Full module APIs: [modules.md](./modules.md).

### 4. Tag Your Scripts & Stylesheets

In the Webflow Designer, instead of hardcoding your script `src` or stylesheet `href`, use data attributes.

**JavaScript: Before**

```html
<script src="https://cdn.example.com/app.min.js"></script>
```

**JavaScript: After (Stagepass Ready)**

```html
<script
  data-src="https://cdn.example.com/app.min.js"
  data-stagepass="true"
  data-stagepass-path="js/app.js"
></script>
```

**CSS: Before**

```html
<link rel="stylesheet" href="https://cdn.example.com/styles.css">
```

**CSS: After (Stagepass Ready)**

```html
<link
  rel="stylesheet"
  data-href="https://cdn.example.com/styles.css"
  data-stagepass="true"
  data-stagepass-path="css/styles.css"
>
```

Full attribute reference (including `data-stagepass-live-src`, `data-stagepass-flag-base`, session hours, mute console): [loader.md](./loader.md#markup).

### 5. Activate Dev Mode

Go to your live Webflow URL and append the parameter:

`https://www.my-client.com/?stagepass=my-project.sp`

**That's it.** The loader will persist this state in `localStorage`. You can now reload the page, browse sub-pages, and Stagepass will inject your local code automatically.

**Browser prerequisites:** for this public-origin → `.sp` (loopback) path, allow Chrome **Local network** / **Loopback network** for that live site when prompted (or in Site settings if previously blocked), and trust the Stagepass local CA (`stagepass certs check` / `certs trust`). See [troubleshooting.md](./troubleshooting.md#public-origin-to-sp-err_failed).

For CSS hot swap and JS full reload while you edit, run `stagepass dev` from a preview or repository CLI build in the linked project **(unreleased, CLI 2.3.0)**. Live reload / `live.min.js` is in published loader **2.4.0** (npm `latest`; pin `@2.4.0`). Published **2.3.3** does not include it. `@2` is a major range alias, not the npm `latest` tag; after a publish the CDN can briefly serve the previous 2.x build. Pin an exact version (e.g. `@2.4.0`) when a specific build must load (see [dev.md](./dev.md)).

## Session modes

| URL | Effect |
| --- | --- |
| `?stagepass=my-project.sp` | Start a swap session (stored in `localStorage` as JSON `{ domain, expires }`, default **12 h**) |
| `?stagepass=debug` | Logging only, no asset swap |
| `?stagepass=off` / `0` / `false` | Clear the session |

The `?stagepass=` parameter is removed from the address bar via `history.replaceState` after processing.

While a session is active, a small pass-icon pill appears in the top-right corner (flag UI). Visitors without a session never see it and never download its code. Details: [loader.md](./loader.md#dev-flag).

## Next

* [CLI reference](./cli.md)
* [Loader](./loader.md)
* [Modules](./modules.md)
* [Live reload (`stagepass dev`)](./dev.md)
* [Troubleshooting](./troubleshooting.md)
* [Migration from 1.x](./migration.md)
