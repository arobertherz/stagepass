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
      php: false,
      phpExamples: false,
      linkAtEnd: false,
      author: 'Ada',
      productionSkipped: true,
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
        siteModules: 'cookies',
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
        fetchPublished: async () => ({ distTags: { latest: '2.2.0' }, versions: ['2.0.0', '2.2.0'] }),
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
    expect(pkg.scripts.dev).toBe('npm run watch');
    // Major range only: never derived from the CLI or a staged version.
    expect(pkg.devDependencies['@stagepass/loader']).toBe('^2');
    expect(pkg.devDependencies['@stagepass/modules']).toBe('^2');
    const sp = await fs.readJson(path.join(target, 'stagepass.json'));
    expect(sp.modules).toEqual(['cookies']);
    expect(sp.origin).toBeUndefined();
    expect(sp.php).toBe(false);
    expect(await fs.pathExists(path.join(target, 'api'))).toBe(false);
    const buildScript = await fs.readFile(path.join(target, 'scripts/build.mjs'), 'utf8');
    expect(buildScript).toContain('sha384-');
    expect(buildScript).toContain('sriSha384');
    const tsconfig = await fs.readJson(path.join(target, 'tsconfig.json'));
    expect(tsconfig.compilerOptions.types).toEqual(['@stagepass/loader', '@stagepass/modules/cookies']);
    const rule = await fs.readFile(path.join(target, '.cursor/rules/stagepass.mdc'), 'utf8');
    expect(rule).toContain('globs: src/**');
    expect(rule).toContain('if (sp.cookies)');
    const gitignore = await fs.readFile(path.join(target, '.gitignore'), 'utf8');
    expect(gitignore).toContain('node_modules/');
    expect(pkg.devDependencies.sass).toBeTruthy();
    expect(pkg.devDependencies.esbuild).toBeTruthy();

    const readme = await fs.readFile(path.join(target, 'README.md'), 'utf8');
    expect(readme).toContain('@stagepass/loader@2');
    // Resolved loader version (fetchPublished stub: latest 2.2.0), not the CLI version 2.0.0 (AC-14).
    expect(readme).toContain('data-stagepass-version="2.2.0"');
    expect(readme).not.toContain('data-stagepass-version="2.0.0"');
    expect(readme).not.toContain('unpkg.com');

    const agents = await fs.readFile(path.join(target, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js');
    expect(agents).toMatch(/unpkg serves the same paths/i);
    expect(agents).toContain('<!-- stagepass:begin -->');
    expect(agents).toContain('sp.cookies.bake');
    expect(agents).toContain('`sp.inject`: not available');
    expect(agents).toMatch(/Never call `sp\.<module>`/);
    expect(readme).toContain('@stagepass/modules@2/dist/cookies.min.js');
    expect(readme).not.toContain('inject.min.js');

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
    expect(await fs.pathExists(path.join(target, '.gitignore'))).toBe(true);
    const pkg = JSON.parse(await fs.readFile(path.join(target, 'package.json'), 'utf8'));
    expect(pkg.devDependencies['@stagepass/modules']).toBeUndefined();
    expect((await fs.readJson(path.join(target, 'stagepass.json'))).modules).toEqual([]);
    expect((await fs.readJson(path.join(target, 'jsconfig.json'))).compilerOptions.types).toEqual(['@stagepass/loader']);
    expect(await fs.pathExists(path.join(target, '.cursor/rules/stagepass.mdc'))).toBe(true);
    expect(pkg.devDependencies.sass).toBeUndefined();
    expect(pkg.devDependencies.typescript).toBeUndefined();
  });
});

describe('createNew INV-4 rollback', () => {
  /** @type {string} */
  let tmp;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-new-inv4-'));
  });
  afterEach(async () => {
    await fs.remove(tmp);
  });

  const baseDeps = (extra = {}) => ({
    isTTY: false,
    argv: ['--yes', '--no-git'],
    templatesRoot: defaultTemplatesRoot(),
    cwd: tmp,
    log: () => {},
    error: () => {},
    exec: vi.fn(async () => ({ stdout: '', stderr: '', code: 0 })),
    spawn: vi.fn(),
    fetchPublished: vi.fn(async () => ({ distTags: { latest: '2.4.0' }, versions: ['2.4.0'] })),
    ...extra,
  });

  it('refuses when src is a file and leaves the tree unchanged', async () => {
    const target = path.join(tmp, 'conflict');
    await fs.ensureDir(target);
    await fs.writeFile(path.join(target, 'src'), 'KEEP');
    const before = await fs.readFile(path.join(target, 'src'), 'utf8');
    const listing = await fs.readdir(target);
    const errors = [];
    const code = await createNew(
      'conflict',
      { yes: true, dir: target, git: false, siteModules: 'none' },
      baseDeps({ error: (m) => errors.push(String(m ?? '')) })
    );
    expect(code).toBe(1);
    expect(errors.join('\n')).toMatch(/Refusing to overwrite|src/i);
    expect(await fs.readFile(path.join(target, 'src'), 'utf8')).toBe(before);
    expect(await fs.readdir(target)).toEqual(listing);
    expect(errors.join('\n')).not.toMatch(/\n\s+at\s+/);
  });

  it('refuses when parent path is a file', async () => {
    const parent = path.join(tmp, 'afile');
    await fs.writeFile(parent, 'x');
    const errors = [];
    const code = await createNew(
      'child',
      { yes: true, dir: path.join(parent, 'child'), git: false, siteModules: 'none' },
      baseDeps({ error: (m) => errors.push(String(m ?? '')) })
    );
    expect(code).toBe(1);
    expect(errors.join('\n')).toMatch(/Parent path is a file/i);
    expect(await fs.pathExists(path.join(parent, 'child'))).toBe(false);
    expect(errors.join('\n')).not.toMatch(/\n\s+at\s+/);
  });

  it('rolls back on mid-loop write failure without a stacktrace', async () => {
    const target = path.join(tmp, 'partial');
    const errors = [];
    let writes = 0;
    const fse = {
      ...fs,
      writeFile: async (p, data, enc) => {
        writes += 1;
        if (writes === 3) {
          const err = new Error('ENOSPC');
          err.stack = 'Error: ENOSPC\n    at fake (test.js:1:1)';
          throw err;
        }
        return fs.writeFile(p, data, enc);
      },
    };
    const code = await createNew(
      'partial',
      { yes: true, dir: target, git: false, siteModules: 'none' },
      baseDeps({
        fs: fse,
        error: (m) => errors.push(String(m ?? '')),
      })
    );
    expect(code).toBe(1);
    expect(await fs.pathExists(target)).toBe(false);
    expect(errors.join('\n')).toMatch(/ENOSPC/);
    expect(errors.join('\n')).not.toMatch(/at fake/);
  });

  it('rolls back after git init failure', async () => {
    const target = path.join(tmp, 'gitfail');
    const errors = [];
    const code = await createNew(
      'gitfail',
      { yes: true, dir: target, git: true, siteModules: 'none' },
      baseDeps({
        argv: ['--yes', '--git'],
        error: (m) => errors.push(String(m ?? '')),
        exec: vi.fn(async (cmd, args) => {
          if (cmd === 'git' && args?.[0] === 'init') throw new Error('git init denied');
          return { stdout: '', stderr: '', code: 0 };
        }),
      })
    );
    expect(code).toBe(1);
    expect(await fs.pathExists(target)).toBe(false);
    expect(errors.join('\n')).toMatch(/Git setup failed/i);
    expect(errors.join('\n')).not.toMatch(/\n\s+at\s+/);
  });

  it('rolls back after npm install failure', async () => {
    const target = path.join(tmp, 'npmfail');
    const errors = [];
    const code = await createNew(
      'npmfail',
      { yes: true, dir: target, git: false, install: true, siteModules: 'none' },
      baseDeps({
        argv: ['--yes', '--no-git', '--install'],
        error: (m) => errors.push(String(m ?? '')),
        spawn: vi.fn(async () => ({ code: 17 })),
      })
    );
    expect(code).toBe(1);
    expect(await fs.pathExists(target)).toBe(false);
    expect(errors.join('\n')).toMatch(/npm install exited with code 17/i);
  });
});

describe('createNew robustness', () => {
  it('fails clearly and writes nothing when a template is missing', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-missing-'));
    const templates = path.join(tmp, 'templates');
    await fs.copy(defaultTemplatesRoot(), templates);
    await fs.remove(path.join(templates, 'gitignore'));
    const target = path.join(tmp, 'broken');
    const errors = [];
    const spawn = vi.fn();
    try {
      const code = await createNew(
        'broken-app',
        { yes: true, dir: target, git: false, install: true },
        {
          isTTY: false,
          argv: ['--yes', '--no-git', '--install'],
          templatesRoot: templates,
          cwd: tmp,
          log: () => {},
          error: (msg) => errors.push(String(msg)),
          exec: vi.fn(),
          spawn,
        }
      );
      expect(code).toBe(1);
      expect(errors.join('\n')).toMatch(/Template "gitignore" is missing/);
      expect(errors.join('\n')).toMatch(/Reinstall the CLI/);
      expect(await fs.pathExists(target)).toBe(false);
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      await fs.remove(tmp);
    }
  });

  it('defaults snippets to the loader/modules version, not the CLI version', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-ver-'));
    const target = path.join(tmp, 'ver');
    try {
      const code = await createNew(
        'ver-app',
        { yes: true, dir: target, git: false },
        {
          isTTY: false,
          argv: ['--yes', '--no-git'],
          templatesRoot: defaultTemplatesRoot(),
          cwd: tmp,
          log: () => {},
          error: () => {},
          exec: vi.fn(),
          spawn: vi.fn(),
        }
      );
      expect(code).toBe(0);
      const { STAGEPASS_PACKAGES_VERSION } = await import('../../lib/versions.js');
      const readme = await fs.readFile(path.join(target, 'README.md'), 'utf8');
      expect(readme).toContain(`data-stagepass-version="${STAGEPASS_PACKAGES_VERSION}"`);
    } finally {
      await fs.remove(tmp);
    }
  });
});

describe('new: dependency ranges and types vs. published versions', () => {
  /** @type {string} */
  let tmp;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-pub-'));
  });
  afterEach(async () => {
    await fs.remove(tmp);
  });

  const run = (name, opts, extra = {}) => {
    const logs = [];
    return createNew(
      name,
      { yes: true, dir: path.join(tmp, name), git: false, author: 'T', ...opts },
      {
        isTTY: false,
        argv: ['--yes', '--no-git', ...(opts.install ? ['--install'] : [])],
        templatesRoot: defaultTemplatesRoot(),
        cwd: tmp,
        log: (m) => logs.push(String(m ?? '')),
        error: (m) => logs.push(String(m ?? '')),
        exec: vi.fn(async () => ({ stdout: '', stderr: '', code: 0 })),
        spawn: vi.fn(),
        ...extra,
      }
    ).then((code) => ({ code, logs, dir: path.join(tmp, name) }));
  };
  const only200 = vi.fn(async () => ({ distTags: { latest: '2.0.0' }, versions: ['1.2.0', '2.0.0'] }));

  it('uses ^2 even when the CLI and packages are 2.2.x but only 2.0.0 is published', async () => {
    const { code, logs, dir } = await run('pub-a', { siteModules: 'cookies' }, {
      fetchPublished: only200,
      cliVersion: '2.2.1',
      packagesVersion: '2.2.0',
    });
    expect(code).toBe(0);
    const pkg = await fs.readJson(path.join(dir, 'package.json'));
    expect(pkg.devDependencies['@stagepass/loader']).toBe('^2');
    expect(pkg.devDependencies['@stagepass/modules']).toBe('^2');
    expect(JSON.stringify(pkg)).not.toContain('2.2');
    const ts = await fs.readJson(path.join(dir, 'tsconfig.json'));
    expect(ts.compilerOptions.types).toEqual(['@stagepass/loader', '@stagepass/modules']);
    expect(logs.join('\n')).toMatch(/no per-module types yet/);
    expect(only200).toHaveBeenCalledWith('@stagepass/modules', expect.anything());
  });

  it('falls back to the umbrella types offline', async () => {
    const { code, dir } = await run('pub-b', { siteModules: 'cookies,inject' }, {
      fetchPublished: async () => null,
    });
    expect(code).toBe(0);
    const ts = await fs.readJson(path.join(dir, 'tsconfig.json'));
    expect(ts.compilerOptions.types).toEqual(['@stagepass/loader', '@stagepass/modules']);
  });

  it('does not query @stagepass/modules for none or all', async () => {
    // The loader lookup for the snippet version is expected (AC-14); the
    // per-module types lookup of @stagepass/modules is not needed here.
    const fetchPublished = vi.fn(async () => null);
    for (const [name, mods] of [['pub-none', 'none'], ['pub-all', 'all']]) {
      const { code } = await run(name, { siteModules: mods }, { fetchPublished });
      expect(code).toBe(0);
    }
    expect(fetchPublished).not.toHaveBeenCalledWith('@stagepass/modules', expect.anything());
    expect(fetchPublished).toHaveBeenCalledWith('@stagepass/loader', expect.anything());
  });

  it('npm install succeeds with only 2.0.0 published and types follow the installed package', async () => {
    // Fake npm install: ^2 resolves to 2.0.0 (no per-module d.ts files).
    const spawn = vi.fn(async (_cmd, args, opts) => {
      expect(args).toEqual(['install']);
      const pkg = await fs.readJson(path.join(opts.cwd, 'package.json'));
      for (const name of ['@stagepass/loader', '@stagepass/modules']) {
        const range = pkg.devDependencies[name];
        // what npm does: a range no published version satisfies is ETARGET
        if (!['^2', '^2.0.0'].includes(range)) return { code: 1 };
        const dir = path.join(opts.cwd, 'node_modules', name);
        await fs.outputJson(path.join(dir, 'package.json'), { name, version: '2.0.0', types: 'global.d.ts' });
        await fs.outputFile(path.join(dir, 'global.d.ts'), 'export {};\n');
      }
      return { code: 0 };
    });
    // Registry claims 2.2.0 (e.g. stale cache) but the install got 2.0.0.
    const { code, logs, dir } = await run('pub-c', { siteModules: 'cookies', install: true }, {
      spawn,
      fetchPublished: async () => ({ distTags: { latest: '2.2.0' }, versions: ['2.0.0', '2.2.0'] }),
    });
    expect(code).toBe(0);
    expect(spawn).toHaveBeenCalledTimes(1);
    const ts = await fs.readJson(path.join(dir, 'tsconfig.json'));
    expect(ts.compilerOptions.types).toEqual(['@stagepass/loader', '@stagepass/modules']);
    expect(logs.join('\n')).toMatch(/no per-module types yet/);
  });

  it('switches to per-module types when the installed modules ship them', async () => {
    const spawn = vi.fn(async (_cmd, _args, opts) => {
      const dir = path.join(opts.cwd, 'node_modules', '@stagepass', 'modules');
      await fs.outputJson(path.join(dir, 'package.json'), { name: '@stagepass/modules', version: '2.2.0' });
      for (const id of ['inject', 'cookies', 'maintenance']) await fs.outputFile(path.join(dir, `${id}.d.ts`), 'export {};\n');
      return { code: 0 };
    });
    const { code, dir } = await run('pub-d', { siteModules: 'cookies', install: true }, {
      spawn,
      fetchPublished: only200,
    });
    expect(code).toBe(0);
    const ts = await fs.readJson(path.join(dir, 'tsconfig.json'));
    expect(ts.compilerOptions.types).toEqual(['@stagepass/loader', '@stagepass/modules/cookies']);
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
      const manifest = await fs.readJson(path.join(target, 'dist/manifest.json'));
      expect(manifest['main.js']).toMatchObject({
        file: expect.stringMatching(/^main\.[a-f0-9]{8}\.js$/),
        integrity: expect.stringMatching(/^sha384-[A-Za-z0-9+/=]+$/),
      });
      expect(manifest['styles.css']).toMatchObject({
        file: expect.stringMatching(/^styles\.[a-f0-9]{8}\.css$/),
        integrity: expect.stringMatching(/^sha384-[A-Za-z0-9+/=]+$/),
      });
    } finally {
      await fs.remove(tmp);
    }
  }, 300_000);
});

describe('new: declared modules', () => {
  const liveAll = vi.fn(async () => ({
    ok: true,
    url: 'https://shop.webflow.io/',
    loader: { version: '2', cdn: 'jsdelivr' },
    modules: [{ id: 'all', version: '2', cdn: 'jsdelivr' }],
    list: ['all'],
  }));

  it('--site detects modules non-interactively and stores origin', async () => {
    const logs = [];
    const r = await resolveNewOptions(
      'shop',
      { yes: true, site: 'https://shop.webflow.io/' },
      { isTTY: false, argv: ['--yes'], exec: async () => ({ stdout: '' }), detectSite: liveAll, log: (m) => logs.push(m) }
    );
    expect(r.ok).toBe(true);
    expect(r.config).toMatchObject({ siteModules: ['all'], origin: 'shop.webflow.io', modules: true });
    expect(liveAll).toHaveBeenCalledWith('shop.webflow.io');
    expect(logs.join('\n')).toContain('detected on shop.webflow.io');
  });

  it('--site-modules wins and never fetches', async () => {
    const detectSite = vi.fn();
    const r = await resolveNewOptions(
      'shop',
      { yes: true, site: 'shop.webflow.io', siteModules: 'inject,maintenance' },
      { isTTY: false, argv: ['--yes'], exec: async () => ({ stdout: '' }), detectSite, log: () => {} }
    );
    expect(r.config.siteModules).toEqual(['inject', 'maintenance']);
    expect(detectSite).not.toHaveBeenCalled();
  });

  it('defaults to none with a hint and rejects bad input', async () => {
    const logs = [];
    const r = await resolveNewOptions('shop', { yes: true }, { isTTY: false, argv: ['--yes'], exec: async () => ({ stdout: '' }), log: (m) => logs.push(String(m)) });
    expect(r.config.siteModules).toEqual([]);
    expect(logs.join('\n')).toContain('--site-modules');
    const bad = await resolveNewOptions('shop', { yes: true, siteModules: 'evil' }, { isTTY: false, argv: ['--yes'], exec: async () => ({ stdout: '' }) });
    expect(bad.ok).toBe(false);
    const http = await resolveNewOptions('shop', { yes: true, site: 'http://shop.webflow.io' }, { isTTY: false, argv: ['--yes'], exec: async () => ({ stdout: '' }) });
    expect(http.ok).toBe(false);
    const conflict = await resolveNewOptions('shop', { yes: true, siteModules: 'cookies' }, { isTTY: false, argv: ['--yes', '--no-modules'], exec: async () => ({ stdout: '' }) });
    expect(conflict.ok).toBe(false);
  });

  it('wizard: asks for staging/production, confirms detected modules', async () => {
    // name, dir, author, lang, styles, staging, production, use detected?, php, git, install
    const answers = ['shop', 'shop', 'Ada', 'ts', 'scss', 'shop.webflow.io', '', 'y', 'n', 'n', 'y'];
    const rl = { question: vi.fn(async () => answers.shift() ?? ''), close: vi.fn() };
    const r = await resolveNewOptions(undefined, {}, {
      isTTY: true,
      argv: [],
      exec: async () => ({ stdout: '' }),
      detectSite: liveAll,
      createReadline: () => rl,
      log: () => {},
    });
    expect(r.ok).toBe(true);
    expect(r.config).toMatchObject({
      siteModules: ['all'],
      origin: 'shop.webflow.io',
      git: false,
      install: true,
      php: false,
      productionSkipped: true,
    });
  });

  it('wizard: unreachable site falls back to asking for the list', async () => {
    // name, dir, author, lang, styles, staging, production, modules, php, git, install
    const answers = ['shop', 'shop', 'Ada', 'js', 'css', 'shop.webflow.io', '', 'cookies', 'n', 'n', 'n'];
    const rl = { question: vi.fn(async () => answers.shift() ?? ''), close: vi.fn() };
    const detectSite = vi.fn(async () => ({ ok: false, error: 'Site did not answer within 5 s.' }));
    const r = await resolveNewOptions(undefined, {}, {
      isTTY: true,
      argv: [],
      exec: async () => ({ stdout: '' }),
      detectSite,
      createReadline: () => rl,
      log: () => {},
    });
    expect(r.config.siteModules).toEqual(['cookies']);
  });
});

describe('new: origins, php, preflight', () => {
  it('accepts --staging and --production', async () => {
    const r = await resolveNewOptions(
      'shop',
      {
        yes: true,
        staging: 'shop.webflow.io',
        production: 'www.example.com',
        siteModules: 'none',
      },
      { isTTY: false, argv: ['--yes'], exec: async () => ({ stdout: '' }), log: () => {} }
    );
    expect(r.ok).toBe(true);
    expect(r.config).toMatchObject({
      origin: 'shop.webflow.io',
      production: 'www.example.com',
      productionSkipped: false,
    });
  });

  it('rejects conflicting --site and --staging', async () => {
    const r = await resolveNewOptions(
      'shop',
      { yes: true, site: 'a.webflow.io', staging: 'b.webflow.io' },
      { isTTY: false, argv: ['--yes'], exec: async () => ({ stdout: '' }) }
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/disagree/i);
  });

  it('rejects invalid staging / production hosts', async () => {
    const badStaging = await resolveNewOptions(
      'shop',
      { yes: true, staging: 'https://evil.example/path' },
      { isTTY: false, argv: ['--yes'], exec: async () => ({ stdout: '' }) }
    );
    expect(badStaging.ok).toBe(false);
    const badProd = await resolveNewOptions(
      'shop',
      { yes: true, production: 'http://example.com' },
      { isTTY: false, argv: ['--yes'], exec: async () => ({ stdout: '' }) }
    );
    expect(badProd.ok).toBe(false);
    const withPort = await resolveNewOptions(
      'shop',
      { yes: true, staging: 'example.com:443' },
      { isTTY: false, argv: ['--yes'], exec: async () => ({ stdout: '' }) }
    );
    expect(withPort.ok).toBe(false);
  });

  it.each([
    ['site', ' example.com'],
    ['site', 'example.com '],
    ['site', 'example.com\n'],
    ['site', 'example.com\t'],
    ['site', 'exa\tmple.com'],
    ['site', 'exa\nmple.com'],
    ['site', '\u0000example.com'],
    ['staging', ' example.com'],
    ['staging', 'example.com '],
    ['staging', 'example.com\n'],
    ['staging', 'example.com\t'],
    ['staging', 'exa\tmple.com'],
    ['staging', 'exa\nmple.com'],
    ['production', ' example.com'],
    ['production', 'example.com '],
    ['production', 'example.com\n'],
    ['production', 'example.com\t'],
    ['production', 'exa\tmple.com'],
    ['production', 'exa\nmple.com'],
  ])('rejects whitespace/controls on --%s %j before write/network (AC-10)', async (flag, value) => {
    const detectSite = vi.fn();
    const r = await resolveNewOptions(
      'shop',
      { yes: true, siteModules: 'none', [flag]: value },
      { isTTY: false, argv: ['--yes'], exec: async () => ({ stdout: '' }), detectSite, log: () => {} }
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/whitespace|control|Invalid/i);
    expect(detectSite).not.toHaveBeenCalled();
  });

  it('rejects --php-examples without --php', async () => {
    const r = await resolveNewOptions(
      'shop',
      { yes: true, php: false, phpExamples: true },
      { isTTY: false, argv: ['--yes', '--no-php', '--php-examples'], exec: async () => ({ stdout: '' }) }
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/php-examples/i);
  });

  it('dry-run lists php examples and production hint', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-dry-'));
    const logs = [];
    try {
      const code = await createNew(
        'dry-php',
        {
          yes: true,
          dryRun: true,
          dir: path.join(tmp, 'dry-php'),
          git: false,
          php: true,
          phpExamples: true,
          staging: 'dry.webflow.io',
          siteModules: 'none',
        },
        {
          isTTY: false,
          argv: ['--yes', '--no-git', '--php', '--php-examples', '--dry-run'],
          templatesRoot: defaultTemplatesRoot(),
          cwd: tmp,
          log: (m) => logs.push(String(m)),
          error: () => {},
          exec: vi.fn(),
          spawn: vi.fn(),
          platform: 'linux',
          detectSite: vi.fn(),
        }
      );
      expect(code).toBe(0);
      const joined = logs.join('\n');
      expect(joined).toContain('examples/php/form.php');
      expect(joined).toContain('examples/php/proxy.php');
      expect(joined).toContain('api/README.md');
      expect(joined).toMatch(/Production domain skipped/i);
      expect(await fs.pathExists(path.join(tmp, 'dry-php'))).toBe(false);
    } finally {
      await fs.remove(tmp);
    }
  });

  it('scaffolds php api and optional examples', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-php-'));
    const target = path.join(tmp, 'php-app');
    try {
      const logs = [];
      const code = await createNew(
        'php-app',
        {
          yes: true,
          dir: target,
          git: false,
          php: true,
          phpExamples: true,
          staging: 'php-app.webflow.io',
          production: 'www.example.com',
          siteModules: 'none',
        },
        {
          isTTY: false,
          argv: ['--yes', '--no-git', '--php', '--php-examples'],
          templatesRoot: defaultTemplatesRoot(),
          cwd: tmp,
          log: (m) => logs.push(String(m)),
          error: () => {},
          exec: vi.fn(),
          spawn: vi.fn(),
          platform: 'linux',
          detectSite: vi.fn(),
        }
      );
      expect(code).toBe(0);
      expect(await fs.pathExists(path.join(target, 'api/README.md'))).toBe(true);
      expect(await fs.pathExists(path.join(target, 'examples/php/form.php'))).toBe(true);
      expect(await fs.pathExists(path.join(target, 'examples/php/proxy.php'))).toBe(true);
      const form = await fs.readFile(path.join(target, 'examples/php/form.php'), 'utf8');
      expect(form).toContain('htmlspecialchars');
      expect(form).toContain('REQUEST_METHOD');
      const proxy = await fs.readFile(path.join(target, 'examples/php/proxy.php'), 'utf8');
      expect(proxy).toContain('STAGEPASS_PROXY_ALLOWLIST');
      expect(proxy).toContain('CURLOPT_FOLLOWLOCATION');
      expect(proxy).toContain('CURLPROTO_HTTPS');
      const sp = await fs.readJson(path.join(target, 'stagepass.json'));
      expect(sp).toMatchObject({
        origin: 'php-app.webflow.io',
        production: 'www.example.com',
        php: true,
      });
      expect(logs.join('\n')).not.toMatch(/Production domain skipped/i);
    } finally {
      await fs.remove(tmp);
    }
  });

  it('skips doctor preflight and link off macOS / non-interactive', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-pre-'));
    const target = path.join(tmp, 'pre');
    const runDoctor = vi.fn();
    const setup = vi.fn();
    const link = vi.fn();
    try {
      const code = await createNew(
        'pre-app',
        { yes: true, dir: target, git: false, link: true },
        {
          isTTY: false,
          argv: ['--yes', '--no-git', '--link'],
          templatesRoot: defaultTemplatesRoot(),
          cwd: tmp,
          log: () => {},
          error: () => {},
          exec: vi.fn(),
          spawn: vi.fn(),
          platform: 'linux',
          runDoctor,
          setup,
          link,
        }
      );
      expect(code).toBe(0);
      expect(runDoctor).not.toHaveBeenCalled();
      expect(setup).not.toHaveBeenCalled();
      expect(link).not.toHaveBeenCalled();
    } finally {
      await fs.remove(tmp);
    }
  });

  it('does not run doctor preflight on --dry-run (interactive macOS)', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-drypre-'));
    const runDoctor = vi.fn();
    const setup = vi.fn();
    try {
      const code = await createNew(
        'dry-pre',
        {
          dryRun: true,
          dir: path.join(tmp, 'dry-pre'),
          lang: 'ts',
          styles: 'scss',
          modules: false,
          git: false,
          install: false,
          author: 'Ada',
          staging: 'dry.webflow.io',
          siteModules: 'none',
        },
        {
          isTTY: true,
          argv: ['--dry-run', '--no-modules', '--no-git', '--no-install'],
          templatesRoot: defaultTemplatesRoot(),
          cwd: tmp,
          log: () => {},
          error: () => {},
          exec: async () => ({ stdout: 'Ada' }),
          spawn: vi.fn(),
          platform: 'darwin',
          runDoctor,
          setup,
          createReadline: () => ({
            question: vi.fn(async () => ''),
            close: vi.fn(),
          }),
        }
      );
      expect(code).toBe(0);
      expect(runDoctor).not.toHaveBeenCalled();
      expect(setup).not.toHaveBeenCalled();
    } finally {
      await fs.remove(tmp);
    }
  });

  it('validates options before doctor preflight (invalid staging skips doctor)', async () => {
    const runDoctor = vi.fn();
    const code = await createNew(
      'bad-pre',
      {
        dir: '/tmp/unused-bad-pre',
        lang: 'ts',
        styles: 'scss',
        modules: false,
        git: false,
        install: false,
        author: 'Ada',
        staging: ' example.com',
      },
      {
        isTTY: true,
        argv: ['--no-modules', '--no-git', '--no-install'],
        templatesRoot: defaultTemplatesRoot(),
        cwd: os.tmpdir(),
        log: () => {},
        error: () => {},
        exec: async () => ({ stdout: 'Ada' }),
        spawn: vi.fn(),
        platform: 'darwin',
        runDoctor,
        setup: vi.fn(),
        createReadline: () => ({ question: vi.fn(), close: vi.fn() }),
      }
    );
    expect(code).toBe(1);
    expect(runDoctor).not.toHaveBeenCalled();
  });

  it('skips doctor preflight when --yes even on a TTY (mutant gate)', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-yespre-'));
    const target = path.join(tmp, 'yespre');
    const runDoctor = vi.fn();
    try {
      const code = await createNew(
        'yes-pre',
        { yes: true, dir: target, git: false, siteModules: 'none' },
        {
          isTTY: true,
          argv: ['--yes', '--no-git'],
          templatesRoot: defaultTemplatesRoot(),
          cwd: tmp,
          log: () => {},
          error: () => {},
          exec: vi.fn(),
          spawn: vi.fn(),
          platform: 'darwin',
          runDoctor,
          setup: vi.fn(),
        }
      );
      expect(code).toBe(0);
      expect(runDoctor).not.toHaveBeenCalled();
    } finally {
      await fs.remove(tmp);
    }
  });

  it('continues when doctor preflight finds nothing to set up (mutant return 0)', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-okpre-'));
    const target = path.join(tmp, 'okpre');
    const runDoctor = vi.fn(async () => ({
      checks: [{ id: 'caddy', status: 'ok', message: 'ok' }],
      summary: { ok: 1, warn: 0, fail: 0, info: 0 },
      exitCode: 0,
      hints: [],
    }));
    const setup = vi.fn();
    const wizardAnswers = ['ok.webflow.io', '', 'n', 'n'];
    try {
      const code = await createNew(
        'ok-pre',
        {
          dir: target,
          lang: 'ts',
          styles: 'scss',
          modules: false,
          git: false,
          install: false,
          author: 'Ada',
        },
        {
          isTTY: true,
          argv: ['--no-modules', '--no-git', '--no-install', '--lang', 'ts', '--styles', 'scss'],
          templatesRoot: defaultTemplatesRoot(),
          cwd: tmp,
          log: () => {},
          error: () => {},
          exec: async () => ({ stdout: 'Ada' }),
          spawn: vi.fn(),
          platform: 'darwin',
          runDoctor,
          setup,
          createReadline: () => ({
            question: vi.fn(async () => wizardAnswers.shift() ?? ''),
            close: vi.fn(),
          }),
          link: vi.fn(),
        }
      );
      expect(code).toBe(0);
      expect(runDoctor).toHaveBeenCalled();
      expect(setup).not.toHaveBeenCalled();
      expect(await fs.pathExists(target)).toBe(true);
    } finally {
      await fs.remove(tmp);
    }
  });

  it('offers setup after failing doctor preflight on interactive macOS', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-doc-'));
    const target = path.join(tmp, 'doc');
    const setup = vi.fn(async () => {});
    const runDoctor = vi.fn(async () => ({
      checks: [{ id: 'caddy', status: 'fail', message: 'missing' }],
      summary: { ok: 0, warn: 0, fail: 1, info: 0 },
      exitCode: 1,
      hints: [],
    }));
    // setup?, staging, production, php, link?
    const wizardAnswers = ['n', 'doc.webflow.io', '', 'n', 'n'];
    const rl = {
      question: vi.fn(async () => wizardAnswers.shift() ?? ''),
      close: vi.fn(),
    };
    try {
      const code = await createNew(
        'doc-app',
        {
          dir: target,
          lang: 'ts',
          styles: 'scss',
          modules: false,
          git: false,
          install: false,
          author: 'Ada',
        },
        {
          isTTY: true,
          argv: ['--no-modules', '--no-git', '--no-install', '--lang', 'ts', '--styles', 'scss'],
          templatesRoot: defaultTemplatesRoot(),
          cwd: tmp,
          log: () => {},
          error: () => {},
          exec: async () => ({ stdout: 'Ada' }),
          spawn: vi.fn(),
          platform: 'darwin',
          runDoctor,
          setup,
          createReadline: () => rl,
          link: vi.fn(),
        }
      );
      expect(code).toBe(0);
      expect(runDoctor).toHaveBeenCalled();
      expect(setup).not.toHaveBeenCalled();
    } finally {
      await fs.remove(tmp);
    }
  });

  it('propagates link failure exit code for --link (files kept)', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-linkfail-'));
    const target = path.join(tmp, 'linkfail');
    const link = vi.fn(async () => 7);
    const logs = [];
    try {
      const code = await createNew(
        'linkfail-app',
        {
          yes: true,
          dir: target,
          git: false,
          link: true,
          staging: 'linkfail.webflow.io',
          siteModules: 'none',
        },
        {
          isTTY: false,
          argv: ['--yes', '--no-git', '--link'],
          templatesRoot: defaultTemplatesRoot(),
          cwd: tmp,
          log: (m) => logs.push(String(m ?? '')),
          error: () => {},
          exec: vi.fn(),
          spawn: vi.fn(),
          platform: 'darwin',
          link,
        }
      );
      expect(code).toBe(7);
      expect(link).toHaveBeenCalled();
      expect(await fs.pathExists(path.join(target, 'stagepass.json'))).toBe(true);
      expect(logs.join('\n')).toMatch(/link failed/i);
    } finally {
      await fs.remove(tmp);
    }
  });

  it('passes verbose:true to link only when --verbose (mutant !==)', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-linkverb-'));
    const target = path.join(tmp, 'linkverb');
    const link = vi.fn(async () => 0);
    try {
      await createNew(
        'linkverb-app',
        {
          yes: true,
          dir: target,
          git: false,
          link: true,
          verbose: true,
          staging: 'linkverb.webflow.io',
          siteModules: 'none',
        },
        {
          isTTY: false,
          argv: ['--yes', '--no-git', '--link', '--verbose'],
          templatesRoot: defaultTemplatesRoot(),
          cwd: tmp,
          log: () => {},
          error: () => {},
          exec: vi.fn(),
          spawn: vi.fn(),
          platform: 'darwin',
          link,
        }
      );
      expect(link).toHaveBeenCalledWith(
        'linkverb-app',
        expect.objectContaining({ verbose: true }),
        expect.anything()
      );
    } finally {
      await fs.remove(tmp);
    }
  });

  it('calls link on macOS with --link after scaffold', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-linknew-'));
    const target = path.join(tmp, 'linked');
    const link = vi.fn(async () => 0);
    try {
      const code = await createNew(
        'linked-app',
        {
          yes: true,
          dir: target,
          git: false,
          link: true,
          staging: 'linked-app.webflow.io',
          siteModules: 'none',
        },
        {
          isTTY: false,
          argv: ['--yes', '--no-git', '--link'],
          templatesRoot: defaultTemplatesRoot(),
          cwd: tmp,
          log: () => {},
          error: () => {},
          exec: vi.fn(),
          spawn: vi.fn(),
          platform: 'darwin',
          link,
          detectSite: vi.fn(),
        }
      );
      expect(code).toBe(0);
      expect(link).toHaveBeenCalledWith(
        'linked-app',
        expect.any(Object),
        expect.objectContaining({ cwd: target })
      );
    } finally {
      await fs.remove(tmp);
    }
  });
});
