# Releasing Stagepass

Stagepass publishes `@stagepass/cli`, `@stagepass/loader`, and `@stagepass/modules` to npm via a **two-step** flow: CI **stages** packages; a maintainer **approves** them with 2FA.

Every release ships **first as a prerelease**, then as a stable version after staging-site verification. Breaking changes only land in a new major (v3).

## Prerequisites

- Maintainer access to the npm packages
- npm CLI **≥ 11.15.0** and Node **≥ 22.14.0** on the machine that approves
- Repo secret `NPM_TOKEN` on GitHub (used only by the release workflow to stage)

## Dist-tag rules

Workflow: `.github/workflows/release.yml` (and `scripts/check-release-version.mjs`):

| Version shape | Example tag | npm dist-tag |
| :--- | :--- | :--- |
| Prerelease (contains `-`) | `v2.1.0-beta.1` | `next` |
| Stable | `v2.1.0` | `latest` |

CDN majors such as `@2` resolve the newest **stable** 2.x on `latest`. They do **not** resolve prereleases. Always test betas with an **exact** version pin.

## 1. Prerelease first

### 1a. Bump versions

Set the same prerelease version in all three `packages/*/package.json` files (and any internal peer ranges), e.g. `2.1.0-beta.1`.

Update `CHANGELOG.md` and docs as needed. Commit on the release branch.

### 1b. Tag and push

```bash
git tag v2.1.0-beta.1
git push origin v2.1.0-beta.1
```

The tag **without** the leading `v` must equal the `version` of the packages you release. CI stages only the packages whose version matches the tag and fails if none match (`scripts/check-release-version.mjs`).

**Partial release** (e.g. a CLI-only patch): bump only that package (e.g. `@stagepass/cli` to `2.1.1`), tag `v2.1.1`. The other packages are skipped and keep their staged/published version. Keep `STAGEPASS_PACKAGES_VERSION` in `packages/cli/src/lib/versions.js` equal to the loader/modules version (a test enforces this).

Before staging, CI runs `scripts/test-cli-packed.mjs` (packs the CLI, installs the tarball globally into a temp prefix, runs `stagepass new` for ts and js with `--install`, then `npm run build`). Run it locally with `node scripts/test-cli-packed.mjs`.

### 1c. CI stages with `--tag next`

Workflow: `.github/workflows/release.yml` (push of tags `v*`, runner `[self-hosted, cerebro]`, repo `arobertherz/stagepass` only).

It builds, tests, verifies versions, then runs in each package directory:

```bash
npm stage publish --tag next --access public
```

**Provenance:** `--provenance` is **not** used. npm provenance requires a supported cloud CI OIDC environment; the self-hosted runner is not supported.

### 1d. Maintainer promotes (2FA)

On a trusted machine:

```bash
npm stage list @stagepass/modules
npm stage list @stagepass/loader
npm stage list @stagepass/cli
```

Approve each stage id (order does not matter; modules → loader → cli is fine):

```bash
npm stage approve <stage-id>
```

Or approve in the npm website **Staged Packages** tab. Reject with `npm stage reject <stage-id>` if needed.

### 1e. Verify on a Webflow staging site

Pin the **exact** beta version (ranges like `@2` will not pick it up):

```html
<script
  src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2.1.0-beta.1/dist/loader.min.js"
></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2.1.0-beta.1/dist/inject.min.js"></script>
```

Test on a generic Webflow staging host such as `my-project.webflow.io` (never a real customer domain). Confirm loader/modules behaviour before promoting to stable.

## 2. Stable release

After the beta looks good:

1. Bump all three packages to the final version (e.g. `2.1.0`).
2. Update `CHANGELOG.md`. Commit.
3. Tag and push:

```bash
git tag v2.1.0
git push origin v2.1.0
```

CI stages with `--tag latest`. Approve with 2FA as above.

## 3. Verify dist-tags

```bash
npm view @stagepass/loader dist-tags
npm view @stagepass/modules dist-tags
npm view @stagepass/cli dist-tags
```

For a stable 2.x release, `latest` should point at the version you just published (e.g. `2.1.0`). Sites that pin `@1` stay on 1.x. Sites that pin `@2` pick up the newest stable 2.x.

If needed:

```bash
npm dist-tag add @stagepass/loader@2.1.0 latest
npm dist-tag add @stagepass/modules@2.1.0 latest
npm dist-tag add @stagepass/cli@2.1.0 latest
```

## Notes

- Prerelease versions **require** an explicit `--tag` on `npm stage publish` (the workflow sets `next`).
- The stage tag is immutable for a staged package; changing dist-tags after approval uses `npm dist-tag`.
- Do not use `workflow_dispatch` for releases; tags only.
- Breaking changes only in a new major (v3). Within v2, keep changes backward compatible.
