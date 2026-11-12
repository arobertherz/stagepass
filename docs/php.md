# PHP on Stagepass

Live page: [https://stagepass.one/docs/php/](https://stagepass.one/docs/php/)

This file is the source outline for that site page. Secrets belong only in `api/.env` and are never copied into `dist`.

## 1. What this is

- Optional PHP starter for a Stagepass project
- Plain PHP 8.2 or newer, no framework, no Composer
- One public entry (`api/action.php`), actions reached by name
- No mail in this starter, by design

## 2. When to use it

- A Webflow or Stagepass front end needs a small server endpoint (form, signup, webhook-style POST)
- You want local requests on `https://your-project.sp/api/action.php` and the same path on the live host
- When not to use it: heavy apps, queues, or anything that needs a framework

## 3. How a request is routed

- Browser or `fetch` calls `/api/action.php` with an `action` name (query or JSON body)
- `action.php` loads config, applies CORS, origin checks, rate limit, and honeypot
- The name is looked up in `api/actions.php` (allowlist only)
- The matching file in `api/actions/` returns a callable and a JSON payload
- User input is never used as a file path or a function name

## 4. What you edit, and what you leave alone

- Edit: `api/actions.php`, `api/actions/*.php`, `.env`, optional `.php/config.php`
- Leave alone: `api/action.php`, `api/lib/*`
- Short in-file comments mark the same split; this page is the long version

## 5. Configuration

- Copy `api/.env.example` to the project root as `.env`
- Secrets belong only in `api/.env` and are never copied into `dist`
- `ALLOWED_ORIGINS`: exact origins, scheme included, no trailing slash (`.sp` domain, Webflow preview, live site)
- `APP_ENV=local` vs `production` (the `boom` test action is local only)
- Honeypot field name, rate limit max/window, body size cap, timezone
- Optional `.php/config.php` overrides `.env`
- Keep `.env` out of git; Caddy already 404s hidden path segments; on shared hosting point the document root at `api/`

## 6. Adding an action

- Create `api/actions/your-name.php` that returns a callable
- Register the name, file, methods, honeypot, rate limit, and origin rule in `api/actions.php`
- Read fields with `input_string()`, validate with the shared helpers
- Call it from JavaScript with `action: 'your-name'`
- Do not add a second public PHP endpoint without a strong reason
- Worked example: a newsletter-style POST (validation, allowlist entry, `fetch` snippet)

## 7. Validation and errors

- `ValidationException` becomes `status: "fail"` with HTTP 422 and per-field messages in `data`
- Any other uncaught exception becomes `status: "error"` with HTTP 500
- The 500 body is generic; the real message is only logged on the server
- Other `fail` cases: unknown action (404), wrong method (405), disallowed origin (403), too many requests (429)

## 8. Response shape

- Every response is JSON: `status`, `data`, `message`, plus a matching HTTP status code
- `success` (200): handler return value in `data`
- `fail`: rejected request, details in `data`
- `error`: unexpected server failure, no internal details
- How to branch on `result.status` in the browser

## 9. Calling it from JavaScript

- Use `sp.resolveLocalUrl('/api/action.php')` when a local Stagepass session is active
- Fall back to the same path on the current origin (or the public host URL)
- POST JSON with `Content-Type: application/json` and an empty honeypot field, hidden in CSS
- GET example: `ping`
- CORS: the browser sends `Origin`; that value must be on `ALLOWED_ORIGINS`

## 10. Security defaults

- Origin allowlist; unknown origins are never reflected in CORS headers
- POST actions require a matching `Origin`; GET may omit it, but a present `Origin` still has to match
- Honeypot: a filled field returns a generic success and does not run the handler
- File-based rate limit per IP and action under `.php/rate-limit/`
- Display of errors is off; exception messages never go to the client

## 11. Local development and hosting

- `php -S 127.0.0.1:8080 -t api` for a quick check
- Linked Stagepass domain: `https://your-project.sp/api/action.php` (Caddy `php_fastcgi`)
- Live host: deploy the same `api/` path, or point the document root at `api/` on shared hosting
- PHP 8.2 or newer

## 12. Limits of this starter

- No mail, no database layer, no framework
- Actions stay small; put shared checks in `api/lib/validate.php` only when several actions need them
- This is a front-controller pattern, not a general-purpose CMS backend
