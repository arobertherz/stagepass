# Troubleshooting

## Local assets do not load

1. Confirm a session is active (`?stagepass=your-project.sp`) and the domain matches the linked project.
2. Run `stagepass doctor` (read-only; never uses sudo).
3. Check CORS: add the live host with `stagepass link --origin your-site.webflow.io`.
4. In Chrome, allow local network access when prompted (Private Network Access / LNA). The flag card mentions this when the local server is unreachable.
5. Confirm files exist under the linked project root at the `data-stagepass-path` (or the filename extracted from the production URL).

## Caddy / TLS

* `stagepass certs check` then `stagepass certs trust` if the local CA is not trusted.
* `stagepass certs renew` repairs failing site certificates.
* Port 443 conflicts: `stagepass start` can identify the process and offer to stop it (confirmation required).

## Live reload does nothing

* Run `stagepass dev` inside the **linked** project directory (not only `npm run watch`).
* Keep a swap session active (not `debug`). The loader opens `EventSource` to `https://<domain.sp>/__stagepass/live` after injecting local assets.
* If `stagepass dev` is not running, the live chunk closes after the first error and does not retry.
* See [dev.md](./dev.md).

## CDN still serves an old `@2` build

Purge the jsDelivr alias (exact pins are better for production):

```text
https://purge.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js
```

## Flag UI missing

The flag loads only with a session, from the loader’s folder (`flag.min.js`). Self-hosting: copy flag and live chunks next to the loader, or set `data-stagepass-flag-base`. CSP must allow that script origin.
