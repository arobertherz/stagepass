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
/loader@<major>/<file>
/modules@<major>/<file>
/loader@<major>.x/<file>
/modules@<major>.x/<file>
/manifest.json
/
```

`<file>` is the path under that package version's `dist/` (`loader.min.js`, `cookies.min.js`, `vendor/file.js`). `<exact-version>` is semver, and prereleases are allowed (`2.3.0-beta.1`). Both of these are the same object and both answer 200:

```text
/loader@2.5.0/loader.min.js
/loader%402.5.0/loader.min.js
```

`%40` is accepted in any hex case. Encoded slashes (`%2F`, `%2f`), encoded backslashes, encoded dots, `..`, empty segments, and NUL are 404.

`@1` and `@1.x` are the same major alias. The same rule applies to every major (`@2` and `@2.x` are the same pointer). Both the `@` and `%40` spellings are accepted. The worker reads `manifest.json` from the asset binding once per isolate and answers 302 to the highest stable version of that major in the manifest. A stable version has no prerelease. With the versions published when this was written, the targets are:

```text
/loader@1/loader.min.js   ->  /loader@1.2.0/loader.min.js
/modules@1/inject.min.js  ->  /modules@1.1.0/inject.min.js
/loader@2/loader.min.js   ->  /loader@2.5.0/loader.min.js
```

`Location` is an absolute path with a literal `@`. The body is empty. HEAD is the same response with an empty body. `Cache-Control` is `public, max-age=300`, together with `Access-Control-Allow-Origin: *`, `Cross-Origin-Resource-Policy: cross-origin`, `X-Content-Type-Options: nosniff`, and `Timing-Allow-Origin: *`.

A major with no stable version, or a file that is not listed on that resolved version, is 404 with `public, max-age=60`. `@9` is that case while no 9.x release is published. A major that contains only prereleases is also 404.

`@latest`, `@next`, `@2.5`, and any other range stay 404 with `public, max-age=60`. The body names the rule and points at an exact URL.

Exact version responses stay byte-identical and `immutable`. The alias does not change the bytes at an exact URL. Those URLs remain safe to pin with SRI.

`/` is a one-line `text/plain` description. `/manifest.json` is the build manifest: package, version, npm tarball integrity, and each file's path, byte length, and sha256.

## Why the worker runs first

Workers static assets, with no worker in front, canonicalize the request path. Each segment is compared with `encodeURIComponent` of the decoded segment. `@` is left as-is by the URL parser and becomes `%40` after `encodeURIComponent`, so the two strings differ. The asset server then answers 307 to `/loader%402.5.0/loader.min.js`. The `%40` form matches and answers 200.

That redirect is the asset server, not the zone URL normalization. Zone normalization rewrites the URL. It does not emit a redirect, and `@` is a reserved character it does not encode or decode.

Measured with wrangler 4.165.0 in Docker (`node:22`) on 2026-11-20, using assets built from the published npm tarballs. With the worker bypassed (no `main`, `run_worker_first` omitted), `GET /loader@2.5.0/loader.min.js` returned `307 Temporary Redirect`, `Location: /loader%402.5.0/loader.min.js`, and an empty body. The same 307 happened with `html_handling` set to `none`. `GET /loader%402.5.0/loader.min.js` returned 200 and 15065 bytes. With `wrangler dev --env staging`, both URLs returned 200, no `Location`, the header set below, and sha256 `ac5ff425e4010147752a45b18fad8d6cb2b981cb17019d9edd414712bb1fa43c`, matching `manifest.json` for `loader@2.5.0/loader.min.js`. The worker kept the incoming `%40` path and fetched the encoded asset path once.

`assets.run_worker_first` is true, so every request hits `cdn/src/worker.js` before the asset server. The worker accepts either spelling of an exact version, calls `env.ASSETS.fetch` with the `%40` path (the form the asset server serves without a redirect), and if that response is still a 3xx, follows the `Location` once internally. A second redirect, or a `Location` that is not the same file, becomes 502. An exact version request never receives a 3xx. A major alias is a separate 302 from the worker. It is not the asset server's encoding redirect.

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

A major alias is not immutable. `public, max-age=300` is the freshness window for the redirect. After a release, the alias points at the new version once the deploy that contains it is live. A cache may still serve the previous `Location` until those 300 seconds end. No purge is required for the alias to move. The exact URL of the new version does not wait on the alias cache.

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

`cdn/versions.config.json` names `@stagepass/loader` and `@stagepass/modules`. The version list comes only from the registry. There is no version floor. `exclude` is an emergency switch and stays empty. `cdn/scripts/build-assets.mjs` (Node 22, no dependencies):

1. `npm view <pkg> versions --json`
2. Keep every exact version, including 1.x and prereleases. Duplicate strings are dropped. A value that is not exact semver is dropped. Versions listed in `exclude` are dropped.
3. For each kept version, `npm view <pkg>@<ver> dist.integrity dist.tarball --json`, then `npm pack`.
4. The tarball's sha512 SRI must equal `dist.integrity`. A mismatch fails the build.
5. Extract only `package/dist/**` into `<out>/<name>@<version>/`. A missing `dist/` fails the build. Tar members that escape that directory fail the build. Published 1.x tarballs include `dist/` (`loader@1.0.0` has `dist/loader.js` and `dist/loader.min.js`; `modules@1.0.0` has `dist/all.min.js` and `dist/inject.min.js`).
6. Write `<out>/manifest.json` (sorted, no timestamp).
7. Refuse the result if it exceeds the Workers Free static asset limits: 20,000 files per version, 25 MiB per file (Cloudflare Workers limits, checked 2026-11-20). Paid allows 100,000 files and the same 25 MiB file cap. This config targets Free, so the check uses 20,000.

`exclude` lists exact versions that must not be copied. Leave it empty. `verify-live --registry` (the staging and production verify steps) runs `npm view <pkg> versions --json` and fails when the deployed manifest is missing any of those versions. A version listed in `exclude` is the only one that may be absent, and only because it was omitted on purpose. A non-empty exclude does not allow any other gap. Do not add a version there to hide a failed pack.

The output directory is deleted at the start of every build. The default is `cdn/dist/`, which is gitignored, along with `.wrangler/`.

## Releases

npm versions become public when a maintainer approves the stage (`npm stage approve`), not when the git tag is pushed. `.github/workflows/cdn.yml` is how staging follows that:

- Every 30 minutes, compare the selected npm versions with `https://staging-cdn.stagepass.one/manifest.json`. Deploy staging only when at least one version is missing. If the manifest cannot be read, skip and print a notice. The run stays green.
- A push to `master` that touches `cdn/**` deploys staging even when the version set is unchanged (the worker or the build changed).
- `workflow_dispatch` with target `staging` deploys staging.
- `workflow_dispatch` with target `production` deploys staging, runs `verify-live` against staging, then waits for the `cdn-production` environment and deploys `cdn.stagepass.one`.

Each verify step runs `cdn/scripts/verify-live.mjs` with `--all` and `--registry`. `--registry` fails the job when the deployed manifest is missing a version from `npm view`, other than a version listed in `exclude`.

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
    && node /work/cdn/scripts/verify-live.mjs https://staging-cdn.stagepass.one --all --local /work/cdn/dist/manifest.json --registry'
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
7. Leave the CLI on jsDelivr in this change. Making this CDN the default everywhere is tracked in stagepass-one/os#150. Until then an exact `cdn.stagepass.one` URL is opt-in for a site that wants this host.

`workers_dev` and `preview_urls` are false on the top-level config and on both environments, so a deploy does not publish a `workers.dev` hostname or a preview URL.

## Tests

`node --test cdn/test` covers routing (both spellings, hex case, traversal, major aliases, other aliases, bad package names, methods), the header builder, `handleRequest` with a fake `ASSETS` binding (including a binding that returns 307, and major-alias redirects resolved from a fake manifest), the build-script helpers (full registry selection, exclude, SRI), and the registry-coverage comparison with a mocked version list. `.github/workflows/test.yml` runs that suite on Node 22 and 24 on the same runner as the other jobs. No extra npm dependencies.
