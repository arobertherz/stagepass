# Troubleshooting

## Local assets do not load

1. Confirm a session is active (`?stagepass=your-project.sp`) and the domain matches the linked project.
2. Run `stagepass doctor` (read-only; never uses sudo). It also flags unpinned CDN URLs and mismatches between declared modules and the live site.
3. Check CORS: add the live host with `stagepass link --origin your-site.webflow.io` (or set `--staging` / `--production` when scaffolding so `link` picks them up from `stagepass.json`). Caddy CORS headers alone do not grant Chrome’s Local Network Access **permission** (see below).
4. On a public `https://` page (for example a Webflow staging site) that fetches `https://<project>.sp/…`, allow **Local network** / **Loopback network** for that origin when Chrome prompts, or re-enable them in Site settings if previously denied. See [Public origin to .sp (ERR_FAILED)](#public-origin-to-sp-err_failed). The flag card may mention local network access when the local server is unreachable.
5. Confirm the Stagepass local CA is trusted and site certs are valid (`stagepass certs check`, then `certs trust` / `certs renew` as needed — see [Caddy / TLS](#caddy--tls)). An untrusted CA is a separate failure from Local Network Access denial.
6. Confirm files exist under the linked project root at the `data-stagepass-path` (or the filename extracted from the production URL).
7. With an active session or debug mode, the loader warns when two tagged assets resolve to the same local filename without unique `data-stagepass-path` values.

## Public origin to .sp (ERR_FAILED)

`net::ERR_FAILED` when a public page loads assets from a Stagepass `.sp` domain is **not** a single cause. Treat Local Network Access permission denial and an untrusted local CA separately.

### A. Local Network Access permission denied

When a **public** `https://` page (for example a Webflow staging site) fetches `https://<project>.sp/…` and that host resolves to `127.0.0.1`:

* **Console:** `Access to fetch at 'https://<project>.sp/...' from origin 'https://…' has been blocked by CORS policy: Permission was denied for this request to access the \`unknown\` address space.` plus `Failed to load resource: net::ERR_FAILED`.
* Chrome may report the destination address space as `unknown` for a custom TLD such as `.sp` even though the name resolves to loopback. Treat that as Local Network Access permission denial, not as a separate category.
* This is a **browser permission**, not a missing Caddy CORS header. Stagepass already returns CORS and Private Network Access preflight headers for allowlisted origins; those headers do not grant the Chrome LNA user permission ([Local Network Access guide](https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access)).
* Chrome 142+ shows a Local Network Access permission prompt for public → local/loopback requests ([Chrome blog, update 2025-09-29](https://developer.chrome.com/blog/local-network-access)).
* Granular Site settings (Ask / Allow / Block): **Local network** (`local-network`: public origin → local address space) and **Loopback network** (`loopback-network`: public or local origin → loopback / `127.0.0.0/8`, `::1`, `localhost`). Official remediation if denied: re-enable Local Network or Loopback access in browser Site settings ([LNA guide](https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access)).
* How to open Site settings ([Chrome Help](https://support.google.com/chrome/answer/114662)):
  * For a specific site: go to the site → to the left of the web address, select **View site information** → **Site settings** → change a permission setting.
  * For all sites: More → Settings → Privacy and security → Site settings → select the setting you want to update.
* Accept the permission prompt when it appears, or set **Local network** / **Loopback network** to **Allow** for that public origin, then reload.
* Opening the `.sp` site itself (same origin as the local files) does not need this public→loopback permission.

### B. Untrusted Stagepass local CA

* **Symptom:** `net::ERR_CERT_AUTHORITY_INVALID` (or the browser’s certificate interstitial) when opening `https://<project>.sp`.
* This is **not** the same as A. A context that ignores certificate errors can still hit A (LNA denied) with no certificate errors.
* Use the existing Stagepass certs workflow under [Caddy / TLS](#caddy--tls): `stagepass certs check`, then `stagepass certs trust` if the local CA is not trusted; `stagepass certs renew` for failing site certificates. Interactive `stagepass start` can offer `certs trust`.

## Caddy / TLS

* `stagepass certs check` then `stagepass certs trust` if the local CA is not trusted.
* `stagepass certs renew` repairs failing site certificates. Use `--root` only when you intend to move the local CA folder to a timestamped backup (double confirmation, or `--yes --i-understand-root-renewal`). `--remove-orphans` deletes orphaned keychain roots by SHA-1 after confirmation.
* Port 443 conflicts: `stagepass start` can identify the process (name and PID) and offer to stop it (SIGTERM first; SIGKILL only after a second confirmation).
* When the login LaunchAgent is installed, `start` uses `launchctl kickstart` and `stop` uses `launchctl bootout` (stopped until next login; `autostart off` removes it permanently).

## PHP

* Projects with `"php": true` in `stagepass.json` get `php_fastcgi` on link. `"php": false` omits it. Existing linked projects without a `php` setting keep PHP on.
* `stagepass doctor` runs a project-level PHP check when `php` is set. `stagepass daemon` ensures PHP-FPM without sudo.

## Live reload does nothing

* Automatic CSS swap / JS reload needs a loader that ships `live.min.js` (published in **2.4.0**; pin `@2.4.0`) **and** an active `?stagepass=<project>.sp` swap session. Published **2.3.3** (current npm `latest`) does **not** include `live.min.js`. A jsDelivr `@2` embed is currently observed serving that publish (`/dist/live.min.js` 404s); the major-range alias is not the same as the `latest` dist-tag and can change when the CDN refreshes. See [dev.md](./dev.md) and [loader.md](./loader.md#dev-chunks).
* `stagepass dev` is not in published `@stagepass/cli@2.2.6`. Use a preview or repository CLI build inside the **linked** project directory (not only `npm run watch`).
* Keep a swap session active (not `debug`). The loader opens `EventSource` to `https://<domain.sp>/__stagepass/live` after injecting local assets.
* If `stagepass dev` is not running, the live chunk closes after the first error and does not retry.
* Public-origin sessions still need Local Network / Loopback permission and a trusted Stagepass CA (see [Public origin to .sp (ERR_FAILED)](#public-origin-to-sp-err_failed)).
* See [dev.md](./dev.md).

## CDN still serves an old `@2` build

Prefer an exact pin in production. To refresh the major alias after a release, purge:

```text
https://purge.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js
```

Use the same pattern for modules. Exact pins are unaffected the same way.

## Flag UI missing

The flag loads only with a session, from the loader’s folder (`flag.min.js`). Self-hosting: copy flag and live chunks next to the loader, or set `data-stagepass-flag-base`. CSP must allow that script origin. Details: [loader.md](./loader.md#dev-flag).
