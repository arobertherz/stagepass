# `@stagepass/modules`

Modular runtime extensions for Stagepass.

This package provides optional browser modules that extend `@stagepass/loader`.

## Install

```bash
npm install @stagepass/loader @stagepass/modules
```

`@stagepass/loader` must be loaded first.  
`@stagepass/modules` declares `@stagepass/loader` as a peer dependency.

## CDN Usage

```html
<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@1/dist/loader.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@1/dist/inject.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@1/dist/cookies.min.js"></script>
```

Or load all modules:

```html
<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@1/dist/loader.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@1/dist/all.min.js"></script>
```

## Available Modules

### Injector (`inject.min.js`)

Runtime asset injection via `sp.inject(...)`.

Highlights:
- single, array, or batch input
- script/style auto-detection
- local swap support via loader vars
- optional production cache busting (`cacheBust: true`)

### Cookies (`cookies.min.js`)

Cookie utility helpers via `sp.cookies.*`:

- `sp.cookies.bake(name, value, options?)`
- `sp.cookies.eat(name, options?)`
- `sp.cookies.throw(name, options?)`
- `sp.cookies.has(name)`
- `sp.cookies.list(options?)`

This is utility-only and does not implement consent management.

## Runtime Globals

Preferred global is `sp` (aliases: `stagepass`, `window.stagepass`).

## Repository

- Full docs and examples: [stagepass repository](https://github.com/arobertherz/stagepass)
