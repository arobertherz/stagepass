# `@stagepass/modules`

Modular runtime extensions for Stagepass.

This package provides optional browser modules that extend `@stagepass/loader`.

## Install

```bash
npm install @stagepass/loader @stagepass/modules
# beta
npm install @stagepass/loader@2.0.0-beta.1 @stagepass/modules@2.0.0-beta.1
```

`@stagepass/loader` must be loaded first.  
`@stagepass/modules` declares `@stagepass/loader` as a peer dependency.

## CDN Usage

### Stable 1.x

```html
<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@1.2.0/dist/loader.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@1.1.0/dist/inject.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@1.1.0/dist/cookies.min.js"></script>
```

### v2 beta

jsDelivr ranges like `@2` do **not** resolve prereleases — pin the exact version:

```html
<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2.0.0-beta.1/dist/loader.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2.0.0-beta.1/dist/inject.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2.0.0-beta.1/dist/cookies.min.js"></script>
```

Or load all modules:

```html
<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2.0.0-beta.1/dist/loader.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2.0.0-beta.1/dist/all.min.js"></script>
```

## Available Modules

### Injector (`inject.min.js`)

Runtime asset injection via `sp.inject(...)`.

Highlights:
- single, array, or batch input
- script/style auto-detection
- local swap support via loader vars
- scripts keep order (`async = false` unless opted in)
- production version busting via `version: '…'` (not per-view timestamps)

### Cookies (`cookies.min.js`)

Cookie utility helpers via `sp.cookies.*`:

- `sp.cookies.bake(name, value, options?)`
- `sp.cookies.eat(name, options?)`
- `sp.cookies.throw(name, options?)`
- `sp.cookies.has(name)`
- `sp.cookies.list()`

## Types

`global.d.ts` extends `@stagepass/loader` via declaration merging (`stagepass.inject`, `stagepass.cookies`).

## Repository

- Full docs and examples: [stagepass repository](https://github.com/arobertherz/stagepass)
- Migration: [MIGRATION.md](../../MIGRATION.md)
