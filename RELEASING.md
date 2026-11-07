# Releasing Stagepass

Stagepass publishes `@stagepass/cli`, `@stagepass/loader`, and `@stagepass/modules` to npm via a **two-step** flow: CI **stages** packages; a maintainer **approves** them with 2FA.

Every release ships **first as a prerelease**, then as a stable version after staging-site verification. Breaking changes only land in a new major (v3).

## Prerequisites

- Maintainer access to the npm packages
- npm CLI **≥ 11.15.0** and Node **≥ 22.14.0** on the machine that approves
- Repo secret `NPM_TOKEN` on GitHub (used only by the release workflow to stage)

## Dist-tag rules

Workflow: `.github/workflows/release.yml` (and `scripts/check-release-version.mjs`):

| Version shape | Example tag | npm dist-tag at staging |
| :--- | :--- | :--- |
| Prerelease (contains `-`) | `modules-v2.2.0-beta.1` | `next` |
| Stable | `loader-v2.2.0` | `next` |

Since 2.2.0 **every** release is staged under `next`. Approving a stage therefore never moves `latest`, so `npm install @stagepass/cli` keeps installing the previous version until a maintainer promotes the new one explicitly (section 3). This keeps a bad build from reaching `latest` by a single approval click.

Always test betas with an **exact** version pin.

## 1. Prerelease first

### 1a. Bump versions

Set the same prerelease version in all three `packages/*/package.json` files (and any internal peer ranges), e.g. `2.1.0-beta.1`.

Update `CHANGELOG.md` and docs as needed. Commit on the release branch.

### 1b. Tag and push

```bash
git tag modules-v2.1.0-beta.1
git push origin modules-v2.1.0-beta.1
```

Each release selects **exactly one** package with a package-specific tag (`cli-vX`, `loader-vX`, `modules-vX`) or the same `ref` via `workflow_dispatch`. The version after `-v` must equal that package's `package.json` version (`scripts/check-release-version.mjs`). A shared `v*` tag does not start staging. Keep `STAGEPASS_PACKAGES_VERSION` in `packages/cli/src/lib/versions.js` equal to the loader/modules version (a test enforces this).

Before staging, CI runs `scripts/test-cli-packed.mjs`: it packs the CLI, loader and modules, checks the tarball contents (templates, `global.d.ts`, per-module `*.d.ts`, dist files), installs the CLI tarball globally into a temp prefix, runs `stagepass new` (ts with modules `none` and `cookies`, js with `all`) with `--install` (an `npm` shim adds the local loader/modules tarballs, so unpublished versions resolve), runs `tsc --noEmit` to check that `sp` and only the declared modules are typed, runs `npm run build`, and finally runs `stagepass upgrade` on an old-style project. Run it locally with `node scripts/test-cli-packed.mjs` after `npm run build`.

### 1c. CI stages with `--tag next`

Workflow: `.github/workflows/release.yml` (push of tags `cli-v*` / `loader-v*` / `modules-v*`, or `workflow_dispatch` with the same `ref`, which checks out that ref; runner `[self-hosted, cerebro]`, repo `arobertherz/stagepass` only).

It builds, tests, verifies versions, then runs in the selected package directory:

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

1. Bump all three packages to the final version (e.g. `2.2.0`).
2. Update `CHANGELOG.md`. Commit.
3. Tag and push:

```bash
git tag modules-v2.2.0
git push origin modules-v2.2.0
```

Repeat the tag (or `workflow_dispatch`) once per package you intend to stage. CI stages with `--tag next` (as for prereleases). Approve each stage id with 2FA as above.

Note: generated projects depend on `^<major>.<minor>.0` of loader/modules (e.g. `^2.2.0`). Until loader and modules of that minor are approved, `npm install` in a freshly scaffolded project fails with `ETARGET`. Approve loader and modules together with the CLI.

## 3. Promote to `latest` (2FA)

After approval and a check on a Webflow staging site:

```bash
npm dist-tag add @stagepass/modules@2.2.0 latest
npm dist-tag add @stagepass/loader@2.2.0 latest
npm dist-tag add @stagepass/cli@2.2.0 latest
```

Verify:

```bash
npm view @stagepass/loader dist-tags
npm view @stagepass/modules dist-tags
npm view @stagepass/cli dist-tags
```

`latest` should point at the version you just promoted. Sites that pin `@1` stay on 1.x. Sites that pin a major such as `@2` on jsDelivr or unpkg can pick up a new stable 2.x as soon as it is published (CDN range resolution is not tied to `latest`), so only approve stable stages that are ready for live sites.
