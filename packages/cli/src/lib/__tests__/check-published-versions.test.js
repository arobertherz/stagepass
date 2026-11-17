import { describe, it, expect } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectPins, pinsInText } from '../../../../../scripts/check-published-versions.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../../../');
const SCRIPT = path.join(ROOT, 'scripts/check-published-versions.mjs');
const WORKFLOW = path.join(ROOT, '.github/workflows/release.yml');

function writeFixture(dir, files) {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
}

function mockEnv(dir, versions) {
  const bin = path.join(dir, 'bin');
  mkdirSync(bin);
  const npm = path.join(bin, 'npm');
  writeFileSync(npm, '#!/bin/sh\necho npm-called >&2\nexit 1\n');
  chmodSync(npm, 0o755);
  const mock = path.join(dir, 'versions.json');
  writeFileSync(mock, JSON.stringify(versions));
  return {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    STAGEPASS_PUBLISHED_VERSIONS: mock,
  };
}

function runGate(scanRoot, env) {
  return spawnSync(process.execPath, [SCRIPT, scanRoot], {
    encoding: 'utf8',
    env,
  });
}

describe('check-published-versions', () => {
  it('ignores major pins and historical prose', () => {
    const text = [
      'live.min.js ships since 2.4.0',
      'npm latest is 2.5.0',
      '<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js"></script>',
      '<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2.x/dist/inject.min.js"></script>',
    ].join('\n');
    expect(pinsInText(text, 'README.md')).toEqual([]);
  });

  it('passes when exact pins are in the mock list and does not call npm', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'sp-pins-ok-'));
    writeFixture(dir, {
      'README.md': [
        '<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js" data-stagepass-version="2.5.0"></script>',
        '<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2.2.2/dist/cookies.min.js"></script>',
        'live.min.js ships since 2.4.0',
        'Optional exact pin example (instead of @2): loader @2.5.0, modules @2.2.2.',
        '',
      ].join('\n'),
      'packages/cli/src/lib/cdn-base.js': [
        "export const SNIPPET_LOADER_VERSION = '2.5.0';",
        "export const SNIPPET_MODULES_VERSION = '2.2.2';",
        '',
      ].join('\n'),
    });
    const res = runGate(dir, mockEnv(dir, { loader: ['2.5.0'], modules: ['2.2.2'] }));
    rmSync(dir, { recursive: true, force: true });
    expect(res.status).toBe(0);
    expect(res.stderr).not.toContain('npm-called');
    expect(res.stderr).not.toContain('warning:');
    expect(res.stdout).toContain('Published-version gate ok');
  });

  it('warns when a published pin is not latest and still errors on an unpublished pin', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'sp-pins-stale-'));
    writeFixture(dir, {
      'docs/example.md': [
        '<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2.4.0/dist/loader.min.js"></script>',
        '<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@9.9.9/dist/loader.min.js"></script>',
        '<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js"></script>',
        '',
      ].join('\n'),
    });
    const res = runGate(dir, mockEnv(dir, {
      loader: ['2.4.0', '2.5.0'],
      modules: ['2.2.2'],
      latest: { loader: '2.5.0', modules: '2.2.2' },
    }));
    rmSync(dir, { recursive: true, force: true });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('warning: @stagepass/loader@2.4.0 is published but not latest (latest is 2.5.0)');
    expect(res.stderr).toContain('unpublished @stagepass/loader@9.9.9');
    expect(res.stderr).not.toContain('loader@2 is');
    expect(res.stderr).not.toContain('npm-called');
  });

  it('exits 0 when the only issue is an outdated published pin', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'sp-pins-warn-'));
    writeFixture(dir, {
      'README.md':
        '<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2.4.0/dist/loader.min.js"></script>\n',
    });
    const res = runGate(dir, mockEnv(dir, {
      loader: ['2.4.0', '2.5.0'],
      modules: ['2.2.2'],
      latest: { loader: '2.5.0', modules: '2.2.2' },
    }));
    rmSync(dir, { recursive: true, force: true });
    expect(res.status).toBe(0);
    expect(res.stderr).toContain('latest is 2.5.0');
    expect(res.stdout).toContain('1 outdated');
    expect(res.stderr).not.toContain('npm-called');
  });

  it('fails with file and version when a pin is unpublished', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'sp-pins-bad-'));
    writeFixture(dir, {
      'docs/example.md':
        '<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@9.9.9/dist/loader.min.js"></script>\n',
    });
    const res = runGate(dir, mockEnv(dir, { loader: ['2.5.0'], modules: ['2.2.2'] }));
    rmSync(dir, { recursive: true, force: true });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('docs/example.md');
    expect(res.stderr).toContain('unpublished @stagepass/loader@9.9.9');
    expect(res.stderr).not.toContain('warning:');
    expect(res.stderr).not.toContain('npm-called');
  });

  it('passes a tree that only uses major @2 pins', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'sp-pins-major-'));
    writeFixture(dir, {
      'README.md': [
        '<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js"></script>',
        '<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2.x/dist/cookies.min.js"></script>',
        'live.min.js ships since 2.4.0',
        '',
      ].join('\n'),
    });
    const res = runGate(dir, mockEnv(dir, {
      loader: ['2.4.0', '2.5.0'],
      modules: ['2.2.2'],
      latest: { loader: '2.5.0', modules: '2.2.2' },
    }));
    rmSync(dir, { recursive: true, force: true });
    expect(res.status).toBe(0);
    expect(res.stderr).not.toContain('warning:');
    expect(res.stderr).not.toContain('npm-called');
  });

  it('reads snippet constants from cdn-base and does not treat since-2.4.0 as a pin', () => {
    const pins = collectPins(ROOT);
    const constants = pins.filter((pin) => pin.file === 'packages/cli/src/lib/cdn-base.js');
    expect(constants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ package: 'loader', version: '2.5.0' }),
        expect.objectContaining({ package: 'modules', version: '2.2.2' }),
      ])
    );
    const loaderDoc = pins.filter((pin) => pin.file === 'docs/loader.md');
    expect(loaderDoc.map((pin) => pin.version)).not.toContain('2.4.0');
    expect(loaderDoc).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ package: 'loader', version: '2.5.0' }),
      ])
    );
  });

  it('runs in the release workflow before npm stage publish', () => {
    const yaml = readFileSync(WORKFLOW, 'utf8');
    const gate = yaml.indexOf('node scripts/check-published-versions.mjs');
    const stage = yaml.indexOf('npm stage publish');
    expect(gate).toBeGreaterThan(-1);
    expect(stage).toBeGreaterThan(gate);
  });
});
