import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LOADER_VERSION,
  MODULES_VERSION,
  STAGEPASS_PACKAGES_VERSION,
  packagesRange,
} from '../versions.js';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const packagesDir = path.join(repoRoot, 'packages');
const generatedPath = path.join(packagesDir, 'cli', 'src', 'lib', 'package-versions.js');
const syncScript = path.join(repoRoot, 'scripts', 'sync-cli-versions.mjs');

describe('package versions (generated)', () => {
  const readVersion = (dir) =>
    JSON.parse(fs.readFileSync(path.join(packagesDir, dir, 'package.json'), 'utf8')).version;

  it('LOADER_VERSION matches packages/loader/package.json', () => {
    expect(LOADER_VERSION).toBe(readVersion('loader'));
  });

  it('MODULES_VERSION matches packages/modules/package.json', () => {
    expect(MODULES_VERSION).toBe(readVersion('modules'));
  });

  it('generated package-versions.js equals package.json versions (drift)', () => {
    const generated = fs.readFileSync(generatedPath, 'utf8');
    expect(generated).toContain(`export const LOADER_VERSION = ${JSON.stringify(readVersion('loader'))};`);
    expect(generated).toContain(
      `export const MODULES_VERSION = ${JSON.stringify(readVersion('modules'))};`
    );
  });

  it('sync-cli-versions.mjs is idempotent', () => {
    const before = fs.readFileSync(generatedPath, 'utf8');
    execFileSync(process.execPath, [syncScript], { cwd: repoRoot, encoding: 'utf8' });
    const after = fs.readFileSync(generatedPath, 'utf8');
    expect(after).toBe(before);
    execFileSync(process.execPath, [syncScript], { cwd: repoRoot, encoding: 'utf8' });
    expect(fs.readFileSync(generatedPath, 'utf8')).toBe(before);
  });

  it('sync-cli-versions.mjs --check exits 0 when in sync and writes nothing', () => {
    const before = fs.readFileSync(generatedPath, 'utf8');
    execFileSync(process.execPath, [syncScript, '--check'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(fs.readFileSync(generatedPath, 'utf8')).toBe(before);
  });

  it('sync-cli-versions.mjs --check exits 1 when drifted and writes nothing', () => {
    const before = fs.readFileSync(generatedPath, 'utf8');
    const broken = before.replace(
      /export const LOADER_VERSION = "[^"]*";/,
      'export const LOADER_VERSION = "0.0.0-drift";'
    );
    expect(broken).not.toBe(before);
    fs.writeFileSync(generatedPath, broken, 'utf8');
    try {
      let threw = false;
      try {
        execFileSync(process.execPath, [syncScript, '--check'], {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        threw = true;
        expect(err.status).toBe(1);
      }
      expect(threw).toBe(true);
      expect(fs.readFileSync(generatedPath, 'utf8')).toBe(broken);
    } finally {
      fs.writeFileSync(generatedPath, before, 'utf8');
    }
  });

  it('STAGEPASS_PACKAGES_VERSION is a deprecated alias of LOADER_VERSION', () => {
    expect(STAGEPASS_PACKAGES_VERSION).toBe(LOADER_VERSION);
  });

  it('builds the major range (never a minor that may only be staged)', () => {
    expect(packagesRange('2.2.0')).toBe('^2');
    expect(packagesRange('3.0.4')).toBe('^3');
    expect(packagesRange('^3.4.5')).toBe('^3');
    expect(packagesRange()).toBe('^2');
    expect(() => packagesRange('latest')).toThrow();
    expect(() => packagesRange('2.2.0"; rm')).toThrow();
  });
});
