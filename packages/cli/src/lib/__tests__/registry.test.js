import { describe, it, expect, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fsx from 'fs-extra';
import {
  PACKAGES_MAJOR_RANGE,
  compareSemver,
  fetchPublished,
  installedHasPerModuleTypes,
  maxSatisfying,
  rangeHasPerModuleTypes,
  satisfiesSimple,
} from '../registry.js';

describe('registry helpers', () => {
  it('major range matches the @2 embed policy', () => {
    expect(PACKAGES_MAJOR_RANGE).toBe('^2');
  });

  it('satisfiesSimple handles exact, caret and tilde ranges', () => {
    expect(satisfiesSimple('2.0.0', '^2')).toBe(true);
    expect(satisfiesSimple('3.0.0', '^2')).toBe(false);
    expect(satisfiesSimple('2.0.0', '^2.2.0')).toBe(false);
    expect(satisfiesSimple('2.3.0', '^2.2.0')).toBe(true);
    expect(satisfiesSimple('2.2.5', '~2.2.0')).toBe(true);
    expect(satisfiesSimple('2.3.0', '~2.2.0')).toBe(false);
    expect(satisfiesSimple('2.2.0', '2.2.0')).toBe(true);
    expect(satisfiesSimple('2.2.0-beta.1', '^2')).toBe(false);
    expect(satisfiesSimple('2.2.0', '>=2')).toBe(false);
    expect(compareSemver('2.10.0', '2.9.9')).toBeGreaterThan(0);
  });

  it('maxSatisfying picks the highest published match', () => {
    expect(maxSatisfying(['1.2.0', '2.0.0', '2.1.3', '3.0.0'], '^2')).toBe('2.1.3');
    expect(maxSatisfying(['2.0.0'], '^2.2.0')).toBeNull();
  });

  it('rangeHasPerModuleTypes needs a published modules >= 2.2.0 in range', () => {
    expect(rangeHasPerModuleTypes(['2.0.0'], '^2')).toBe(false);
    expect(rangeHasPerModuleTypes(['2.0.0', '2.2.0'], '^2')).toBe(true);
    expect(rangeHasPerModuleTypes(['2.0.0', '2.2.0'], '2.0.0')).toBe(false);
    expect(rangeHasPerModuleTypes(null, '^2')).toBeNull();
  });

  it('fetchPublished parses npm view JSON with argument arrays', async () => {
    const exec = vi.fn(async () => ({
      stdout: JSON.stringify({ 'dist-tags': { latest: '2.0.0', 'bad tag': '9.9.9', evil: '"><x' }, versions: ['2.0.0', 'nope'] }),
      code: 0,
    }));
    const info = await fetchPublished('@stagepass/loader', { exec });
    expect(info).toEqual({ distTags: { latest: '2.0.0' }, versions: ['2.0.0'] });
    expect(exec).toHaveBeenCalledWith('npm', ['view', '@stagepass/loader', 'dist-tags', 'versions', '--json'], expect.objectContaining({ timeout: expect.any(Number) }));
  });

  it('fetchPublished returns null offline or on garbage', async () => {
    expect(await fetchPublished('@stagepass/loader', { exec: vi.fn(async () => { throw new Error('ENOTFOUND'); }) })).toBeNull();
    expect(await fetchPublished('@stagepass/loader', { exec: vi.fn(async () => ({ stdout: 'not json', code: 0 })) })).toBeNull();
    await expect(fetchPublished('lodash; rm -rf /', { exec: vi.fn() })).rejects.toThrow(/Invalid package name/);
  });

  it('installedHasPerModuleTypes inspects node_modules', async () => {
    const dir = await fsx.mkdtemp(path.join(os.tmpdir(), 'sp-reg-'));
    try {
      expect(await installedHasPerModuleTypes(dir)).toBeNull();
      const mod = path.join(dir, 'node_modules/@stagepass/modules');
      await fsx.outputJson(path.join(mod, 'package.json'), { version: '2.0.0' });
      expect(await installedHasPerModuleTypes(dir)).toBe(false);
      for (const id of ['inject', 'cookies', 'maintenance']) await fsx.outputFile(path.join(mod, `${id}.d.ts`), '');
      expect(await installedHasPerModuleTypes(dir)).toBe(true);
    } finally {
      await fsx.remove(dir);
    }
  });
});
