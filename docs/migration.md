# Migration

Breaking changes from Stagepass 1.x to 2.x are documented in the repository root guide:

**[MIGRATION.md](../MIGRATION.md)**

That file covers CORS defaults, Webflow wildcards, session storage shape, removed globals (`splog` / `spwarn` / `sperror`), console mute opt-in, cache-busting, and CDN pin guidance.

Within 2.x, opt-in zero-cost markup (`data-stagepass-live-src`) and the steps to migrate from `data-src` / `data-href` are in [loader.md](./loader.md#zero-cost-production-mode). Legacy swap still strips `integrity` on local rewrites so production hashes do not fight local files.

For day-to-day 2.x usage see [getting-started.md](./getting-started.md) and [loader.md](./loader.md).
