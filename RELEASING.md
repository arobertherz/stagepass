# Releasing Stagepass

Stagepass publishes `@stagepass/cli`, `@stagepass/loader`, and `@stagepass/modules` to npm via a **two-step** flow: CI **stages** packages; a maintainer **approves** them with 2FA.

A prerelease is optional: use one when there are real test users. Stable releases are verified by the maintainer before tagging, then staged directly on dist-tag `latest`. Breaking changes only land in a new major (v3).

## Prerequisites

- Maintainer access to the npm packages
- npm CLI **≥ 11.15.0** and Node **≥ 22.14.0** on the machine that approves
- Repo secret `NPM_TOKEN` on GitHub (used only by the release workflow to stage)

## Dist-tag rules

Workflow: `.github/workflows/release.yml` (and `scripts/check-release-version.mjs`):

| Version shape | Example tag | npm dist-tag at staging |
| :--- | :--- | :--- |
| Prerelease (contains `-`) | `modules-v2.2.0-beta.1` | `next` |
| Stable | `loader-v2.2.0` | `latest` |

The selector (`scripts/check-release-version.mjs`) chooses the dist-tag: `next` when the version contains `-`, `latest` for a stable `X.Y.Z`. A stable release is staged on `latest`, so one `npm stage approve <id>` with 2FA publishes it as the default install. There is no separate promotion step. Prereleases stay on `next`, which remains available for later betas. A prerelease first is optional; use it when there are real test users. Stable releases are verified by the maintainer before tagging. `next` does not move `latest`.

Always test betas with an **exact** version pin.

## 1. Prerelease (optional)

Use this path when there are real test users. It is not required before a stable release. Stable releases are verified by the maintainer before tagging.

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

### 1c. CI stages with the dist-tag from the selector

Workflow: `.github/workflows/release.yml` (push of tags `cli-v*` / `loader-v*` / `modules-v*`, or `workflow_dispatch` with the same `ref`, which checks out that validated tag as `refs/tags/<ref>`; runner `[self-hosted, cerebro]`, repo `arobertherz/stagepass` only).

It builds, tests, verifies versions, then runs in the selected package directory:

```bash
npm stage publish --tag <dist_tag> --access public
```

`<dist_tag>` comes from the selector: `next` for a prerelease, `latest` for a stable version.

**Provenance:** `--provenance` is **not** used. npm provenance requires a supported cloud CI OIDC environment; the self-hosted runner is not supported.

### 1d. Maintainer approves the staged package (2FA)

On a trusted machine, list the package you just staged (the other two commands are independent examples, not a required trio):

```bash
npm stage list @stagepass/modules
npm stage list @stagepass/loader
npm stage list @stagepass/cli
```

Approve **the stage id of the package that this tag or workflow run staged**. `npm stage approve` always refers to that one stage ID. If you released more than one package, you did so with separate tags (or `workflow_dispatch` refs) and therefore have separate stage IDs: approve each independently. There is no required approval order and no implied same-version or single-run rule; a sequence such as modules → loader → cli is not a release policy:

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

Verify the package yourself before tagging. A prior prerelease is optional.

1. Bump **only the package you are releasing** to its final version (e.g. modules `2.2.2`). Do not bump the other packages unless they are themselves part of this intended release, and even then each package still gets its own tag and its own workflow run.
2. Update `CHANGELOG.md`. Commit.
3. Tag and push:

```bash
git tag modules-v2.2.0
git push origin modules-v2.2.0
```

Repeat the tag (or `workflow_dispatch`) once per package you intend to stage. CI stages a stable version on `latest` (a prerelease stays on `next`). One approval with 2FA publishes that stable stage as `latest`. There is no promotion step.

Note: generated projects depend on `^2` for loader/modules (`PACKAGES_MAJOR_RANGE` in `packages/cli/src/lib/registry.js`), the same major as the CDN pin `@2`. That is a **dependency** constraint, not a same-version or single-workflow rule. If a newly scaffolded project needs a loader or modules version that is not yet approved, `npm install` can fail with `ETARGET`. Stage and approve those packages separately (own bump, own tag, own run, own stage ID) before relying on the scaffold; do not treat this as “always bump and approve all three together”.

## 3. Verify dist-tags / manual dist-tag fixes

After approval, confirm the dist-tags. A stable approval should already show that version as `latest`. A prerelease should show under `next` and leave `latest` unchanged.

```bash
npm view @stagepass/loader dist-tags
npm view @stagepass/modules dist-tags
npm view @stagepass/cli dist-tags
```

`npm dist-tag add` is a manual repair tool, not a required release step. Use it only if a tag points at the wrong version. The three commands below are independent examples, not a coupled bump of all packages to the same version:

```bash
npm dist-tag add @stagepass/modules@2.2.0 latest
npm dist-tag add @stagepass/loader@2.2.0 latest
npm dist-tag add @stagepass/cli@2.2.0 latest
```

### Promote workflows (historical)

One-shot GitHub Actions workflows that called `npm dist-tag add` for fixed loader/modules versions (`promote-loader-2.4.0-latest.yml`, `promote-modules-2.2.2-latest.yml`) were removed after they had already run successfully. History remains in git. Stable releases no longer need that promotion. If a dist-tag is wrong, repair it with `npm dist-tag add` and verify with `npm view <pkg> dist-tags`.

Sites that pin `@1` stay on 1.x. Sites that pin a major such as `@2` on jsDelivr or unpkg resolve a 2.x range on the CDN; that alias is not the npm `latest` dist-tag and can lag after a publish, so only approve stable stages that are ready for live sites. Prefer an exact pin when a specific build must load immediately.

## Required human checklist (not automated)

`.github/workflows/release.yml` covers ref validation, install, build, package tests, packed smoke, selector, and one `npm stage publish --tag <dist_tag>`. It does **not** cover the items below. Complete them before treating a release as public-ready:

1. GitHub README and the npm package README (this repo’s `packages/<name>/README.md`) describe the same published version and do not advertise unpublished commands as available.
2. Website changelog / release notes on stagepass.one match the public notes (manual content export; the website does not auto-sync from this repo at build time).
3. Published date in CHANGELOG is the real publication/tag date, not a later CSS or metadata fix.
4. After registry publication: record npm `gitHead` / integrity and check the jsDelivr CDN hash for the exact file that was published.
5. Known limits and any documented reviewer exception (for example an individual size-ceiling exception) are written in the public notes. Human-verified facts stay human-verified; CI green is not a substitute.
6. Verify dist-tags with `npm view <pkg> dist-tags`. After a stable approval, `latest` should already point at that version (staged directly; no promotion step). A prerelease stays on `next` and does not move `latest`. Use `npm dist-tag add` only to repair a wrong tag. Confirm before updating website badges (`LOADER_V`, latest-on-npm) or docs that say what `latest` is.
7. jsDelivr/unpkg `@2` is a major-range alias and is not the npm `latest` tag. CDN aliases can keep serving an older 2.x build until they refresh. Document an exact pin when a specific build is required, and do not write that `@2` is `latest`.
8. After the latest publish: Run scripts/mac-update-check.sh latest on a Mac with the previous version installed and attach the protocol.
9. For a CLI release, check `packages/cli/src/lib/ai-guide.js` (the generated `AGENTS.stagepass.md`) against the published loader, modules, and CLI: new or changed APIs, flags, and PHP helpers. Do this alongside the README and `docs/`.
