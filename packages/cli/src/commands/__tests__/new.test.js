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
    // Major range only: never derived from the CLI or a staged version.
    expect(pkg.devDependencies['@stagepass/loader']).toBe('^2');
    expect(pkg.devDependencies['@stagepass/modules']).toBe('^2');
    const sp = await fs.readJson(path.join(target, 'stagepass.json'));
    expect(sp.modules).toEqual(['cookies']);
    expect(sp.origin).toBeUndefined();
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

  it('wizard: asks for the site, confirms detected modules', async () => {
    const answers = ['shop', 'shop', 'Ada', 'ts', 'scss', 'shop.webflow.io', 'y', 'n', 'y'];
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
    expect(r.config).toMatchObject({ siteModules: ['all'], origin: 'shop.webflow.io', git: false, install: true });
  });

  it('wizard: unreachable site falls back to asking for the list', async () => {
    const answers = ['shop', 'shop', 'Ada', 'js', 'css', 'shop.webflow.io', 'cookies', 'n', 'n'];
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

describe('new: snippet version is the resolved loader version (AC-14)', () => {
  /** @type {string} */
  let tmp;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-snip-'));
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
        argv: ['--yes', '--no-git'],
        templatesRoot: defaultTemplatesRoot(),
        cwd: tmp,
        log: (m) => logs.push(String(m ?? '')),
        error: (m) => logs.push(String(m ?? '')),
        exec: vi.fn(async () => ({ stdout: '', stderr: '', code: 0 })),
        spawn: vi.fn(),
        ...extra,
      }
    ).then((code) => ({ code, out: logs.join('\n'), dir: path.join(tmp, name) }));
  };
  const published = (latest, versions) => vi.fn(async () => ({ distTags: { latest }, versions }));
  const snippetVersions = (text) => [...text.matchAll(/data-stagepass-version="([^"]*)"/g)].map((m) => m[1]);
  const expectSnippetVersion = async ({ out, dir }, version) => {
    const readme = await fs.readFile(path.join(dir, 'README.md'), 'utf8');
    expect(snippetVersions(out).length).toBeGreaterThan(0);
    expect(new Set(snippetVersions(out))).toEqual(new Set([version]));
    expect(new Set(snippetVersions(readme))).toEqual(new Set([version]));
  };

  it.each([
    ['cookies'],
    ['inject,maintenance'],
    ['none'],
    ['all'],
  ])('uses the latest published loader, never the CLI or bundled version (--site-modules %s)', async (mods) => {
    const r = await run(`snip-${mods.replace(/\W/g, '-')}`, { siteModules: mods }, {
      fetchPublished: published('2.3.4', ['2.0.0', '2.2.0', '2.3.4']),
      cliVersion: '2.2.1',
      packagesVersion: '2.2.0',
    });
    expect(r.code).toBe(0);
    await expectSnippetVersion(r, '2.3.4');
  });

  it('stays on the 2.x line when latest moved to a new major', async () => {
    const r = await run('snip-major', { siteModules: 'cookies' }, {
      fetchPublished: published('3.0.0', ['2.0.0', '2.3.4', '3.0.0']),
      cliVersion: '2.2.1',
    });
    expect(r.code).toBe(0);
    await expectSnippetVersion(r, '2.3.4');
  });

  it('offline uses the bundled loader version, never the CLI version', async () => {
    const { STAGEPASS_PACKAGES_VERSION } = await import('../../lib/versions.js');
    const r = await run('snip-offline', { siteModules: 'cookies' }, {
      fetchPublished: async () => null,
      cliVersion: '9.8.7',
    });
    expect(r.code).toBe(0);
    await expectSnippetVersion(r, STAGEPASS_PACKAGES_VERSION);
    expect(r.out).not.toContain('9.8.7');
  });

  it('adds module tags only for declared modules', async () => {
    const fetchPublished = published('2.3.4', ['2.3.4']);
    const a = await run('snip-tags', { siteModules: 'cookies,maintenance' }, { fetchPublished });
    expect(a.code).toBe(0);
    expect(a.out).toContain('@stagepass/modules@2/dist/cookies.min.js');
    expect(a.out).toContain('@stagepass/modules@2/dist/maintenance.min.js');
    expect(a.out).not.toContain('/dist/inject.min.js');
    expect(a.out).not.toContain('/dist/all.min.js');
    const b = await run('snip-none', { siteModules: 'none' }, { fetchPublished });
    expect(b.code).toBe(0);
    expect(b.out).not.toMatch(/<script src="[^"]*@stagepass\/modules/);
  });
});

describe('new: --site with an explicit port (AC-22)', () => {
  /** @type {string} */
  let tmp;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-port-'));
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await fs.remove(tmp);
  });

  const sites = [
    'shop.webflow.io:443',
    'https://shop.webflow.io:443',
    'https://shop.webflow.io:443/pfad',
    '[::1]:443',
    'https://[2001:db8::1]:8443/',
    'shop.webflow.io:8443',
  ];

  const run = async (site, extraOpts = {}) => {
    const fetch = vi.fn(async () => {
      throw new Error('no network in this test');
    });
    vi.stubGlobal('fetch', fetch);
    const detectSite = vi.fn(async () => ({ ok: false, error: 'detectSite must not be called' }));
    const fetchPublished = vi.fn(async () => null);
    const target = path.join(tmp, 'app');
    const code = await createNew(
      'port-app',
      { yes: true, dir: target, git: false, author: 'T', site, ...extraOpts },
      {
        isTTY: false,
        argv: ['--yes', '--no-git'],
        templatesRoot: defaultTemplatesRoot(),
        cwd: tmp,
        log: () => {},
        error: () => {},
        exec: vi.fn(async () => ({ stdout: '', stderr: '', code: 0 })),
        spawn: vi.fn(),
        detectSite,
        fetchPublished,
      }
    );
    return { code, fetch, detectSite, target };
  };

  it.each(sites)('rejects --site %s without network access and writes nothing', async (site) => {
    const { code, fetch, detectSite, target } = await run(site);
    expect(code).not.toBe(0);
    expect(detectSite).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(await fs.pathExists(target)).toBe(false);
  });

  it.each(sites)('rejects --site %s even with --site-modules', async (site) => {
    const { code, detectSite, target } = await run(site, { siteModules: 'cookies' });
    expect(code).not.toBe(0);
    expect(detectSite).not.toHaveBeenCalled();
    expect(await fs.pathExists(target)).toBe(false);
  });

  it('resolveNewOptions refuses host:443 before detection', async () => {
    const detectSite = vi.fn(async () => ({ ok: false, error: 'detectSite must not be called' }));
    const r = await resolveNewOptions(
      'shop',
      { yes: true, site: 'shop.webflow.io:443' },
      { isTTY: false, argv: ['--yes'], exec: async () => ({ stdout: '' }), detectSite, log: () => {} }
    );
    expect(r.ok).toBe(false);
    expect(detectSite).not.toHaveBeenCalled();
  });
});
