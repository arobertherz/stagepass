# Stagepass

![License](https://img.shields.io/npm/l/@stagepass%2Fcli)
![CLI Version](https://img.shields.io/npm/v/@stagepass/cli)
![Loader Version](https://img.shields.io/npm/v/@stagepass/loader)
![Tests](https://img.shields.io/github/actions/workflow/status/arobertherz/stagepass/test.yml)

**Develop locally. Preview globally. Keep Webflow happy.**

Stagepass bridges your local IDE and live Webflow (or any production) sites. The CLI serves your project over trusted HTTPS `.sp` domains; a small loader swaps tagged production assets to those local URLs while a session is active. Everyone else keeps seeing production.

## Install

```bash
npm install -g @stagepass/cli@2
```

macOS is required for system commands. Published CLI 2.3.0 needs Node.js `>=20.17.0`. Node 18 is no longer supported; stay on `@stagepass/cli@2.2.7` if you must remain on Node 18. See [docs/getting-started.md](docs/getting-started.md).

## Minimal example

```bash
stagepass setup && stagepass start
stagepass new demo --yes --staging demo.webflow.io --link
cd demo
stagepass build
stagepass dev
```

In Webflow head code (prefer major pin `@2`; exact pin optional; `data-stagepass-version` is optional cache-bust metadata):

```html
<script
  src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js"
  data-stagepass-version="2.4.0"
></script>
<script
  data-src="https://cdn.example.com/js/app.min.js"
  data-stagepass
  data-stagepass-path="dist/main.js"
></script>
```

Open `https://your-site/?stagepass=demo.sp`. Details: [docs/getting-started.md](docs/getting-started.md).

## Docs

| Guide | Contents |
| --- | --- |
| [Getting started](docs/getting-started.md) | Problem, solution, features, install, quick start |
| [CLI](docs/cli.md) | Commands, flags, AGENTS.md templates |
| [Loader](docs/loader.md) | Version pinning, attributes, Runtime API, security |
| [Modules](docs/modules.md) | inject, cookies, maintenance |
| [Live reload](docs/dev.md) | Guide for `stagepass dev` / `watch` (running check #40); client chunk `live.min.js` belongs to published loader 2.4.0 (npm `latest`) |
| [Migration](docs/migration.md) | 1.x → 2.x ([full guide](MIGRATION.md)) |
| [Troubleshooting](docs/troubleshooting.md) | Common fixes |

Also: [CONTRIBUTING.md](CONTRIBUTING.md), [DEVELOPMENT.md](DEVELOPMENT.md), [SECURITY.md](SECURITY.md), [RELEASING.md](RELEASING.md), [CHANGELOG.md](CHANGELOG.md).

## Contributing

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the Docker test recipe, Playwright E2E, and PR flow.

## License

MIT. See [LICENSE](LICENSE).

## Acknowledgments

Built with AI coding agents and tools, every release reviewed by a human.
