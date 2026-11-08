# Releasing Stagepass

Stagepass publishes `@stagepass/cli`, `@stagepass/loader`, and `@stagepass/modules` to npm via a **two-step** flow: CI **stages** one selected package under the `next` dist-tag; a maintainer **approves** that stage with 2FA, then **explicitly** promotes it to `latest` when ready.

The three packages have **independent versions**. A release never requires bumping all three together. Breaking changes only land in a new major (v3).

Workflows in this repo: `.github/workflows/release.yml` (stage) and `.github/workflows/test.yml` (CI). There is **no** `promote.yml`.

## Prerequisites

- Maintainer access to the npm packages
- npm CLI **≥ 11.15.0** and Node **≥ 22.14.0** on the machine that approves staged packages
- Repo secret `NPM_TOKEN` on GitHub (used only by the release workflow to stage)

## Dist-tag rules

| Version shape | Example tag | npm dist-tag at staging |
| :--- | :--- | :--- |
| Prerelease (contains `-`) | `modules-v2.2.0-beta.1` | `next` |
| Stable | `cli-v2.2.7` | `next` |

Every release is staged under **`next`**. Approving a stage does **not** move `latest`. Consumers on `npm install @stagepass/cli` keep the previous `latest` until a maintainer runs `npm dist-tag add … latest` (section 3).

Always test betas with an **exact** version pin.

## 1. Prerelease (optional) or stable — one package

### 1a. Bump **only** the package you intend to stage

Edit that package’s `packages/<name>/package.json` version (and any peer/range that must mention it). Leave the other packages unchanged unless they are themselves part of a separate release.

Update `CHANGELOG.md` and package docs as needed. Commit on the appropriate branch (`master` or `release/*`).

**CLI note:** On the CLI release line, keep `STAGEPASS_PACKAGES_VERSION` in `packages/cli/src/lib/versions.js` equal to the loader/modules versions **in this monorepo checkout** when a lockstep test exists. That constant is an offline snippet fallback; `stagepass new` / `upgrade` still resolve live registry pins. Do **not** republish loader/modules solely to change CLI docs.

### 1b. Tag and push **one** package tag

```bash
git tag cli-v2.2.7
git push origin cli-v2.2.7
```

Each release selects **exactly one** package with a package-specific tag (`cli-vX`, `loader-vX`, `modules-vX`) or the same `ref` via `workflow_dispatch`. The version after `-v` must equal that package’s `package.json` version (`scripts/check-release-version.mjs`). A shared `v*` tag does **not** start staging.

Before staging, CI runs `scripts/test-cli-packed.mjs` (packs CLI/loader/modules as needed for the smoke, installs the CLI tarball, exercises `new` / `upgrade`). Run it locally with `node scripts/test-cli-packed.mjs` after `npm run build` when touching CLI/scaffold.

### 1c. CI stages with `--tag next`

Workflow: `.github/workflows/release.yml` (push of tags `cli-v*` / `loader-v*` / `modules-v*`, or `workflow_dispatch` with the same `ref`; runner `[self-hosted, cerebro]`, repo `arobertherz/stagepass` only).

It builds, tests, verifies the selected package version, then runs in that package directory:

```bash
npm stage publish --tag next --access public
```

**Provenance:** `--provenance` is **not** used (self-hosted runner is not a supported OIDC provenance environment).

### 1d. Maintainer approves the stage (2FA) — human gate

On a trusted machine, list stages for the package you just published:

```bash
npm stage list @stagepass/cli
# or @stagepass/loader / @stagepass/modules for those tags
```

Approve **only the stage id** for that package/version:

```bash
npm stage approve <stage-id>
```

Or approve in the npm website **Staged Packages** tab. Reject with `npm stage reject <stage-id>` if needed.

If you released more than one package, you used separate tags and therefore have separate stage IDs — approve each independently. There is no required approval order.

### 1e. Verify on a Webflow staging site (loader/modules)

When releasing loader/modules, pin the **exact** version (ranges like `@2` will not pick a beta):

```html
<script
  src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2.1.0-beta.1/dist/loader.min.js"
></script>
```

Test on a generic Webflow staging host such as `my-project.webflow.io` (never a real customer domain) before promoting to `latest`.

## 2. CLI-only example (stable patch)

Example for `@stagepass/cli@2.2.7` while leaving loader/modules on their current published versions:

1. Bump **only** `packages/cli/package.json` to `2.2.7`.
2. Update CLI changelog / README. Commit.
3. Tag and push `cli-v2.2.7`.
4. Wait for `release.yml` to stage under `next`.
5. `npm stage approve <cli-stage-id>` (2FA).
6. Promote to `latest` only after acceptance (section 3).

## 3. Promote to `latest` (explicit, 2FA)

After stage approval and verification, promote **only** the package and version you staged:

```bash
npm dist-tag add @stagepass/cli@2.2.7 latest
# independently, when those packages are released:
# npm dist-tag add @stagepass/loader@X.Y.Z latest
# npm dist-tag add @stagepass/modules@X.Y.Z latest
```

Verify:

```bash
npm view @stagepass/cli dist-tags
npm view @stagepass/loader dist-tags
npm view @stagepass/modules dist-tags
```

`latest` must point at the version you just promoted. Sites that pin `@1` stay on 1.x. Major CDN pins such as `@2` can pick up a new stable 2.x once published (CDN range resolution is not tied to `latest`), so only promote stables that are ready for live sites.

## 4. What not to invent

- Do **not** expect a `promote.yml` workflow in this repository.
- Do **not** require a lockstep version bump of all three packages for a single-package release.
- Do **not** treat stage approval as moving `latest`; that step is always an explicit `npm dist-tag add`.
