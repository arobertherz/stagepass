# PHP on Stagepass

Live page: [https://stagepass.one/docs/php/](https://stagepass.one/docs/php/)

This file is the source outline for that site page. It describes published `@stagepass/cli` 2.4.0 (tarball sha256 `d569578e3e5ba2df5352caf085fd808136af68f40a7e4f9fd9cd824a45f6ba34`, commit `9886c4a`) and the unreleased 2.4.1 security patch in this repository. 2.4.1 is not published. `@stagepass/loader` types referenced here are 2.5.0.

## 1. What this is

- Optional PHP starter for a Stagepass project
- Plain PHP 8.2 or newer, no framework, no Composer
- One public entry (`api/action.php`), actions reached by name
- No mail in this starter, by design

## 2. When to use it

- A Webflow or Stagepass front end needs a small server endpoint (form, signup, webhook-style POST)
- You want local requests on `https://your-project.sp/api/action.php` and the same path on the PHP host
- When not to use it: heavy apps, queues, or anything that needs a framework

## 3. How a request is routed

- Browser or `fetch` calls `/api/action.php` with an `action` name (query or JSON body)
- `action.php` loads config, applies CORS, origin checks, rate limit, and honeypot
- The name is looked up in `api/actions.php` (allowlist only)
- The matching file in `api/actions/` returns a callable and a JSON payload
- User input is never used as a file path or a function name

## 4. What you edit, and what you leave alone

- Edit: `api/actions.php`, `api/actions/*.php`, the project-root `.env`, optional `.php/config.php`
- Leave alone: `api/action.php`, `api/lib/*`
- Short in-file comments mark the same split; this page is the long version

## 5. Configuration and secrets

- Copy `api/.env.example` to the project root as `.env` (the folder that contains `api/`). `load_config()` also reads `.php/.env`. Real environment variables already set on the host are left as they are.
- The secrets file is that project-root `.env`, or `.php/.env`. It is not a file named `api/.env`.
- `stagepass build` copies `api/` to `dist/api/` and `.php/config.php` to `dist/.php/config.php`. It never copies `.env` or `.php/.env` into `dist/`. Since 2.4.1 it also copies a project-root `.htaccess` to `dist/.htaccess` when the project has one. A `dist/.htaccess` already on disk stays when the project has none.
- `ALLOWED_ORIGINS`: exact origins, scheme included, no trailing slash (`.sp` domain, Webflow preview, live site)
- `APP_ENV=local` vs `production` (the `boom` test action is local only)
- Honeypot field name, rate limit max/window, body size cap, timezone
- Optional `.php/config.php` overrides `.env`
- Keep `.env` out of git

## 6. Document root

- Caddy v3 (`src/lib/caddyfile.js`) sets `root *` to the project path, then `php_fastcgi 127.0.0.1:9000` and `file_server`. The public URL is `/api/action.php`.
- Upload document root is `dist/` after `stagepass build`: the folder that contains `api/` and `.php/config.php`. The URL stays `/api/action.php`. On Apache and nginx that upload is the public web root.
- From that same folder, the matching built-in server command is `php -S 127.0.0.1:8080 -t .` (URL `/api/action.php`).
- `php -S 127.0.0.1:8080 -t api` serves `/action.php`. That command does not match this layout.
- The published npm 2.4.0 package README already uses `-t .`.
- PHP's built-in server does not apply Caddy's hidden-path 404. The package README has carried that warning since 2.4.1. Published CLI 2.4.0 does not. Prefer `stagepass dev` or the linked `.sp` domain. Do not point `php -S -t .` at a folder that already contains a real `.env`.

## 7. Hosting hidden files

- After `stagepass build`, upload `dist/`. That folder is the web root. It contains `api/` and `.php/config.php`. `.php/` is therefore public on Apache and nginx unless hidden paths are denied.
- Since 2.4.1 the starter comments state that the document root is the folder that contains `api/`. Published CLI 2.4.0 still says the config sits "outside the public root" and "outside the public api/ directory". Those phrases describe the layout relative to `api/`, not a second directory outside the web root. [quYArF43](https://trello.com/c/quYArF43).
- Caddy already returns 404 for any path segment that starts with `.` (`/.env`, `/.php/`, `/api/.env`).
- Published CLI 2.4.0 does not ship an Apache or nginx deny rule. Add one on that host. Since 2.4.1 the PHP scaffold ships the Apache `.htaccess` below. nginx still needs the snippet on the host (nginx does not read `.htaccess`).
- Prefer real environment variables so a `.env` file is not required in the web root. `load_config()` reads the project-root `.env` and `.php/.env`. It never reads `api/.env`. `stagepass build` does not copy those files into `dist/`. It does copy `.php/config.php`.
- Since 2.4.1, `stagepass new --php` writes a web-root `.htaccess` and `stagepass build` copies it into `dist/` when the project has one. `stagepass upgrade` writes that same file when `"php": true` and the project root has none. It does not overwrite an existing `.htaccess`. Published CLI 2.4.0 does not ship that file. `stagepass new` does not overwrite an existing `.htaccess`. `stagepass build` still keeps a `.htaccess` you add yourself.

Apache, in the web root `.htaccess`. The host needs `AllowOverride All` and `mod_rewrite`. The rule follows HTML5 Boilerplate [`file_access.conf`](https://github.com/h5bp/server-configs-apache/blob/main/h5bp/security/file_access.conf), wrapped in `IfModule`:

```apache
<IfModule mod_rewrite.c>
    RewriteEngine On
    RewriteCond %{REQUEST_URI} "!(^|/)\.well-known/([^./]+./?)+$" [NC]
    RewriteCond %{SCRIPT_FILENAME} -d [OR]
    RewriteCond %{SCRIPT_FILENAME} -f
    RewriteRule "(^|/)\." - [F]
</IfModule>
```

nginx, inside the server block, before the PHP `location ~ \.php$` block. If this location comes later, `/.php/config.php` can be passed to php-fpm. The rule follows HTML5 Boilerplate [`security_file_access.conf`](https://github.com/h5bp/server-configs-nginx/blob/main/h5bp/location/security_file_access.conf):

```nginx
location ~* /\.(?!well-known\/) {
    deny all;
}
```

Both rules were tested on 12 November 2026 on php:8.2-apache (`AllowOverride All`, `a2enmod rewrite`) and on nginx 1.27 with php:8.2-fpm. The results were the same on both servers:

- `/.env`, `/.php/config.php`, `/api/.env.example`, `/.git/HEAD`: HTTP 403, no secret or config leak
- `/api/action.php?action=ping`: HTTP 200, `{"status":"success","data":{"pong":true},"message":null}`
- `/.well-known/test.txt`: HTTP 200, body `well-known-ok`
- `/.well-known/` as a directory with no index file: HTTP 403 on both servers (no DirectoryIndex). Visible files under `/.well-known/` stay reachable.

## 8. Adding an action

- Create `api/actions/your-name.php` that returns a callable
- Register the name, file, methods, honeypot, rate limit, and origin rule in `api/actions.php`
- Read fields with `input_string()`, validate with the shared helpers
- Call it from JavaScript with `action: 'your-name'`
- Do not add a second public PHP endpoint without a strong reason
- Worked example: a newsletter-style POST (validation, allowlist entry, `fetch` snippet)

## 9. Calling it from JavaScript

- `sp.resolveLocalUrl` (`@stagepass/loader` 2.5.0 `global.d.ts`) returns a local HTTPS URL only during an active `.sp` session, otherwise `''`.
- On a Webflow page, `window.location.origin` is the Webflow host. Webflow does not run PHP, so a fetch to that origin does not reach this API.
- There is no built-in helper for the public PHP base URL. `origin` and `production` in `stagepass.json` are Webflow hosts.
- The production fallback is the absolute URL of the PHP host, for example `https://php.example.com/api/action.php`.
- A relative `/api/action.php` only works when the page is already served from that PHP host.
- POST JSON with `Content-Type: application/json` and an empty honeypot field, hidden in CSS
- GET example: `ping`
- CORS: the browser sends `Origin`; that value must be on `ALLOWED_ORIGINS`
- Published loader 2.5.0 augments `Window` with `sp` and `stagepass` (both `StagepassAPI`, including `resolveLocalUrl`, `vars`, and `log`) and declares global `var sp` / `var stagepass`. `stagepass new` / `upgrade` write `compilerOptions.types` including `@stagepass/loader`. The scaffold `main.ts` still uses a narrow manual cast for `sp.log`. The official types are wider. No code change.

```js
const path = '/api/action.php';
const phpHost = 'https://php.example.com';
const local = sp.vars.isLocal && sp.resolveLocalUrl(path);
const url = local || phpHost + path;
```

## 10. Native Webflow forms

- `contact.php` is a JSON or form POST action. It validates and does not send mail.
- There is no shipped pattern that takes over a native Webflow form (no `preventDefault` helper, no module).
- A submit listener that calls `preventDefault` and `fetch`es the PHP host is enough. Forms are site-specific, PHP is optional, and modules are front-end only, so a helper in `@stagepass/modules` is not clearly justified yet.

```js
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const url =
    (sp.vars.isLocal && sp.resolveLocalUrl('/api/action.php')) ||
    'https://php.example.com/api/action.php';
  const result = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'contact',
      name: form.elements.name.value,
      email: form.elements.email.value,
      message: form.elements.message.value,
      website: '',
    }),
  }).then((response) => response.json());
});
```

## 11. Validation and errors

- `ValidationException` becomes `status: "fail"` with HTTP 422 and per-field messages in `data`
- Any other uncaught exception becomes `status: "error"` with HTTP 500
- The 500 body is generic; the real message is only logged on the server
- Other `fail` cases: unknown action (404), wrong method (405), disallowed origin (403), too many requests (429)

## 12. Response shape

- Every response is JSON: `status`, `data`, `message`, plus a matching HTTP status code
- `success` (200): handler return value in `data`
- `fail`: rejected request, details in `data`
- `error`: unexpected server failure, no internal details
- How to branch on `result.status` in the browser

## 13. Security defaults

- Origin allowlist; unknown origins are never reflected in CORS headers
- POST actions require a matching `Origin`; GET may omit it, but a present `Origin` still has to match
- Honeypot: a filled field returns a generic success and does not run the handler
- File-based rate limit per IP and action under `.php/rate-limit/`. A limit hit is HTTP 429, JSend `fail`, and `Retry-After` set to the window.
- If the rate-limit directory cannot be created, a file cannot be opened, `flock` fails, or the limiter throws, the failure is logged with `error_log`, including a failed `flock`. `APP_ENV=production` refuses the request: HTTP 503, JSend `error`, a short message, `Retry-After: 60`, no internals. Unset `APP_ENV` is production. `local`, `development`, and any other value allow the request and write the same log line.
- `client_ip()` uses `REMOTE_ADDR` unless that address is in `TRUSTED_PROXIES` (comma-separated IPv4 or IPv6 addresses and CIDRs). Only then is `TRUSTED_PROXY_HEADER` read: `x-forwarded-for` (default) or `forwarded` (RFC 7239 `for=`). Hops are walked from right to left. Trusted proxy addresses are skipped. The first other address is the client. If every hop is trusted, the leftmost is used. An invalid hop falls back to `REMOTE_ADDR` and is logged once without the raw header. Invalid allowlist entries are ignored and logged.
- This behaviour ships in projects created with the next CLI release. `stagepass upgrade` does not change `api/` or `.php/config.php`. Copy `api/lib/security.php`, `api/lib/request.php`, `api/lib/config.php`, `.php/config.php`, and `api/action.php` from a new scaffold, or re-scaffold. [sgt7wKlT](https://trello.com/c/sgt7wKlT).
- Display of errors is off; exception messages never go to the client

## 14. Existing projects

`stagepass upgrade` does not add the PHP `api/` or `.php/` boilerplate. Since 2.4.1, when `stagepass.json` has `"php": true` and the project root has no `.htaccess`, upgrade writes the shipped template (same bytes as `stagepass new --php`). An existing `.htaccess` is not overwritten. If it has no `RewriteRule "(^|/)\." - [F]` line, upgrade prints a hint and points at this page and `api/README.md`. It does not fail. A symlink or directory named `.htaccess` is left in place. Projects without `"php": true` are unchanged. Published CLI 2.4.0 does not write `.htaccess`.

- Scaffold a throwaway project with `stagepass new tmp --php --yes --no-link` and copy `api/` and `.php/` into the existing project. Do not overwrite files you already edited, including an existing `.htaccess`.
- Or copy from the installed CLI templates, renaming `api/env.example` to `api/.env.example` and `php-private/config.php` to `.php/config.php` (npm pack drops dot paths). The `htaccess` template ships since 2.4.1; `stagepass upgrade` writes it when the file is missing. Published CLI 2.4.0 has no `htaccess` template.
- Set `"php": true` in `stagepass.json`, copy `api/.env.example` to `.env`, set `ALLOWED_ORIGINS`, and run `stagepass link` again so the Caddy block gets `php_fastcgi`.
- If `scripts/build.mjs` is still an unmodified older scaffold, `stagepass upgrade` can replace it so `publishPhp` is included. An edited script stays as-is and needs the PHP copy logic added by hand.

## 15. Local development

- Prefer `stagepass dev` or the linked `.sp` domain (`https://your-project.sp/api/action.php`, Caddy `php_fastcgi`)
- Quick check from the folder that contains `api/`: `php -S 127.0.0.1:8080 -t .`
- `stagepass new`, `doctor`, `dev`, and `watch` warn when PHP is missing, older than 8.2, or has no `php-fpm` or `php-cgi`. On macOS the hint is `brew install php`. The JavaScript build still runs.
- On a `"php": true` project, `dev` and `watch` start Homebrew php-fpm (`brew services start php`, and `brew services restart php` only if start fails)
- Watch does not copy PHP. FastCGI reads the project root, so edits show up on the next request.
- PHP 8.2 or newer

## 16. Limits of this starter

- No mail, no database layer, no framework
- Actions stay small; put shared checks in `api/lib/validate.php` only when several actions need them
- This is a front-controller pattern, not a general-purpose CMS backend
