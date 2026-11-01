import { describe, it, expect, vi } from 'vitest';
import {
  applyStagepassVersions,
  findStagepassDeps,
  resolveUpgradeVersion,
  upgrade,
} from '../upgrade.js';

describe('upgrade helpers', () => {
  it('finds @stagepass/* in dependencies and devDependencies', () => {
    const found = findStagepassDeps({
      dependencies: { '@stagepass/loader': '1.0.0', lodash: '4' },
      devDependencies: { '@stagepass/modules': '1.2.0' },
    });
    expect(found).toEqual([
      { section: 'dependencies', name: '@stagepass/loader', from: '1.0.0' },
      { section: 'devDependencies', name: '@stagepass/modules', from: '1.2.0' },
    ]);
  });

  it('rewrites versions to the target', () => {
    const { next, changes } = applyStagepassVersions(
      {
        dependencies: { '@stagepass/loader': '1.0.0' },
        devDependencies: { '@stagepass/cli': '^1.0.0', other: '1' },
      },
      '2.0.0'
    );
    expect(next.dependencies['@stagepass/loader']).toBe('2.0.0');
    expect(next.devDependencies['@stagepass/cli']).toBe('2.0.0');
    expect(next.devDependencies.other).toBe('1');
    expect(changes).toHaveLength(2);
  });

  it('resolveUpgradeVersion defaults to CLI version without network', async () => {
    const exec = vi.fn();
    const v = await resolveUpgradeVersion(undefined, {
      exec,
      cliVersion: '2.0.0',
    });
    expect(v).toBe('2.0.0');
    expect(exec).not.toHaveBeenCalled();
  });

  it('resolveUpgradeVersion uses npm view for dist-tags', async () => {
    const exec = vi.fn(async () => ({ stdout: '2.1.0\n', stderr: '', code: 0 }));
    const v = await resolveUpgradeVersion('latest', { exec, cliVersion: '2.0.0' });
    expect(v).toBe('2.1.0');
    expect(exec).toHaveBeenCalledWith('npm', [
      'view',
      '@stagepass/cli@latest',
      'version',
    ]);
  });
});

describe('upgrade command', () => {
  function mockFs(initialPkg) {
    let written = null;
    return {
      fs: {
        pathExists: async () => true,
        readFile: async () => JSON.stringify(initialPkg, null, 2) + '\n',
        writeFile: async (_p, body) => {
          written = body;
        },
      },
      getWritten: () => written,
    };
  }

  it('writes updated package.json and does not call install', async () => {
    const { fs, getWritten } = mockFs({
      name: 'app',
      dependencies: { '@stagepass/loader': '1.0.0' },
    });
    const logs = [];
    const code = await upgrade(
      {},
      {
        fs,
        cwd: '/tmp/app',
        cliVersion: '2.0.0',
        log: (m) => logs.push(String(m)),
      }
    );
    expect(code).toBe(0);
    const pkg = JSON.parse(getWritten());
    expect(pkg.dependencies['@stagepass/loader']).toBe('2.0.0');
    expect(logs.join('\n')).toContain('npm install');
    expect(logs.join('\n')).toContain('cdn.jsdelivr.net/npm/@stagepass/loader@2');
  });

  it('--dry-run does not write', async () => {
    const { fs, getWritten } = mockFs({
      dependencies: { '@stagepass/loader': '1.0.0' },
    });
    const code = await upgrade(
      { dryRun: true },
      { fs, cwd: '/tmp/app', cliVersion: '2.0.0', log: () => {} }
    );
    expect(code).toBe(0);
    expect(getWritten()).toBeNull();
  });

  it('only touches package.json path', async () => {
    const paths = [];
    const fs = {
      pathExists: async (p) => {
        paths.push(['exists', p]);
        return true;
      },
      readFile: async (p) => {
        paths.push(['read', p]);
        return JSON.stringify({
          dependencies: { '@stagepass/loader': '1.0.0' },
        });
      },
      writeFile: async (p) => {
        paths.push(['write', p]);
      },
    };
    await upgrade(
      {},
      { fs, cwd: '/proj', cliVersion: '2.0.0', log: () => {} }
    );
    expect(paths.every(([, p]) => p === '/proj/package.json')).toBe(true);
  });
});
