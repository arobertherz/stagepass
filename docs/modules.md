# Modules

Package: `@stagepass/modules`. Load modules as **separate script tags** after `loader.min.js`. The loader does not auto-load modules via query parameters.

```html
<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2.3.1/dist/loader.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2.3.1/dist/inject.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2.3.1/dist/cookies.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2.3.1/dist/maintenance.min.js"></script>
```

Or the combined bundle: `all.min.js`. Prefer exact version pins in production (see [loader.md](./loader.md#version-pinning)).

Without the loader, `inject` / `cookies` still attach APIs and warn; `maintenance` skips registration. npm peer: install `@stagepass/loader` with `@stagepass/modules`.

## Injector

`sp.inject(…)` resolves local vs production URLs, keeps classic script order (`async=false`, `defer` when neither was set), and supports `integrity`, `crossorigin`, `nonce`, and optional `allowedHosts`.

```javascript
await sp.inject({
  src: 'https://cdn.example.com/lib.js',
  stagepass: true,
  localPath: 'lib.js',
  position: 'head',
  version: '2.1.0',
});
```

## Cookies

`sp.cookies` (alias `sp.cookie`): `bake`, `eat`, `throw`, `has`, `list`, `jar`, `crumbs`, `throwAll`, and `on('bake'|'throw', fn)` (unsubscribe return). Optional `sp.consent` hook is tooling only, not legal compliance.

## Maintenance

Opt-in overlay via `data-stagepass-maintenance="true"` or `sp.maintenance.enable(…)`. Not access protection; does not inject `noindex`. Developers with an active session see the real page plus a badge.

## Declared modules in projects

`stagepass.json` lists which modules the live site loads (`[]`, named list, or `["all"]`). `stagepass new` / `upgrade` / `doctor` use that list for types and the generated `AGENTS.md` block. See [cli.md](./cli.md).
