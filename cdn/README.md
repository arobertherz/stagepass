# Stagepass CDN

Worker plus static assets for the published `dist/` files of `@stagepass/loader` and `@stagepass/modules`.

| Host | Worker name | Wrangler env | Deployed by |
| --- | --- | --- | --- |
| `https://staging-cdn.stagepass.one` | `stagepass-cdn-staging` | `staging` | schedule, push of `cdn/**` to `master`, or manual dispatch |
| `https://cdn.stagepass.one` | `stagepass-cdn` | `production` | manual dispatch only, after a staging verify and the `cdn-production` environment approval |

`stagepass-cdn-staging` already exists (the probe). A staging deploy replaces that worker in place. `stagepass-cdn` is configured here and is not deployed by this repository until the production checklist below is done. The CLI keeps jsDelivr as the snippet default. This tree does not change `packages/`.

## URL shape

```text
/loader@<exact-version>/<file>
/modules@<exact-version>/<file>
/manifest.json
/
```

`<file>` is the path under that package version's `dist/` (`loader.min.js`, `cookies.min.js`, `vendor/file.js`). `<exact-version>` is semver, and prereleases are allowed (`2.3.0-beta.1`). Both of these are the same object and both answer 200:

```text
/loader@2.5.0/loader.min.js
/loader%402.5.0/loader.min.js
```

`%40` is accepted in any hex case. Encoded slashes (`%2F`, `%2f`), encoded backslashes, encoded dots, `..`, empty segments, and NUL are 404.

`@latest`, `@2`, and `@2.5` are 404. The body names the rule: exact versions only. v1 has no floating alias because a versioned URL is immutable and safe to pin with SRI. An alias would be a mutable pointer. Publishing it would depend on a cache purge, and a purge is not a reliable switch on this zone (see below). A later version can add an alias as a short-cached 302 to the exact file. The bytes on the exact URL would not change.

`/` is a one-line `text/plain` description. `/manifest.json` is the build manifest: package, version, npm tarball integrity, and each file's path, byte length, and sha256.

## Why the worker runs first

Workers static assets, with no worker in front, canonicalize the request path. Each segment is compared with `encodeURIComponent` of the decoded segment. `@` is left as-is by the URL parser and becomes `%40` after `encodeURIComponent`, so the two strings differ. The asset server then answers 307 to `/loader%402.5.0/loader.min.js`. The `%40` form matches and answers 200.

That redirect is the asset server, not the zone URL normalization. Zone normalization rewrites the URL. It does not emit a redirect, and `@` is a reserved character it does not encode or decode.

Measured with wrangler 4.165.0 in Docker (`node:22`) on 2026-11-20, using assets built from the published npm tarballs. With the worker bypassed (no `main`, `run_worker_first` omitted), `GET /loader@2.5.0/loader.min.js` returned `307 Temporary Redirect`, `Location: /loader%402.5.0/loader.min.js`, and an empty body. The same 307 happened with `html_handling` set to `none`. `GET /loader%402.5.0/loader.min.js` returned 200 and 15065 bytes. With `wrangler dev --env staging`, both URLs returned 200, no `Location`, the header set below, and sha256 `ac5ff425e4010147752a45b18fad8d6cb2b981cb17019d9edd414712bb1fa43c`, matching `manifest.json` for `loader@2.5.0/loader.min.js`. The worker kept the incoming `%40` path and fetched the encoded asset path once.

`assets.run_worker_first` is true, so every request hits `cdn/src/worker.js` before the asset server. The worker accepts either spelling, calls `env.ASSETS.fetch` with the `%40` path (the form the asset server serves without a redirect), and if that response is still a 3xx, follows the `Location` once internally. A second redirect, or a `Location` that is not the same file, becomes 502. The client never receives a 3xx.

`html_handling` and `not_found_handling` are `none`, so the asset server does not add trailing-slash or `index.html` redirects on top of the encoding redirect. There is no `_headers` and no `_redirects` file. The worker builds the response headers itself.

`run_worker_first` means each request is a Worker invocation. On the Workers Free plan that counts toward 100,000 requests per day. A static-asset hit that does not invoke the worker would not. The worker has to run first to own the headers and to swallow the 307. Past the free cap, Cloudflare answers 429 for those invocations instead of falling back to the asset.

## Headers

Successful versioned files:

```text
access-control-allow-origin: *
cross-origin-resource-policy: cross-origin
content-type: text/javascript; charset=utf-8
x-content-type-options: nosniff
timing-allow-origin: *
cache-control: public, max-age=31536000, immutable
```

`ETag`, `Content-Length`, and `Last-Modified` are copied from the asset response when present. Nothing else is. `.js` and `.mjs` are `text/javascript; charset=utf-8`. `.json` and `.map` are `application/json; charset=utf-8`. `.d.ts` and other text are `text/plain; charset=utf-8`. Unknown bytes are `application/octet-stream`.

The worker does not set `Content-Security-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Embedder-Policy`, `X-Frame-Options`, `Permissions-Policy`, or `Referrer-Policy`.

`/` and `/manifest.json` use `cache-control: public, max-age=60`. `/manifest.json` is `application/json; charset=utf-8`.

404 and 405 use the same `public, max-age=60`, plus CORS. 405 also sets `Allow: GET, HEAD, OPTIONS`. OPTIONS is 204 with `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, HEAD, OPTIONS`, and `Access-Control-Allow-Headers: *`.

`max-age=60` is the negative cache, not `no-store`. A shared cache can collapse a burst of typos and alias probes, and a version that 404s in the minute before it is uploaded does not stay missing. `no-store` would not be safer if the edge ignores `Cache-Control` on Worker responses. The 60 second value is the one we want caches to honor.

Versioned files stay `immutable` for a year. The URL is the version. A published file is replaced by publishing a new version, which is a new URL. SRI over that URL stays valid. A cache purge is not part of the publish path.

`If-None-Match` is forwarded to the asset binding. A 304 from the asset server is returned as 304 with the same header set and an empty body.

## Zone security headers

A response from `staging-cdn.stagepass.one` on 20 Nov 2026 carried the main website's security headers in addition to the asset `Cache-Control` and `Access-Control-Allow-Origin`:

- `content-security-policy` with `default-src 'self'`
- `cross-origin-opener-policy: same-origin`
- `x-frame-options: DENY`
- `permissions-policy`
- `referrer-policy: strict-origin-when-cross-origin`
- `x-content-type-options: nosniff`

There was no `Cross-Origin-Resource-Policy` and no `Cross-Origin-Embedder-Policy` in that capture. The site origin is netcup/Apache (see the stagepass.one site repo). These headers are added at the zone, most likely a Response Header Transform Rule. The Worker does not emit them. `cdn/scripts/verify-live.mjs` reports them as warnings. It does not fail the run, because a zone rule can add them after the worker returns. Exclude `staging-cdn.stagepass.one` and `cdn.stagepass.one` from that rule if script responses should not carry the website policy. The worker's `Cross-Origin-Resource-Policy: cross-origin` is what a COEP page needs in order to read the script. Confirm a live response still has it after the rule runs. CSP on a script response does not replace the embedding page's CSP.

## Cache and purge

On the probe, a zone cache purge for the host returned success and the next request was still `cf-cache-status: HIT`. Do not treat a host purge as proof that clients will see a new body.

The probe's 307 for the `@` URL was itself cached with `cache-control: public, max-age=31536000, immutable`. After this worker is deployed, a client can still receive that cached 307 until that cache key expires or is purged by the exact URL. The `@` URL and the `%40` URL are different cache keys. `verify-live` uses `redirect: 'manual'` and fails if either form is a 3xx. If it reports a 307 after a deploy that otherwise succeeded, purge those exact URLs. A host-level purge that leaves `HIT` did not do it.

Once this worker's 200 is cached, the bytes at that exact version stay. Shipping a corrected file means a new version, not a rewrite of the old URL.

## What gets built

`cdn/versions.config.json` sets the floor (`2.0.0` for loader and modules) and an exclude list. `cdn/scripts/build-assets.mjs` (Node 22, no dependencies):

1. `npm view <pkg> versions --json`
2. Keep exact versions whose semver precedence is greater than or equal to the floor. Prereleases that sort after the floor are included (`2.3.0-beta.1` with floor `2.0.0`). A prerelease of the floor itself is not (`2.0.0-beta.1` precedes `2.0.0`). Excluded versions are dropped.
3. For each version, `npm view <pkg>@<ver> dist.integrity dist.tarball --json`, then `npm pack`.
4. The tarball's sha512 SRI must equal `dist.integrity`. A mismatch fails the build.
5. Extract only `package/dist/**` into `<out>/<name>@<version>/`. A missing `dist/` fails the build. Tar members that escape that directory fail the build.
6. Write `<out>/manifest.json` (sorted, no timestamp).
7. Refuse the result if it exceeds the Workers Free static asset limits: 20,000 files per version, 25 MiB per file (Cloudflare Workers limits, checked 2026-11-20). Paid allows 100,000 files and the same 25 MiB file cap. This config targets Free, so the check uses 20,000.

The output directory is deleted at the start of every build. The default is `cdn/dist/`, which is gitignored, along with `.wrangler/`.

## Releases

npm versions become public when a maintainer approves the stage (`npm stage approve`), not when the git tag is pushed. `.github/workflows/cdn.yml` is how staging follows that:

- Every 30 minutes, compare the selected npm versions with `https://staging-cdn.stagepass.one/manifest.json`. Deploy staging only when at least one version is missing. If the manifest cannot be read, skip and print a notice. The run stays green.
- A push to `master` that touches `cdn/**` deploys staging even when the version set is unchanged (the worker or the build changed).
- `workflow_dispatch` with target `staging` deploys staging.
- `workflow_dispatch` with target `production` deploys staging, runs `verify-live` against staging, then waits for the `cdn-production` environment and deploys `cdn.stagepass.one`.

The workflow runs on the self-hosted runner `cerebro-stagepass` (`runs-on: [self-hosted, cerebro]`), same as the other workflows. Forks are skipped (`github.repository == 'stagepass-one/os'`). `permissions` is `contents: read`. One concurrency group covers the workflow so two deploys do not run at once. A production approval holds that lock.

If `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID` is missing, scheduled and push deploys print `::notice::` and skip. A manual dispatch fails. Production fails when either secret is missing. The logs do not print the secret values.

Wrangler is `npx --yes wrangler@4.165.0`. That version is `npm view wrangler version` from `node:22` on 2026-11-20. Change the pin only after a fresh `npm view`.

## Local checks (Docker)

Do not run `node`, `npm`, or `wrangler` on the host for this package. Mount the repo read-only and copy it into the container so `node_modules` and `.wrangler` stay off the worktree. Container names use the prefix `sp-cdn-`.

```bash
# Unit tests. Repeat with node:24.
docker run --rm --name sp-cdn-test-22 -v "$PWD":/src:ro node:22 \
  sh -c 'cp -a /src/. /work && node --test /work/cdn/test'

# Build into a throwaway directory and print the summary.
docker run --rm --name sp-cdn-build -v "$PWD":/src:ro node:22 \
  sh -c 'cp -a /src/. /work && node /work/cdn/scripts/build-assets.mjs /tmp/cdn-dist'

# Bundle check. No Cloudflare auth. dist/ must exist in the container copy.
docker run --rm --name sp-cdn-dry -v "$PWD":/src:ro node:22 \
  sh -c 'cp -a /src/. /work && node /work/cdn/scripts/build-assets.mjs /work/cdn/dist \
    && cd /work/cdn \
    && npx --yes wrangler@4.165.0 deploy --dry-run --env staging \
    && npx --yes wrangler@4.165.0 deploy --dry-run --env production'

# Local worker. From another shell: curl -sI http://127.0.0.1:8787/loader@2.5.0/loader.min.js
docker run --rm --name sp-cdn-dev -p 8787:8787 -v "$PWD":/src:ro node:22 \
  sh -c 'cp -a /src/. /work && node /work/cdn/scripts/build-assets.mjs /work/cdn/dist \
    && cd /work/cdn \
    && npx --yes wrangler@4.165.0 dev --env staging --ip 0.0.0.0 --port 8787 --local'
```

`node:22` in the examples is the Docker image, not a version pin of our code. The wrangler pin is `4.165.0`.

To see the asset server without the worker, point a temporary config at the same `dist/` with no `main` and with `run_worker_first` omitted, then `wrangler dev` that config. `GET /loader@2.5.0/loader.min.js` is the 307. `GET /loader%402.5.0/loader.min.js` is the 200. With the real worker, both are 200 and the body sha256 matches `manifest.json`.

## Manual staging deploy

This replaces the live `stagepass-cdn-staging` worker. It needs the two secrets in the environment. It is not a dry run.

```bash
docker run --rm --name sp-cdn-deploy \
  -e CLOUDFLARE_API_TOKEN -e CLOUDFLARE_ACCOUNT_ID \
  -v "$PWD":/src:ro node:22 \
  sh -c 'cp -a /src/. /work && node /work/cdn/scripts/build-assets.mjs /work/cdn/dist \
    && cd /work/cdn \
    && npx --yes wrangler@4.165.0 deploy --env staging \
    && node /work/cdn/scripts/verify-live.mjs https://staging-cdn.stagepass.one --all --local /work/cdn/dist/manifest.json'
```

`-e CLOUDFLARE_API_TOKEN` without a value forwards the host environment variable. Do not put the token in the command line or in `wrangler.jsonc`.

## Production rollout

Do this once, before the first production dispatch:

1. In the GitHub repo settings, create the environment `cdn-production` with required reviewers. The production job uses `environment: cdn-production` and will not deploy until that approval exists. Create the environment before the first production run so the job waits instead of deploying with no reviewer.
2. Set the repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. `account_id` is not in `wrangler.jsonc`.
3. Create the token from the "Edit Cloudflare Workers" template, scoped to this account and the `stagepass.one` zone. Custom domains also need the token to create the hostname on that zone. If the first deploy cannot attach the domain, add Zone DNS Edit for `stagepass.one` only.
4. DNS. `staging-cdn.stagepass.one` is already a custom domain on `stagepass-cdn-staging`. The first production deploy attaches `cdn.stagepass.one` to `stagepass-cdn`. Both names must be on the Cloudflare zone. Remove a conflicting A or CNAME that is not the worker custom domain. The website origin behind the zone is netcup/Apache. The worker is not that origin.
5. Decide whether the zone header transform should skip these two hostnames. `verify-live` warns and continues when it sees CSP, COOP, or `X-Frame-Options`.
6. Run the CDN workflow with `workflow_dispatch` and target `production`. It deploys and verifies staging first. Approve `cdn-production`. It then deploys `stagepass-cdn` and runs `verify-live` against `https://cdn.stagepass.one`.
7. Leave the CLI on jsDelivr. An exact `cdn.stagepass.one` URL is opt-in for a site that wants this host.

`workers_dev` and `preview_urls` are false on the top-level config and on both environments, so a deploy does not publish a `workers.dev` hostname or a preview URL.

## Tests

`node --test cdn/test` covers routing (both spellings, hex case, traversal, aliases, bad package names, methods), the header builder, `handleRequest` with a fake `ASSETS` binding (including a binding that returns 307), and the build-script helpers (floor, prerelease filter, SRI). `.github/workflows/test.yml` runs that suite on Node 22 and 24 on the same runner as the other jobs. No extra npm dependencies.
