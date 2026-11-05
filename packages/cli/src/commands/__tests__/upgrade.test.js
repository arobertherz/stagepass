import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fsx from 'fs-extra';
import {
  applyStagepassVersions,
  findStagepassDeps,
  resolvePackageTarget,
  resolveUpgradeTargets,
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

  const pub = (latest, versions) => ({ distTags: { latest }, versions });

  it('defaults to ^<latest published>, never a staged version', () => {
    expect(resolvePackageTarget('@stagepass/loader', undefined, pub('2.0.0', ['1.2.0', '2.0.0'])).spec).toBe('^2.0.0');
    expect(resolvePackageTarget('@stagepass/loader', undefined, pub('2.2.0', ['2.0.0', '2.2.0'])).spec).toBe('^2.2.0');
    // latest moved to a new major: stay in 2.x (no breaking upgrade)
    expect(resolvePackageTarget('@stagepass/loader', undefined, pub('3.0.0', ['2.0.0', '2.3.1', '3.0.0'])).spec).toBe('^2.3.1');
  });

  it('falls back to ^2 offline', () => {
    expect(resolvePackageTarget('@stagepass/loader', undefined, null)).toEqual({ spec: '^2', resolved: null, offline: true });
  });

  it('rejects an explicit version that is not published (staged only)', () => {
    expect(() => resolvePackageTarget('@stagepass/loader', '2.2.0', pub('2.0.0', ['2.0.0']))).toThrow(/No published/);
    expect(() => resolvePackageTarget('@stagepass/loader', '^2.2.0', pub('2.0.0', ['2.0.0']))).toThrow(/No published/);
    expect(resolvePackageTarget('@stagepass/loader', '^2.0.0', pub('2.0.0', ['2.0.0'])).spec).toBe('^2.0.0');
    expect(resolvePackageTarget('@stagepass/loader', 'v2.0.0', pub('2.0.0', ['2.0.0'])).spec).toBe('2.0.0');
    expect(() => resolvePackageTarget('@stagepass/loader', '2.0.0', null)).toThrow(/offline/);
  });

  it('resolves dist-tags to their published version', () => {
    expect(resolvePackageTarget('@stagepass/loader', 'latest', pub('2.0.0', ['2.0.0'])).spec).toBe('2.0.0');
    expect(() => resolvePackageTarget('@stagepass/loader', 'next', pub('2.0.0', ['2.0.0']))).toThrow(/no dist-tag "next"/);
  });

  it('rejects unsafe literal --version values', () => {
    expect(() => resolvePackageTarget('@stagepass/loader', '2"><script>', pub('2.0.0', ['2.0.0']))).toThrow(/Invalid --version/);
  });

  it('resolveUpgradeTargets looks up each package once', async () => {
    const fetchPublished = vi.fn(async (name) => (name === '@stagepass/modules' ? pub('2.0.0', ['2.0.0']) : pub('2.2.0', ['2.0.0', '2.2.0'])));
    const { targets } = await resolveUpgradeTargets(undefined, ['@stagepass/loader', '@stagepass/modules', '@stagepass/loader'], { fetchPublished });
    expect(targets['@stagepass/loader'].spec).toBe('^2.2.0');
    expect(targets['@stagepass/modules'].spec).toBe('^2.0.0');
    expect(fetchPublished).toHaveBeenCalledTimes(2);
  });
});

describe('upgrade command', () => {
  /** @type {string} */
  let dir;
  beforeEach(async () => {
    dir = await fsx.mkdtemp(path.join(os.tmpdir(), 'sp-upgrade-'));
  });
  afterEach(async () => {
    await fsx.remove(dir);
  });

  const noProjects = async () => ({ projects: {} });
  const baseDeps = (logs, extra = {}) => ({
    cwd: dir,
    fetchPublished: async () => ({ distTags: { latest: '2.2.0' }, versions: ['2.0.0', '2.2.0'] }),
    log: (m) => logs.push(String(m ?? '')),
    isTTY: false,
    loadProjects: noProjects,
    detectSite: vi.fn(async () => {
      throw new Error('detectSite must not be called');
    }),
    ...extra,
  });

  async function oldStyleProject({ tsconfigTypes = ['@stagepass/loader'], agents = '# app\n\nNotes by me.\n', modulesDep = false } = {}) {
    const pkg = {
      name: 'app',
      devDependencies: { '@stagepass/loader': '^2.0.0', ...(modulesDep ? { '@stagepass/modules': '^2.0.0' } : {}) },
    };
    await fsx.writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
    await fsx.writeFile(path.join(dir, 'stagepass.json'), JSON.stringify({ name: 'app', modules: modulesDep, version: 1 }, null, 2) + '\n');
    await fsx.writeFile(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { strict: true, types: tsconfigTypes }, include: ['src'] }, null, 2) + '\n'
    );
    if (agents != null) await fsx.writeFile(path.join(dir, 'AGENTS.md'), agents);
  }

  it('writes package.json, stagepass.json, AGENTS.md, rule and types; never installs', async () => {
    await oldStyleProject({ modulesDep: true });
    const logs = [];
    const exec = vi.fn();
    const code = await upgrade({ siteModules: 'cookies' }, baseDeps(logs, { exec }));
    expect(code).toBe(0);
    expect(exec).not.toHaveBeenCalled();
    const pkg = await fsx.readJson(path.join(dir, 'package.json'));
    expect(pkg.devDependencies['@stagepass/loader']).toBe('^2.2.0');
    expect(pkg.devDependencies['@stagepass/modules']).toBe('^2.2.0');
    const sp = await fsx.readJson(path.join(dir, 'stagepass.json'));
    expect(sp.modules).toEqual(['cookies']);
    const agents = await fsx.readFile(path.join(dir, 'AGENTS.md'), 'utf8');
    expect(agents.startsWith('# app\n\nNotes by me.\n')).toBe(true);
    expect(agents).toContain('<!-- stagepass:begin -->');
    expect(agents).toContain('sp.cookies');
    const rule = await fsx.readFile(path.join(dir, '.cursor/rules/stagepass.mdc'), 'utf8');
    expect(rule).toContain('globs: src/**');
    const ts = await fsx.readJson(path.join(dir, 'tsconfig.json'));
    expect(ts.compilerOptions.types).toEqual(['@stagepass/loader', '@stagepass/modules/cookies']);
    expect(ts.compilerOptions.strict).toBe(true);
    expect(ts.include).toEqual(['src']);
    const out = logs.join('\n');
    expect(out).toContain('npm install');
    expect(out).toContain('@stagepass/modules@2/dist/cookies.min.js');
    expect(out).not.toContain('inject.min.js');
  });

  it('--dry-run prints the plan and writes nothing', async () => {
    await oldStyleProject();
    const before = await snapshot(dir);
    const logs = [];
    const code = await upgrade({ dryRun: true, siteModules: 'none' }, baseDeps(logs));
    expect(code).toBe(0);
    expect(await snapshot(dir)).toEqual(before);
    const out = logs.join('\n');
    expect(out).toContain('AGENTS.md: managed block added');
    expect(out).toContain('.cursor/rules/stagepass.mdc: created');
    expect(out).toContain('Dry run');
  });

  it('refreshes only the managed block on a second run', async () => {
    await oldStyleProject();
    await upgrade({ siteModules: 'all' }, baseDeps([]));
    const p = path.join(dir, 'AGENTS.md');
    const edited = (await fsx.readFile(p, 'utf8')) + '\nMy footer.\n';
    await fsx.writeFile(p, edited);
    await upgrade({ siteModules: 'none' }, baseDeps([]));
    const after = await fsx.readFile(p, 'utf8');
    expect(after).toContain('Notes by me.');
    expect(after).toContain('My footer.');
    expect(after.match(/<!-- stagepass:begin -->/g)).toHaveLength(1);
    expect(after).toContain('`sp.cookies`: not available');
    const ts = await fsx.readJson(path.join(dir, 'tsconfig.json'));
    expect(ts.compilerOptions.types).toEqual(['@stagepass/loader']);
  });

  it('creates AGENTS.md when missing', async () => {
    await oldStyleProject({ agents: null });
    await upgrade({ siteModules: 'none' }, baseDeps([]));
    const agents = await fsx.readFile(path.join(dir, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('<!-- stagepass:end -->');
  });

  it('skips a tsconfig with comments and prints a hint', async () => {
    await oldStyleProject();
    const raw = '{\n  // my comment\n  "compilerOptions": { "types": ["@stagepass/loader"] }\n}\n';
    await fsx.writeFile(path.join(dir, 'tsconfig.json'), raw);
    const logs = [];
    await upgrade({ siteModules: 'cookies' }, baseDeps(logs));
    expect(await fsx.readFile(path.join(dir, 'tsconfig.json'), 'utf8')).toBe(raw);
    expect(logs.join('\n')).toMatch(/tsconfig\.json.*comments/);
  });

  it('non-TTY without site or list keeps the existing list', async () => {
    await oldStyleProject();
    await fsx.writeJson(path.join(dir, 'stagepass.json'), { name: 'app', modules: ['maintenance'], version: 1 });
    const logs = [];
    await upgrade({}, baseDeps(logs));
    expect((await fsx.readJson(path.join(dir, 'stagepass.json'))).modules).toEqual(['maintenance']);
    expect(logs.join('\n')).toContain('inferred from stagepass.json');
  });

  it('non-TTY keeps legacy "modules": true as ["all"] with a hint', async () => {
    await oldStyleProject({ modulesDep: true, tsconfigTypes: ['@stagepass/loader', '@stagepass/modules'] });
    const logs = [];
    await upgrade({}, baseDeps(logs));
    expect((await fsx.readJson(path.join(dir, 'stagepass.json'))).modules).toEqual(['all']);
    const ts = await fsx.readJson(path.join(dir, 'tsconfig.json'));
    expect(ts.compilerOptions.types).toEqual(['@stagepass/loader', '@stagepass/modules']);
    const out = logs.join('\n');
    expect(out).toContain('legacy "modules": true');
    expect(out).toContain('--site-modules cookies');
  });

  it('non-TTY without anything falls back to [] with a hint', async () => {
    await oldStyleProject({ modulesDep: true });
    await fsx.writeJson(path.join(dir, 'stagepass.json'), { name: 'app', version: 1 });
    const logs = [];
    await upgrade({}, baseDeps(logs));
    expect((await fsx.readJson(path.join(dir, 'stagepass.json'))).modules).toEqual([]);
    const out = logs.join('\n');
    expect(out).toContain('Pass --site-modules');
    expect(out).toContain('does not show which module tags run');
  });

  it('uses live detection from the stagepass.json origin', async () => {
    await oldStyleProject();
    await fsx.writeJson(path.join(dir, 'stagepass.json'), { name: 'app', modules: [], origin: 'app.webflow.io', version: 1 });
    const detectSite = vi.fn(async () => ({
      ok: true,
      url: 'https://app.webflow.io/',
      loader: { version: '2', cdn: 'jsdelivr' },
      modules: [{ id: 'inject', version: '2', cdn: 'jsdelivr' }],
      list: ['inject'],
    }));
    const logs = [];
    await upgrade({}, baseDeps(logs, { detectSite }));
    expect(detectSite).toHaveBeenCalledWith('app.webflow.io');
    const sp = await fsx.readJson(path.join(dir, 'stagepass.json'));
    expect(sp.modules).toEqual(['inject']);
    expect(sp.origin).toBe('app.webflow.io');
  });

  it('asks interactively when the site is unreachable', async () => {
    await oldStyleProject();
    const detectSite = vi.fn(async () => ({ ok: false, error: 'Site did not answer within 5 s.' }));
    const answers = ['cookies, maintenance'];
    const rl = { question: vi.fn(async () => answers.shift() ?? ''), close: vi.fn() };
    const logs = [];
    const code = await upgrade(
      { site: 'app.webflow.io' },
      baseDeps(logs, { detectSite, isTTY: true, createReadline: () => rl })
    );
    expect(code).toBe(0);
    expect(rl.question).toHaveBeenCalledTimes(1);
    expect(rl.close).toHaveBeenCalled();
    const sp = await fsx.readJson(path.join(dir, 'stagepass.json'));
    expect(sp.modules).toEqual(['cookies', 'maintenance']);
    expect(sp.origin).toBe('app.webflow.io');
    expect(logs.join('\n')).toContain('did not answer');
  });

  it('rejects an unknown module name', async () => {
    await oldStyleProject();
    const logs = [];
    const code = await upgrade({ siteModules: 'cookies,evil' }, baseDeps(logs));
    expect(code).toBe(1);
  });

  it('rejects an http or credential site', async () => {
    await oldStyleProject();
    expect(await upgrade({ site: 'http://app.webflow.io' }, baseDeps([]))).toBe(1);
    expect(await upgrade({ site: 'https://u:p@app.webflow.io' }, baseDeps([]))).toBe(1);
  });
});

async function snapshot(root) {
  const out = {};
  const walk = async (d) => {
    for (const name of await fsx.readdir(d)) {
      const abs = path.join(d, name);
      const st = await fsx.stat(abs);
      if (st.isDirectory()) await walk(abs);
      else out[path.relative(root, abs)] = await fsx.readFile(abs, 'utf8');
    }
  };
  await walk(root);
  return out;
}

describe('upgrade: published versions only', () => {
  /** @type {string} */
  let dir;
  beforeEach(async () => {
    dir = await fsx.mkdtemp(path.join(os.tmpdir(), 'sp-upgrade-pub-'));
    await fsx.writeJson(path.join(dir, 'package.json'), {
      name: 'app',
      devDependencies: { '@stagepass/loader': '2.2.0', '@stagepass/modules': '2.2.0' },
    }, { spaces: 2 });
    await fsx.writeJson(path.join(dir, 'stagepass.json'), { name: 'app', modules: ['cookies'], version: 1 }, { spaces: 2 });
    await fsx.writeJson(path.join(dir, 'tsconfig.json'), {
      compilerOptions: { strict: true, types: ['@stagepass/loader', '@stagepass/modules/cookies'] },
    }, { spaces: 2 });
  });
  afterEach(async () => {
    await fsx.remove(dir);
  });
  const deps = (logs, fetchPublished) => ({
    cwd: dir,
    fetchPublished,
    log: (m) => logs.push(String(m ?? '')),
    isTTY: false,
    loadProjects: async () => ({ projects: {} }),
    detectSite: vi.fn(),
  });

  it('repairs an unpublished exact pin to the published range and umbrella types', async () => {
    const logs = [];
    const code = await upgrade({}, deps(logs, async () => ({ distTags: { latest: '2.0.0' }, versions: ['2.0.0'] })));
    expect(code).toBe(0);
    const pkg = await fsx.readJson(path.join(dir, 'package.json'));
    expect(pkg.devDependencies).toEqual({ '@stagepass/loader': '^2.0.0', '@stagepass/modules': '^2.0.0' });
    const ts = await fsx.readJson(path.join(dir, 'tsconfig.json'));
    expect(ts.compilerOptions.types).toEqual(['@stagepass/loader', '@stagepass/modules']);
    expect(logs.join('\n')).toMatch(/no per-module types yet/);
  });

  it('writes ^2 offline and keeps per-module types only if installed ones have them', async () => {
    const logs = [];
    const code = await upgrade({}, deps(logs, async () => null));
    expect(code).toBe(0);
    const pkg = await fsx.readJson(path.join(dir, 'package.json'));
    expect(pkg.devDependencies['@stagepass/loader']).toBe('^2');
    expect(logs.join('\n')).toMatch(/not reachable/);
    const ts = await fsx.readJson(path.join(dir, 'tsconfig.json'));
    expect(ts.compilerOptions.types).toEqual(['@stagepass/loader', '@stagepass/modules']);
  });

  it('refuses --version for an unpublished release and writes nothing', async () => {
    const before = await fsx.readFile(path.join(dir, 'package.json'), 'utf8');
    const logs = [];
    const code = await upgrade({ version: '2.2.0' }, deps(logs, async () => ({ distTags: { latest: '2.0.0' }, versions: ['2.0.0'] })));
    expect(code).toBe(1);
    expect(logs.join('\n')).toMatch(/No published @stagepass\/loader matches 2.2.0/);
    expect(await fsx.readFile(path.join(dir, 'package.json'), 'utf8')).toBe(before);
  });
});

describe('upgrade: snippet version is the resolved loader version (AC-14)', () => {
  /** @type {string} */
  let dir;
  beforeEach(async () => {
    dir = await fsx.mkdtemp(path.join(os.tmpdir(), 'sp-upgrade-snip-'));
    await fsx.writeJson(path.join(dir, 'stagepass.json'), { name: 'app', modules: ['cookies'], version: 1 }, { spaces: 2 });
    await fsx.writeJson(path.join(dir, 'tsconfig.json'), {
      compilerOptions: { strict: true, types: ['@stagepass/loader', '@stagepass/modules'] },
    }, { spaces: 2 });
  });
  afterEach(async () => {
    await fsx.remove(dir);
  });

  const writePkg = (devDependencies) => fsx.writeJson(path.join(dir, 'package.json'), { name: 'app', devDependencies }, { spaces: 2 });
  const published = (latest, versions) => vi.fn(async () => ({ distTags: { latest }, versions }));
  const run = async (options, fetchPublished) => {
    const logs = [];
    const code = await upgrade(options, {
      cwd: dir,
      fetchPublished,
      log: (m) => logs.push(String(m ?? '')),
      isTTY: false,
      loadProjects: async () => ({ projects: {} }),
      detectSite: vi.fn(async () => ({ ok: false, error: 'detectSite must not be called' })),
    });
    return { code, out: logs.join('\n') };
  };
  const snippetVersions = (text) => [...text.matchAll(/data-stagepass-version="([^"]*)"/g)].map((m) => m[1]);

  it('uses the latest published loader when package.json lists only @stagepass/modules', async () => {
    await writePkg({ '@stagepass/modules': '^2.0.0' });
    const { code, out } = await run({ siteModules: 'cookies' }, published('2.3.4', ['2.0.0', '2.2.0', '2.3.4']));
    expect(code).toBe(0);
    expect(snippetVersions(out)).toEqual(['2.3.4']);
  });

  it('uses the latest published loader when package.json lists the loader', async () => {
    await writePkg({ '@stagepass/loader': '^2.0.0', '@stagepass/modules': '^2.0.0' });
    const { code, out } = await run({ siteModules: 'cookies' }, published('2.3.4', ['2.0.0', '2.3.4']));
    expect(code).toBe(0);
    expect(snippetVersions(out)).toEqual(['2.3.4']);
  });

  it('stays on the 2.x line when latest moved to a new major', async () => {
    await writePkg({ '@stagepass/loader': '^2.0.0' });
    const { code, out } = await run({ siteModules: 'cookies' }, published('3.0.0', ['2.0.0', '2.3.4', '3.0.0']));
    expect(code).toBe(0);
    expect(snippetVersions(out)).toEqual(['2.3.4']);
  });

  it('offline uses the installed loader version', async () => {
    await writePkg({ '@stagepass/loader': '^2.0.0' });
    await fsx.outputJson(path.join(dir, 'node_modules/@stagepass/loader/package.json'), { name: '@stagepass/loader', version: '2.3.9' });
    const { code, out } = await run({ siteModules: 'cookies' }, async () => null);
    expect(code).toBe(0);
    expect(snippetVersions(out)).toEqual(['2.3.9']);
  });

  it('offline without an installed loader uses the bundled loader version', async () => {
    const { STAGEPASS_PACKAGES_VERSION } = await import('../../lib/versions.js');
    await writePkg({ '@stagepass/loader': '^2.0.0' });
    const { code, out } = await run({ siteModules: 'cookies' }, async () => null);
    expect(code).toBe(0);
    expect(snippetVersions(out)).toEqual([STAGEPASS_PACKAGES_VERSION]);
  });

  it('an explicit --version pin of the loader wins on the 2.x line', async () => {
    await writePkg({ '@stagepass/loader': '^2.0.0' });
    const { code, out } = await run({ siteModules: 'cookies', version: '2.2.0' }, published('2.3.4', ['2.2.0', '2.3.4']));
    expect(code).toBe(0);
    expect(snippetVersions(out)).toEqual(['2.2.0']);
  });

  it('a --version dist-tag on another major does not leave the 2.x line', async () => {
    await writePkg({ '@stagepass/loader': '^2.0.0' });
    const fetchPublished = vi.fn(async () => ({ distTags: { latest: '2.3.4', next: '3.0.0' }, versions: ['2.3.4', '3.0.0'] }));
    const { code, out } = await run({ siteModules: 'cookies', version: 'next' }, fetchPublished);
    expect(code).toBe(0);
    expect(snippetVersions(out)).toEqual(['2.3.4']);
  });

  it('prints the resolved version as exact pin example', async () => {
    await writePkg({ '@stagepass/modules': '^2.0.0' });
    const { code, out } = await run({ siteModules: 'cookies' }, published('2.3.4', ['2.3.4']));
    expect(code).toBe(0);
    expect(out).toContain('(e.g. @2.3.4)');
  });

  it('adds module tags only for declared modules', async () => {
    await writePkg({ '@stagepass/loader': '^2.0.0', '@stagepass/modules': '^2.0.0' });
    const { code, out } = await run({ siteModules: 'inject' }, published('2.3.4', ['2.3.4']));
    expect(code).toBe(0);
    expect(out).toContain('@stagepass/modules@2/dist/inject.min.js');
    expect(out).not.toContain('/dist/cookies.min.js');
    expect(out).not.toContain('/dist/all.min.js');
  });
});
