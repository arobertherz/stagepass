import { describe, it, expect, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fsx from 'fs-extra';
import {
  PACKAGES_MAJOR_RANGE,
  compareSemver,
  fetchPublished,
  installedHasPerModuleTypes,
  installedLoaderVersion,
  maxSatisfying,
  rangeHasPerModuleTypes,
  resolveSnippetLoaderVersion,
  satisfiesSimple,
} from '../registry.js';
import { STAGEPASS_PACKAGES_VERSION } from '../versions.js';

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

  it('[INV-4] rejects build metadata, leading zeros, and dash-in-build as stable', () => {
    expect(satisfiesSimple('2.9.0+EVILMARK5', '^2')).toBe(false);
    expect(satisfiesSimple('2.3.4+build.1', '^2')).toBe(false);
    expect(satisfiesSimple('2.9.0+a-b', '^2')).toBe(false);
    expect(satisfiesSimple('2.4.0-rc.1', '^2')).toBe(false);
    expect(satisfiesSimple('02.1.0', '^2')).toBe(false);
    expect(satisfiesSimple('2.3.4', '^2')).toBe(true);
    expect(satisfiesSimple('2.10.0', '^2')).toBe(true);
    expect(compareSemver('2.10.0', '2.3.4')).toBeGreaterThan(0);
  });

  it('maxSatisfying picks the highest published match', () => {
    expect(maxSatisfying(['1.2.0', '2.0.0', '2.1.3', '3.0.0'], '^2')).toBe('2.1.3');
    expect(maxSatisfying(['2.0.0'], '^2.2.0')).toBeNull();
  });

  it('[INV-4] maxSatisfying ignores build metadata and prereleases in the list', () => {
    expect(
      maxSatisfying(
        ['2.9.0+EVILMARK5', '2.3.4+build.1', '2.4.0-rc.1', '2.3.4', '2.10.0', '02.1.0'],
        '^2'
      )
    ).toBe('2.10.0');
    expect(maxSatisfying(['2.9.0+EVILMARK5', '2.4.0-rc.1'], '^2')).toBeNull();
  });

  it('[INV-4] rejects versions with leading or trailing whitespace', () => {
    expect(satisfiesSimple(' 2.7.0', '^2')).toBe(false);
    expect(satisfiesSimple('2.7.0 ', '^2')).toBe(false);
    expect(satisfiesSimple('\t2.7.0', '^2')).toBe(false);
    expect(satisfiesSimple('2.7.0\n', '^2')).toBe(false);
    expect(satisfiesSimple('2.3.4', '^2')).toBe(true);
  });

  it('[INV-4] maxSatisfying ignores whitespace-padded versions in the list', () => {
    expect(
      maxSatisfying(
        [' 2.7.0', '2.7.0 ', '\t2.7.0', '2.7.0\n', '2.9.0+EVILMARK5', '02.1.0', '2.3.4'],
        '^2'
      )
    ).toBe('2.3.4');
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

describe('resolveSnippetLoaderVersion (AC-14)', () => {
  const pub = (latest, versions) => ({ distTags: { latest }, versions });
  const withInstalled = async (version, fn) => {
    const dir = await fsx.mkdtemp(path.join(os.tmpdir(), 'sp-loader-ver-'));
    try {
      if (version !== undefined) {
        await fsx.outputJson(path.join(dir, 'node_modules/@stagepass/loader/package.json'), { name: '@stagepass/loader', version });
      }
      return await fn(dir);
    } finally {
      await fsx.remove(dir);
    }
  };

  it('uses the newest published 2.x loader, even over an installed one', async () => {
    await withInstalled('2.1.0', async (cwd) => {
      expect(await resolveSnippetLoaderVersion({ published: pub('2.3.4', ['2.0.0', '2.3.4', '2.2.0']), cwd })).toBe('2.3.4');
      expect(await resolveSnippetLoaderVersion({ published: pub('3.0.0', ['2.3.4', '3.0.0', '3.1.0']), cwd })).toBe('2.3.4');
      expect(await resolveSnippetLoaderVersion({ published: pub('2.4.0-beta.1', ['2.3.4', '2.4.0-beta.1']), cwd })).toBe('2.3.4');
    });
  });

  it('[INV-4] ignores registry build metadata and picks the newest stable 2.x', async () => {
    await withInstalled('2.1.0', async (cwd) => {
      const versions = [
        '2.9.0+EVILMARK5',
        '2.3.4+build.1',
        '2.4.0-rc.1',
        '2.9.0+a-b',
        '02.1.0',
        '2.3.4',
        '2.10.0',
      ];
      expect(await resolveSnippetLoaderVersion({ published: pub('3.0.0', versions), cwd })).toBe('2.10.0');
    });
  });

  it('[INV-4] ignores registry versions with whitespace at the edges', async () => {
    await withInstalled('2.1.0', async (cwd) => {
      const versions = [' 2.7.0', '2.7.0 ', '\t2.7.0', '2.7.0\n', '2.9.0+EVILMARK5', '2.3.4'];
      expect(await resolveSnippetLoaderVersion({ published: pub('3.0.0', versions), cwd })).toBe('2.3.4');
    });
  });

  it('offline (or no 2.x published) uses the installed loader, then the bundled one', async () => {
    await withInstalled('2.3.9', async (cwd) => {
      expect(await resolveSnippetLoaderVersion({ published: null, cwd, bundled: '2.2.0' })).toBe('2.3.9');
      expect(await resolveSnippetLoaderVersion({ published: pub('3.0.0', ['3.0.0']), cwd, bundled: '2.2.0' })).toBe('2.3.9');
    });
    await withInstalled(undefined, async (cwd) => {
      expect(await resolveSnippetLoaderVersion({ published: null, cwd, bundled: '2.2.7' })).toBe('2.2.7');
      expect(await resolveSnippetLoaderVersion({ published: null, cwd })).toBe(STAGEPASS_PACKAGES_VERSION);
    });
  });

  it.each([
    ['3.0.0'],
    ['1.9.0'],
    ['2.4.0-rc.1'],
    ['2.9.0+EVILMARK5'],
    ['2.3.4+build.1'],
    ['2.9.0+a-b'],
    ['02.1.0'],
    [' 2.7.0'],
    ['2.7.0 '],
    ['\t2.3.4'],
    ['2.3.4"><script>'],
    [42],
    [''],
  ])(
    '[INV-4][AC-6] ignores an installed loader with version %s',
    async (version) => {
      await withInstalled(version, async (cwd) => {
        expect(await installedLoaderVersion(cwd)).toBeNull();
        expect(await resolveSnippetLoaderVersion({ published: null, cwd, bundled: '2.2.0' })).toBe('2.2.0');
      });
    }
  );

  it('ignores an unreadable installed package.json', async () => {
    await withInstalled(undefined, async (cwd) => {
      await fsx.outputFile(path.join(cwd, 'node_modules/@stagepass/loader/package.json'), '{ not json');
      expect(await installedLoaderVersion(cwd)).toBeNull();
      expect(await resolveSnippetLoaderVersion({ published: null, cwd, bundled: '2.2.0' })).toBe('2.2.0');
    });
  });
});
