# Stagepass

![License](https://img.shields.io/npm/l/stagepass)
![Version](https://img.shields.io/npm/v/stagepass)
![Tests](https://img.shields.io/github/actions/workflow/status/stagepass/stagepass/test.yml)

**Develop locally. Preview globally. Keep Webflow happy.**

Stagepass is a developer toolchain that bridges the gap between your local IDE (VS Code) and live Webflow projects. It replaces the tedious "Edit -> Publish -> Refresh" loop with instant local code injection via secure SSL proxies.

**Forget manual code drops.** Write TypeScript, SCSS, or PHP locally and see changes instantly on your production URL.

---

## ⚡️ Features

* **Zero-Config SSL:** Automatically generates trusted certificates for local `.sp` domains.
* **Smart Injection:** The universal loader swaps production assets with local files only when you tell it to.
* **Lean Architecture:** Powered by **Caddy** and native Node.js. No Docker bloat, no heavy virtual machines.
* **Legacy Support:** Works with modern bundlers (Vite/Webpack) and legacy PHP setups.
* **Security First:** Strict origin whitelisting ensures only *your* local machine can inject code.

---

## 📦 Installation

Stagepass is a CLI tool distributed via npm.

```bash
npm install -g stagepass
```

### System Requirements
* macOS (Windows/Linux support coming soon)
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
Add the **Universal Loader** to your Webflow project settings (Project Settings > Custom Code > Head Code). This script is lightweight (<1KB) and safe for production.

```html
<script src="[https://cdn.jsdelivr.net/npm/@stagepass/loader@1/dist/loader.min.js](https://cdn.jsdelivr.net/npm/@stagepass/loader@1/dist/loader.min.js)"></script>
```

### 4. Tag Your Scripts
In the Webflow Designer, instead of hardcoding your script `src`, use data attributes.

**Before:**
```html
<script src="[https://cdn.example.com/app.min.js](https://cdn.example.com/app.min.js)"></script>
```

**After (Stagepass Ready):**
```html
<script 
  data-src="[https://cdn.example.com/app.min.js](https://cdn.example.com/app.min.js)" 
  data-stagepass="true"
  data-stagepass-path="js/app.js"
></script>
```
* `data-src`: The production URL (loaded by default for all users).
* `data-stagepass-path`: The relative path to the file on your local machine.

### 5. Activate Dev Mode
Go to your live Webflow URL and append the parameter:

`https://www.my-client.com/?stagepass=my-project.sp`

**That's it.** The loader will persist this state in `localStorage`. You can now reload the page, browse sub-pages, and Stagepass will inject your local code automatically.

To turn it off: `?stagepass=off`

---

## 🛠 CLI Reference

| Command | Description |
| :--- | :--- |
| `stagepass setup` | Installs dependencies and configures DNS/SSL logic (`.sp` resolver). |
| `stagepass start` | Starts the background Caddy/PHP services. |
| `stagepass link [domain]` | Links current directory to a `.sp` domain. |
| `stagepass unlink` | Removes the link for the current directory. |
| `stagepass status` | Checks if services are running. |

---

## 🔒 Security Architecture

Stagepass does not allow arbitrary code injection. The loader implements strict **Origin Whitelisting**:

1.  It only accepts injection from domains ending in `.sp` or `localhost`.
2.  It uses `data-src` as the source of truth, preventing race conditions or double-loading scripts.
3.  Production users never see or load the Stagepass logic (it exits early if no localStorage key is found).

---

## 🤝 Contributing

We welcome contributions! This project is a monorepo managed with npm workspaces.

1.  Clone the repo: `git clone https://github.com/stagepass/stagepass.git`
2.  Install dependencies: `npm install`
3.  Build packages: `npm run build`

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and pull request process.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.