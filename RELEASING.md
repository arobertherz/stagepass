# Releasing Stagepass

Stagepass publishes `@stagepass/cli`, `@stagepass/loader`, and `@stagepass/modules` to npm via a **two-step** flow: CI **stages** packages; a maintainer **approves** them with 2FA.

## Prerequisites

- Maintainer access to the npm packages
- npm CLI **≥ 11.15.0** and Node **≥ 22.14.0** on the machine that approves
- Repo secret `NPM_TOKEN` on GitHub (used only by the release workflow to stage)

## 1. Bump versions

Set the same version in all three `packages/*/package.json` files (and any internal peer ranges), e.g. `2.0.0-beta.1`.

Update `CHANGELOG.md` and docs as needed. Commit on the release branch.

## 2. Tag and push

```bash
git tag v2.0.0-beta.1
git push origin v2.0.0-beta.1
```

The tag **without** the leading `v` must equal every package `version`. CI fails otherwise (`scripts/check-release-version.mjs`).

## 3. CI stages packages

Workflow: `.github/workflows/release.yml` (push of tags `v*`, runner `[self-hosted, cerebro]`, repo `arobertherz/stagepass` only).

It builds, tests, verifies versions, then runs in each package directory:

```bash
npm stage publish --tag <tag> --access public
```

Dist-tag selection:

- Version contains `-` (prerelease) → `--tag next`
- Otherwise → `--tag latest`

**Provenance:** `--provenance` is **not** used. npm provenance requires a supported cloud CI OIDC environment; the self-hosted runner is not supported.

## 4. Maintainer promotes (2FA)

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

## 5. Verify dist-tags

For a beta release, `latest` must stay on 1.x and `next` should point at the beta:

```bash
npm view @stagepass/loader dist-tags
npm view @stagepass/modules dist-tags
npm view @stagepass/cli dist-tags
```

If needed:

```bash
npm dist-tag add @stagepass/loader@2.0.0-beta.1 next
npm dist-tag add @stagepass/modules@2.0.0-beta.1 next
npm dist-tag add @stagepass/cli@2.0.0-beta.1 next
```

## Notes

- Prerelease versions **require** an explicit `--tag` on `npm stage publish` (the workflow sets `next`).
- The stage tag is immutable for a staged package; changing dist-tags after approval uses `npm dist-tag`.
- Do not use `workflow_dispatch` for releases; tags only.
