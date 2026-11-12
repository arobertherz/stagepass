import { describe, it, expect } from 'vitest';
import {
  parseReleaseTag,
  distTagForVersion,
  readPackageVersions,
  releasePlan,
} from '../../../../../scripts/check-release-version.mjs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../../../');
const SCRIPT = path.join(ROOT, 'scripts/check-release-version.mjs');
const WORKFLOW = path.join(ROOT, '.github/workflows/release.yml');

function runMain(args, extraEnv = {}) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'sp-gh-out-'));
  const outFile = path.join(tmp, 'github_output.txt');
  writeFileSync(outFile, '');
  const env = { ...process.env, GITHUB_OUTPUT: outFile };
  delete env.RELEASE_REF;
  delete env.GITHUB_REF_NAME;
  Object.assign(env, extraEnv);
  const res = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env,
  });
  const fileOut = readFileSync(outFile, 'utf8');
  rmSync(tmp, { recursive: true, force: true });
  return {
    status: res.status,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    fileOut,
  };
}

function assertFailedWithoutSelection(result) {
  expect(result.status).not.toBe(0);
  expect(result.fileOut).not.toMatch(/(?:^|\n)stage_dir=/);
  expect(result.fileOut).not.toMatch(/(?:^|\n)dist_tag=/);
}

function tokens(s) {
  return s.split(/[\s,=:"'` ;|<>()[\]{}]+/).filter(Boolean);
}

const INJECTION_REFS = [
  'cli-v$(whoami)',
  'cli-v2.2.6$(whoami)',
  'modules-v2.2.2; echo pwned',
  'loader-v2.3.3`id`',
  'modules-v2.2.2 && id',
  'modules-v2.2.2\nid',
  ' modules-v2.2.2',
  'modules-v2.2.2 ',
  'cli-v2',
  'cli-v2.2',
  'cli-v',
  'cli-v2.2.2-BETA.1',
];

describe('check-release-version', () => {
  it('parses package-specific release tags', () => {
    expect(parseReleaseTag('modules-v2.0.0-beta.1')).toEqual({
      dir: 'modules',
      version: '2.0.0-beta.1',
    });
    expect(parseReleaseTag('loader-v2.3.3')).toEqual({ dir: 'loader', version: '2.3.3' });
    expect(parseReleaseTag('cli-v2.2.6')).toEqual({ dir: 'cli', version: '2.2.6' });
  });

  it('stages a stable cli tag on latest (cli-v2.3.0)', () => {
    expect(parseReleaseTag('cli-v2.3.0')).toEqual({ dir: 'cli', version: '2.3.0' });
    expect(distTagForVersion('2.3.0')).toBe('latest');
    expect(distTagForVersion('2.2.0')).toBe('latest');
  });

  it('stages a prerelease cli tag on next (cli-v2.3.0-beta.1)', () => {
    expect(parseReleaseTag('cli-v2.3.0-beta.1')).toEqual({
      dir: 'cli',
      version: '2.3.0-beta.1',
    });
    expect(distTagForVersion('2.3.0-beta.1')).toBe('next');
    expect(distTagForVersion('2.0.0-beta.1')).toBe('next');
  });

  it('stages only the named package when its version matches the tag', () => {
    const packages = readPackageVersions(ROOT);
    expect(packages).toHaveLength(3);
    for (const pkg of packages) {
      const plan = releasePlan(`${pkg.dir}-v${pkg.version}`, ROOT);
      expect(plan.stage).toEqual([pkg]);
      expect(plan.skip).toEqual([]);
    }
  });

  it('fails closed when the package version does not match the tag', () => {
    expect(() => releasePlan('modules-v0.0.0-never', ROOT)).toThrow(/does not match tag version/);
  });

  it('fails closed on a shared v-tag or an unknown package tag', () => {
    const packages = readPackageVersions(ROOT);
    const cli = packages.find((pkg) => pkg.dir === 'cli');
    expect(() => releasePlan(`v${cli.version}`, ROOT)).toThrow(/Not a package release tag/);
    expect(() => releasePlan('v2.2.2', ROOT)).toThrow(/Not a package release tag/);
    expect(() => releasePlan('unknown-v1.0.0', ROOT)).toThrow(/Not a package release tag/);
    expect(() => releasePlan('foo-v2.2.2', ROOT)).toThrow(/Not a package release tag/);
  });

  it('rejects shell-injection and malformed refs', () => {
    for (const value of INJECTION_REFS) {
      expect(() => parseReleaseTag(value)).toThrow(/Not a package release tag|required/);
    }
  });

  it('fails closed on SemVer build metadata such as +b1', () => {
    expect(() => parseReleaseTag('modules-v2.2.2+b1')).toThrow(/Not a package release tag/);
    expect(() => parseReleaseTag('cli-v2.2.1+build')).toThrow(/Not a package release tag/);
    expect(() => releasePlan('modules-v2.2.2+b1', ROOT)).toThrow(/Not a package release tag/);
  });

  it('reads only the named package file and does not require the others', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'sp-one-pkg-'));
    try {
      mkdirSync(path.join(tmp, 'packages', 'modules'), { recursive: true });
      writeFileSync(
        path.join(tmp, 'packages', 'modules', 'package.json'),
        JSON.stringify({ name: '@stagepass/modules', version: '9.9.9' })
      );
      expect(releasePlan('modules-v9.9.9', tmp)).toEqual({
        version: '9.9.9',
        stage: [{ dir: 'modules', name: '@stagepass/modules', version: '9.9.9' }],
        skip: [],
      });
      expect(() => releasePlan('cli-v9.9.9', tmp)).toThrow();
      expect(() => readPackageVersions(tmp)).toThrow();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('check-release-version process (main)', () => {
  const packages = readPackageVersions(ROOT);
  const modules = packages.find((pkg) => pkg.dir === 'modules');
  const modulesRef = `modules-v${modules.version}`;

  it('writes stage_dir and dist_tag=latest and exits 0 for a matching stable package tag', () => {
    expect(modules.version).not.toContain('-');
    const result = runMain([modulesRef]);
    expect(result.status).toBe(0);
    expect(result.fileOut).toBe('stage_dir=modules\ndist_tag=latest\n');
    const found = tokens(`${result.stdout}\n${result.fileOut}`);
    expect(found).toContain('latest');
    expect(found).not.toContain('next');
  });

  it('prints only the selected package on stdout in the contracted two-line form', () => {
    for (const pkg of packages) {
      const result = runMain([`${pkg.dir}-v${pkg.version}`]);
      expect(result.status).toBe(0);
      const distTag = pkg.version.includes('-') ? 'next' : 'latest';
      const kind = pkg.version.includes('-') ? 'prerelease' : 'stable';
      expect(result.stdout).toBe(
        `✅ Stage ${pkg.name}@${pkg.version}\n   dist_tag: ${distTag} (${kind})\n`
      );
      expect(result.fileOut).toBe(`stage_dir=${pkg.dir}\ndist_tag=${distTag}\n`);
      expect(result.stdout).not.toMatch(/\bskip\b/);
      for (const other of packages) {
        if (other.dir === pkg.dir) continue;
        expect(result.stdout).not.toContain(other.name);
      }
    }
  });

  it('fails closed when extra CLI arguments are present', () => {
    const cli = packages.find((pkg) => pkg.dir === 'cli');
    assertFailedWithoutSelection(runMain([modulesRef, `cli-v${cli.version}`]));
    assertFailedWithoutSelection(runMain([modulesRef, 'extra']));
    assertFailedWithoutSelection(runMain([modulesRef, '']));
    assertFailedWithoutSelection(runMain(['', modulesRef]));
  });

  it('uses RELEASE_REF when the CLI argument is omitted', () => {
    const result = runMain([], { RELEASE_REF: modulesRef });
    expect(result.status).toBe(0);
    expect(result.fileOut).toMatch(/^stage_dir=modules$/m);
    expect(result.fileOut).toMatch(/^dist_tag=latest$/m);
  });

  it('uses GITHUB_REF_NAME when the CLI argument and RELEASE_REF are omitted', () => {
    const result = runMain([], { GITHUB_REF_NAME: modulesRef });
    expect(result.status).toBe(0);
    expect(result.fileOut).toMatch(/^stage_dir=modules$/m);
    expect(result.fileOut).toMatch(/^dist_tag=latest$/m);
  });

  it('does not fall back to a valid env value when the CLI argument is empty', () => {
    const result = runMain([''], {
      RELEASE_REF: modulesRef,
      GITHUB_REF_NAME: modulesRef,
    });
    assertFailedWithoutSelection(result);
  });

  it('fails without selection when the argument is omitted and no env ref is set', () => {
    assertFailedWithoutSelection(runMain([]));
  });

  it('fails without selection on a shared v-tag', () => {
    assertFailedWithoutSelection(runMain([`v${modules.version}`]));
    assertFailedWithoutSelection(runMain(['v2.2.2']));
  });

  it('fails without selection on injection and malformed refs', () => {
    for (const value of INJECTION_REFS) {
      assertFailedWithoutSelection(runMain([value]));
    }
  });

  it('fails without selection on SemVer build metadata such as +b1', () => {
    assertFailedWithoutSelection(runMain(['modules-v2.2.2+b1']));
    assertFailedWithoutSelection(runMain(['cli-v2.2.1+build']));
  });

  it('fails without selection when the named package version does not match', () => {
    assertFailedWithoutSelection(runMain(['modules-v0.0.0-never']));
  });

  it('stages each matching package on latest when stable and next when a prerelease', () => {
    for (const pkg of packages) {
      const result = runMain([`${pkg.dir}-v${pkg.version}`]);
      const distTag = pkg.version.includes('-') ? 'next' : 'latest';
      expect(result.status).toBe(0);
      expect(result.fileOut).toMatch(new RegExp(`^stage_dir=${pkg.dir}$`, 'm'));
      expect(result.fileOut).toMatch(new RegExp(`^dist_tag=${distTag}$`, 'm'));
      const found = tokens(`${result.stdout}\n${result.fileOut}`);
      expect(found).toContain(distTag);
      expect(found).not.toContain(distTag === 'latest' ? 'next' : 'latest');
    }
  });
});

describe('release workflow process shape', () => {
  const yaml = readFileSync(WORKFLOW, 'utf8');

  function runBlockText(source) {
    const chunks = [];
    let inRun = false;
    let runIndent = 0;
    for (const line of source.split('\n')) {
      if (/^\s+run:/.test(line)) {
        inRun = true;
        runIndent = line.search(/\S/);
        chunks.push(line);
        continue;
      }
      if (inRun) {
        if (line.trim() === '') {
          chunks.push(line);
          continue;
        }
        const indent = line.search(/\S/);
        if (indent > runIndent) {
          chunks.push(line);
          continue;
        }
        inRun = false;
      }
    }
    return chunks.join('\n');
  }

  it('does not interpolate inputs.ref or ref_name inside run blocks', () => {
    expect(runBlockText(yaml)).not.toMatch(
      /\$\{\{[^}]*(inputs\.ref|github\.event\.inputs\.ref|github\.ref_name)[^}]*\}\}/
    );
  });

  it('validates the ref and checks out refs/tags/ of that validated value', () => {
    expect(yaml.indexOf('Validate release ref')).toBeGreaterThan(-1);
    expect(yaml.indexOf('Validate release ref')).toBeLessThan(yaml.indexOf('Checkout code'));
    expect(yaml).toContain(
      '[[ ! "$RELEASE_REF" =~ ^(cli|loader|modules)-v[0-9]+\\.[0-9]+\\.[0-9]+(-[a-z0-9.]+)?$ ]]'
    );
    expect(yaml).toMatch(/ref:\s*refs\/tags\/\$\{\{\s*env\.RELEASE_REF\s*\}\}/);
    expect(yaml).toMatch(/persist-credentials:\s*false/);
  });

  it('uses package-specific tag filters and env values for staging', () => {
    expect(yaml).toContain("- 'cli-v*'");
    expect(yaml).toContain("- 'loader-v*'");
    expect(yaml).toContain("- 'modules-v*'");
    expect(yaml).not.toMatch(/^\s+-\s+'v\*'\s*$/m);
    expect(yaml).toContain('npm stage publish --tag "$DIST_TAG"');
    expect(yaml).toContain('cd "packages/$STAGE_DIR"');
  });

  it('fails when stage_dir is missing instead of skipping staging', () => {
    const idx = yaml.search(/if:\s*steps\.versions\.outputs\.stage_dir == ''/);
    expect(idx).toBeGreaterThan(-1);
    expect(yaml.slice(idx, idx + 120)).toMatch(/exit 1/);
  });

  it('does not force-publish, unpublish, or set latest', () => {
    const lines = yaml
      .split('\n')
      .map((line) => line.replace(/(^|\s)#.*$/, ''))
      .filter(Boolean);
    for (const line of lines) {
      expect(line).not.toMatch(/\bnpm\s+publish\b/);
      expect(line).not.toMatch(/\bnpm\s+unpublish\b/);
      expect(line).not.toMatch(/--force\b/);
      expect(line).not.toMatch(/(--tag|--dist-tag)[ =]+['"]?latest\b/);
      expect(line).not.toMatch(/dist-tag\s+add\b[^\n]*\blatest\b/);
    }
  });

  it('bash release-ref regex accepts package tags and rejects injection', () => {
    const check = (value) =>
      spawnSync(
        'bash',
        [
          '-c',
          '[[ "$1" =~ ^(cli|loader|modules)-v[0-9]+\\.[0-9]+\\.[0-9]+(-[a-z0-9.]+)?$ ]]',
          'bash',
          value,
        ],
        { encoding: 'utf8' }
      ).status === 0;

    expect(check('modules-v2.2.2')).toBe(true);
    expect(check('loader-v2.3.3')).toBe(true);
    expect(check('cli-v2.2.6')).toBe(true);
    expect(check('modules-v2.0.0-beta.1')).toBe(true);
    expect(check('v2.2.2')).toBe(false);
    expect(check('modules-v2.2.2+b1')).toBe(false);
    expect(check('cli-v2.2.1+build')).toBe(false);
    for (const value of INJECTION_REFS) {
      expect(check(value)).toBe(false);
    }
  });
});
