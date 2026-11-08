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

Bump **only the package you intend to stage** in that package's `packages/<name>/package.json` (and any internal peer range that must mention the new version). The three packages have independent versions and do not need to share a number. Example: you may set `@stagepass/modules` to `2.2.2-beta.1` while leaving CLI and loader unchanged.

Update `CHANGELOG.md` and docs as needed (maintainer duty, not a workflow gate). Commit on the release branch.

### 1b. Tag and push

```bash
git tag modules-v2.1.0-beta.1
git push origin modules-v2.1.0-beta.1
```

Each release selects **exactly one** package with a package-specific tag (`cli-vX`, `loader-vX`, `modules-vX`) or the same `ref` via `workflow_dispatch`. The version after `-v` must equal that package's `package.json` version (`scripts/check-release-version.mjs`). A shared `v*` tag does not start staging. After bumping `packages/loader` or `packages/modules`, run `node scripts/sync-cli-versions.mjs` so `packages/cli/src/lib/package-versions.js` matches (also runs on CLI `prepack` and in the release workflow before tests). A drift test fails CI if the generated file is stale. `LOADER_VERSION` feeds loader snippets / `data-stagepass-version`; `MODULES_VERSION` is for modules pins. Deprecated alias: `STAGEPASS_PACKAGES_VERSION` (= `LOADER_VERSION`).

Before staging, CI runs `scripts/test-cli-packed.mjs`: it packs the CLI, loader and modules, checks the tarball contents (templates, `global.d.ts`, per-module `*.d.ts`, dist files), installs the CLI tarball globally into a temp prefix, runs `stagepass new` (ts with modules `none` and `cookies`, js with `all`) with `--install` (an `npm` shim adds the local loader/modules tarballs, so unpublished versions resolve), runs `tsc --noEmit` to check that `sp` and only the declared modules are typed, runs `npm run build`, asserts CSS-only watch + live SSE emits `{type:'css'}` (then JS → `reload`) on the js project, and finally runs `stagepass upgrade` on an old-style project. Run it locally with `node scripts/test-cli-packed.mjs` after `npm run build`.

### 1c. CI stages with `--tag next`

Workflow: `.github/workflows/release.yml` (push of tags `cli-v*` / `loader-v*` / `modules-v*`, or `workflow_dispatch` with the same `ref`, which checks out that validated tag as `refs/tags/<ref>`; runner `[self-hosted, cerebro]`, repo `arobertherz/stagepass` only).

It builds, tests, verifies versions, then runs in the selected package directory:

```bash
npm stage publish --tag next --access public
```

**Provenance:** `--provenance` is **not** used. npm provenance requires a supported cloud CI OIDC environment; the self-hosted runner is not supported.

### 1d. Maintainer promotes (2FA)

On a trusted machine, list the package you just staged (the other two commands are independent examples, not a required trio):

```bash
npm stage list @stagepass/modules
npm stage list @stagepass/loader
npm stage list @stagepass/cli
```

Approve **the stage id of the package that this tag or workflow run staged**. `npm stage approve` always refers to that one stage ID. If you released more than one package, you did so with separate tags (or `workflow_dispatch` refs) and therefore have separate stage IDs — approve each independently. There is no required approval order and no implied same-version or single-run rule; a sequence such as modules → loader → cli is not a release policy:

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

1. Bump **only the package you are releasing** to its final version (e.g. modules `2.2.2`). Do not bump the other packages unless they are themselves part of this intended release — and even then each package still gets its own tag and its own workflow run.
2. Update `CHANGELOG.md`. Commit.
3. Tag and push:

```bash
git tag modules-v2.2.0
git push origin modules-v2.2.0
```

Repeat the tag (or `workflow_dispatch`) once per package you intend to stage. CI stages with `--tag next` (as for prereleases). Approve each stage id with 2FA as above.

Note: generated projects depend on `^<major>.<minor>.0` of loader/modules (e.g. `^2.2.0`). That is a **dependency** constraint, not a same-version or single-workflow rule. If a newly scaffolded project needs a loader or modules version that is not yet approved, `npm install` can fail with `ETARGET`. Stage and approve those packages separately (own bump, own tag, own run, own stage ID) before relying on the scaffold — do not treat this as “always bump and approve all three together”.

## 3. Promote to `latest` (2FA)

After approval and a check on a Webflow staging site, promote **only the package and version you staged, approved, and verified**. The three commands below are independent examples, not a coupled bump of all packages to the same version:

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

`latest` should point at the version you just promoted. Promoting the intended default dist-tag is a required completion step for a stable public release, not an optional later loop. The workflow only publishes as `next`. If the public tag should be `latest`, run `npm dist-tag add` for that package and version and check `npm view <pkg> dist-tags` in the same sitting. Do not treat a version as the public default while `latest` still points at the previous release, and do not wait for another approval round to notice.

Sites that pin `@1` stay on 1.x. Sites that pin a major such as `@2` on jsDelivr or unpkg resolve a 2.x range on the CDN; that alias is not the npm `latest` dist-tag and can lag after a publish, so only approve stable stages that are ready for live sites. Prefer an exact pin when a specific build must load immediately.

## Required human checklist (not automated)

`.github/workflows/release.yml` covers ref validation, install, build, package tests, packed smoke, selector, and one `npm stage publish --tag next`. It does **not** cover the items below. Complete them before treating a release as public-ready:

1. GitHub README and the npm package README (this repo’s `packages/<name>/README.md`) describe the same published version and do not advertise unpublished commands as available.
2. Website changelog / release notes on stagepass.one match the public notes (manual content export; the website does not auto-sync from this repo at build time).
3. Published date in CHANGELOG is the real publication/tag date, not a later CSS or metadata fix.
4. After registry publication: record npm `gitHead` / integrity and check the jsDelivr CDN hash for the exact file that was published.
5. Known limits and any documented reviewer exception (for example an individual size-ceiling exception) are written in the public notes. Human-verified facts stay human-verified; CI green is not a substitute.
6. Consciously set and verify the intended default dist-tag. After a stable publish, `latest` should point at that version unless you intentionally left it on `next`. Confirm with `npm view <pkg> dist-tags` before updating website badges (`LOADER_V`, latest-on-npm) or docs that say what `latest` is.
7. jsDelivr/unpkg `@2` is a major-range alias and is not the npm `latest` tag. CDN aliases can keep serving an older 2.x build until they refresh. Document an exact pin when a specific build is required, and do not write that `@2` is `latest`.
