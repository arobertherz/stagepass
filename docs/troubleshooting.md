# Troubleshooting

## Local assets do not load

1. Confirm a session is active (`?stagepass=your-project.sp`) and the domain matches the linked project.
2. Run `stagepass doctor` (read-only; never uses sudo). It also flags unpinned CDN URLs and mismatches between declared modules and the live site.
3. Check CORS: add the live host with `stagepass link --origin your-site.webflow.io` (or set `--staging` / `--production` when scaffolding so `link` picks them up from `stagepass.json`).
4. In Chrome, allow local network access when prompted (Private Network Access / LNA). The flag card mentions this when the local server is unreachable.
5. Confirm files exist under the linked project root at the `data-stagepass-path` (or the filename extracted from the production URL).
6. With an active session or debug mode, the loader warns when two tagged assets resolve to the same local filename without unique `data-stagepass-path` values.

## Caddy / TLS

* `stagepass certs check` then `stagepass certs trust` if the local CA is not trusted.
* `stagepass certs renew` repairs failing site certificates. Use `--root` only when you intend to move the local CA folder to a timestamped backup (double confirmation, or `--yes --i-understand-root-renewal`). `--remove-orphans` deletes orphaned keychain roots by SHA-1 after confirmation.
* Port 443 conflicts: `stagepass start` can identify the process (name and PID) and offer to stop it (SIGTERM first; SIGKILL only after a second confirmation).
* When the login LaunchAgent is installed, `start` uses `launchctl kickstart` and `stop` uses `launchctl bootout` (stopped until next login; `autostart off` removes it permanently).

## PHP

* Projects with `"php": true` in `stagepass.json` get `php_fastcgi` on link. `"php": false` omits it. Existing linked projects without a `php` setting keep PHP on.
* `stagepass doctor` runs a project-level PHP check when `php` is set. `stagepass daemon` ensures PHP-FPM without sudo.

## Live reload does nothing

* Run `stagepass dev` inside the **linked** project directory (not only `npm run watch`).
* Keep a swap session active (not `debug`). The loader opens `EventSource` to `https://<domain.sp>/__stagepass/live` after injecting local assets.
* If `stagepass dev` is not running, the live chunk closes after the first error and does not retry.
* See [dev.md](./dev.md).

## CDN still serves an old `@2` build

Prefer an exact pin in production. To refresh the major alias after a release, purge:

```text
https://purge.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js
```

Use the same pattern for modules. Exact pins are unaffected the same way.

## Flag UI missing

The flag loads only with a session, from the loader’s folder (`flag.min.js`). Self-hosting: copy flag and live chunks next to the loader, or set `data-stagepass-flag-base`. CSP must allow that script origin. Details: [loader.md](./loader.md#dev-flag).
