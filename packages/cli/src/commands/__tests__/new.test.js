import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import {
  createNew,
  resolveNewOptions,
  resolveBoolFlag,
} from '../new.js';
import { defaultTemplatesRoot } from '../../lib/scaffold.js';

describe('resolveBoolFlag', () => {
  it('uses argv only (ignores Commander default true on negated pairs)', () => {
    expect(resolveBoolFlag({ install: true }, 'install', ['--no-install'], true)).toBe(
      false
    );
    expect(resolveBoolFlag({ install: true }, 'install', [], false)).toBe(false);
    expect(resolveBoolFlag({}, 'modules', ['--modules'], false)).toBe(true);
    expect(resolveBoolFlag({}, 'git', [], undefined)).toBeUndefined();
  });
});

describe('resolveNewOptions', () => {
  it('applies --yes defaults without TTY', async () => {
    const resolved = await resolveNewOptions(
      'my-app',
      { yes: true },
      { isTTY: false, argv: ['--yes'], exec: async () => ({ stdout: 'Ada' }) }
    );
    expect(resolved.ok).toBe(true);
    expect(resolved.config).toMatchObject({
      name: 'my-app',
      dir: 'my-app',
      lang: 'ts',
      styles: 'scss',
      modules: true,
      git: true,
      install: false,
      author: 'Ada',
    });
  });

  it('honours flag combinations', async () => {
    const resolved = await resolveNewOptions(
      'demo',
      {
        yes: true,
        lang: 'js',
        styles: 'css',
        modules: false,
        git: false,
        install: true,
        dir: './out/demo',
        author: 'Bob',
      },
      {
        isTTY: false,
        argv: [
          '--yes',
          '--lang',
          'js',
          '--styles',
          'css',
          '--no-modules',
          '--no-git',
          '--install',
          '--dir',
          './out/demo',
          '--author',
          'Bob',
        ],
      }
    );
    expect(resolved.ok).toBe(true);
    expect(resolved.config).toMatchObject({
      lang: 'js',
      styles: 'css',
      modules: false,
      git: false,
      install: true,
      dir: './out/demo',
      author: 'Bob',
    });
  });

  it('rejects invalid names and credential remotes', async () => {
    const badName = await resolveNewOptions(
      'Bad_Name',
      { yes: true },
      { isTTY: false, argv: ['--yes'] }
    );
    expect(badName.ok).toBe(false);

    const badRemote = await resolveNewOptions(
      'ok-name',
      {
        yes: true,
        remote: 'https://user:pass@github.com/org/repo.git',
      },
      {
        isTTY: false,
        argv: ['--yes', '--remote', 'https://user:pass@github.com/org/repo.git'],
      }
    );
    expect(badRemote.ok).toBe(false);
  });

  it('rejects remote without git', async () => {
    const resolved = await resolveNewOptions(
      'ok-name',
      {
        yes: true,
        git: false,
        remote: 'https://github.com/org/repo.git',
      },
      {
        isTTY: false,
        argv: ['--yes', '--no-git', '--remote', 'https://github.com/org/repo.git'],
      }
    );
    expect(resolved.ok).toBe(false);
  });
});

describe('createNew', () => {
  /** @type {string} */
  let tmp;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-new-'));
  });

  afterEach(async () => {
    await fs.remove(tmp);
  });

  it('--dry-run writes nothing', async () => {
    const target = path.join(tmp, 'dry');
    const code = await createNew(
      'dry-app',
      { yes: true, dryRun: true, dir: target, git: false },
      {
        isTTY: false,
        argv: ['--yes', '--dry-run', '--no-git'],
        templatesRoot: defaultTemplatesRoot(),
        cwd: tmp,
        log: () => {},
        error: () => {},
        exec: vi.fn(),
        spawn: vi.fn(),
      }
    );
    expect(code).toBe(0);
    expect(await fs.pathExists(target)).toBe(false);
  });

  it('aborts when files would be overwritten', async () => {
    const target = path.join(tmp, 'conflict');
    await fs.ensureDir(target);
    await fs.writeFile(path.join(target, 'package.json'), '{}\n');
    const errors = [];
    const code = await createNew(
      'conflict',
      { yes: true, dir: target, git: false },
      {
        isTTY: false,
        argv: ['--yes', '--no-git'],
        templatesRoot: defaultTemplatesRoot(),
        cwd: tmp,
        log: () => {},
        error: (m) => errors.push(String(m)),
        exec: vi.fn(),
        spawn: vi.fn(),
      }
    );
    expect(code).toBe(1);
    expect(errors.join('\n')).toMatch(/overwrite/i);
    expect(errors.join('\n')).toContain('package.json');
  });

  it('scaffolds ts+scss with modules and rejects writing outside plan', async () => {
    const target = path.join(tmp, 'full');
    const exec = vi.fn(async () => ({ stdout: '', stderr: '', code: 0 }));
    const code = await createNew(
      'full-app',
      {
        yes: true,
        dir: target,
        git: true,
        remote: 'https://github.com/org/full-app.git',
        install: false,
        author: 'Test',
      },
      {
        isTTY: false,
        argv: [
          '--yes',
          '--git',
          '--remote',
          'https://github.com/org/full-app.git',
          '--no-install',
        ],
        templatesRoot: defaultTemplatesRoot(),
        cwd: tmp,
        log: () => {},
        error: () => {},
        exec,
        spawn: vi.fn(),
        cliVersion: '2.0.0',
      }
    );
    expect(code).toBe(0);
    expect(await fs.pathExists(path.join(target, 'package.json'))).toBe(true);
    expect(await fs.pathExists(path.join(target, 'src/main.ts'))).toBe(true);
    expect(await fs.pathExists(path.join(target, 'src/styles.scss'))).toBe(true);
    expect(await fs.pathExists(path.join(target, 'tsconfig.json'))).toBe(true);
    expect(await fs.pathExists(path.join(target, 'scripts/build.mjs'))).toBe(true);
    expect(await fs.pathExists(path.join(target, 'README.md'))).toBe(true);
    expect(await fs.pathExists(path.join(target, 'AGENTS.md'))).toBe(true);
    expect(await fs.pathExists(path.join(target, 'stagepass.json'))).toBe(true);

    const pkg = JSON.parse(await fs.readFile(path.join(target, 'package.json'), 'utf8'));
    expect(pkg.private).toBe(true);
    expect(pkg.scripts.build).toBeTruthy();
    expect(pkg.scripts.watch).toBeTruthy();
    expect(pkg.devDependencies['@stagepass/loader']).toBe('2.0.0');
    expect(pkg.devDependencies['@stagepass/modules']).toBe('2.0.0');
    expect(pkg.devDependencies.sass).toBeTruthy();
    expect(pkg.devDependencies.esbuild).toBeTruthy();

    const readme = await fs.readFile(path.join(target, 'README.md'), 'utf8');
    expect(readme).toContain('@stagepass/loader@2');
    expect(readme).toContain('data-stagepass-version="2.0.0"');

    expect(exec).toHaveBeenCalledWith('git', ['init'], expect.objectContaining({ cwd: target }));
    expect(exec).toHaveBeenCalledWith(
      'git',
      ['remote', 'add', 'origin', 'https://github.com/org/full-app.git'],
      expect.objectContaining({ cwd: target })
    );
  });

  it('scaffolds js+css without modules', async () => {
    const target = path.join(tmp, 'lite');
    const code = await createNew(
      'lite-app',
      {
        yes: true,
        dir: target,
        lang: 'js',
        styles: 'css',
        modules: false,
        git: false,
      },
      {
        isTTY: false,
        argv: ['--yes', '--lang', 'js', '--styles', 'css', '--no-modules', '--no-git'],
        templatesRoot: defaultTemplatesRoot(),
        cwd: tmp,
        log: () => {},
        error: () => {},
        exec: vi.fn(),
        spawn: vi.fn(),
        cliVersion: '2.0.0',
      }
    );
    expect(code).toBe(0);
    expect(await fs.pathExists(path.join(target, 'src/main.js'))).toBe(true);
    expect(await fs.pathExists(path.join(target, 'src/styles.css'))).toBe(true);
    expect(await fs.pathExists(path.join(target, 'jsconfig.json'))).toBe(true);
    const pkg = JSON.parse(await fs.readFile(path.join(target, 'package.json'), 'utf8'));
    expect(pkg.devDependencies['@stagepass/modules']).toBeUndefined();
    expect(pkg.devDependencies.sass).toBeUndefined();
    expect(pkg.devDependencies.typescript).toBeUndefined();
  });
});

describe('scaffold e2e build', () => {
  it('npm install && npm run build when STAGEPASS_E2E_SCAFFOLD=1', async () => {
    if (process.env.STAGEPASS_E2E_SCAFFOLD !== '1') {
      return;
    }

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-e2e-'));
    const target = path.join(tmp, 'e2e-app');
    try {
      const code = await createNew(
        'e2e-app',
        { yes: true, dir: target, git: false, install: false },
        {
          isTTY: false,
          argv: ['--yes', '--no-git', '--no-install'],
          templatesRoot: defaultTemplatesRoot(),
          cwd: tmp,
          log: () => {},
          error: () => {},
          exec: vi.fn(),
          spawn: vi.fn(),
          cliVersion: '2.0.0',
        }
      );
      expect(code).toBe(0);

      const { defaultSpawn } = await import('../../lib/spawn.js');
      const install = await defaultSpawn('npm', ['install'], {
        cwd: target,
        stdio: 'inherit',
        shell: false,
      });
      expect(install.code).toBe(0);

      const buildResult = await defaultSpawn('npm', ['run', 'build'], {
        cwd: target,
        stdio: 'inherit',
        shell: false,
      });
      expect(buildResult.code).toBe(0);
      expect(await fs.pathExists(path.join(target, 'dist/manifest.json'))).toBe(true);
      expect(await fs.pathExists(path.join(target, 'dist/main.js'))).toBe(true);
      expect(await fs.pathExists(path.join(target, 'dist/styles.css'))).toBe(true);
    } finally {
      await fs.remove(tmp);
    }
  }, 300_000);
});
