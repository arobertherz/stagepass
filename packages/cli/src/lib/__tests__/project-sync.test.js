import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import {
  applyProjectSync,
  declaredModules,
  originsFromStagepassConfig,
  phpFromStagepassConfig,
  configCoversTypesFile,
  planProjectSync,
  renderStagepassTypesFile,
  resolveProjectOrigin,
  resolveUpgradeModules,
  STAGEPASS_TYPES_MARKER,
  updateConfigTypes,
} from '../project-sync.js';
import { BLOCK_BEGIN, BLOCK_END, buildAgentsPointerBlock } from '../ai-guide.js';

describe('configCoversTypesFile', () => {
  it('covers a root file when include and files are omitted, and a nested file under a directory include', () => {
    expect(configCoversTypesFile({ compilerOptions: {} }, 'stagepass.d.ts')).toBe(true);
    expect(configCoversTypesFile({ include: ['src'] }, 'src/stagepass.d.ts')).toBe(true);
    expect(configCoversTypesFile({ include: ['src/**/*.ts'] }, 'src/stagepass.d.ts')).toBe(true);
    expect(configCoversTypesFile({ include: ['src/**/*.ts'] }, 'stagepass.d.ts')).toBe(false);
    expect(configCoversTypesFile({ include: ['src/**/*.js'] }, 'src/stagepass.d.ts')).toBe(false);
    expect(configCoversTypesFile({ files: ['src/main.ts'] }, 'stagepass.d.ts')).toBe(false);
    expect(configCoversTypesFile({ files: ['stagepass.d.ts'], include: ['src'] }, 'stagepass.d.ts')).toBe(true);
    expect(configCoversTypesFile({ include: ['src'], exclude: ['src'] }, 'src/stagepass.d.ts')).toBe(false);
  });
});

describe('updateConfigTypes', () => {
  const ts = (types, extra = {}) =>
    JSON.stringify({ compilerOptions: { strict: true, types }, include: ['src'], ...extra }, null, 2) + '\n';

  it('replaces stagepass entries, keeps others and the rest of the JSON', () => {
    const r = updateConfigTypes(ts(['@stagepass/modules', '@stagepass/loader', 'vite/client']), ['cookies'], {
      modulesDependency: true,
    });
    expect(r.status).toBe('updated');
    const json = JSON.parse(r.content);
    expect(json.compilerOptions.types).toEqual(['@stagepass/loader', '@stagepass/modules/cookies', 'vite/client']);
    expect(json.compilerOptions.strict).toBe(true);
    expect(json.include).toEqual(['src']);
    expect(r.content.endsWith('\n')).toBe(true);
  });
  it('unchanged when already correct', () => {
    expect(updateConfigTypes(ts(['@stagepass/loader']), [], { modulesDependency: true }).status).toBe('unchanged');
  });
  it('skips JSONC with a hint', () => {
    const r = updateConfigTypes('{\n  /* c */ "compilerOptions": {}\n}', [], { modulesDependency: true });
    expect(r).toMatchObject({ status: 'skipped' });
    expect(r.reason).toMatch(/comments/);
  });
  it('skips when there is no types array', () => {
    const r = updateConfigTypes(JSON.stringify({ compilerOptions: {} }), [], { modulesDependency: true });
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/no compilerOptions.types/);
  });

  // F-11: `!json || typeof json !== 'object' || Array.isArray(json)` — null and JSON strings are not objects.
  it.each([['null'], ['"hello"']])('[F-11] skips non-object JSON %s', (raw) => {
    const r = updateConfigTypes(raw, [], { modulesDependency: true });
    expect(r).toMatchObject({ status: 'skipped', reason: 'is not a JSON object' });
  });
});

describe('declaredModules', () => {
  it('reads lists and ignores the legacy boolean', () => {
    expect(declaredModules({ modules: ['cookies'] })).toEqual(['cookies']);
    expect(declaredModules({ modules: [] })).toEqual([]);
    expect(declaredModules({ modules: true })).toBeNull();
    expect(declaredModules(null)).toBeNull();
  });
});

describe('planProjectSync / applyProjectSync', () => {
  let dir;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-sync-'));
  });
  afterEach(async () => fs.remove(dir));

  it('creates stagepass.json, AGENTS.md and the rule in an empty project', async () => {
    const plan = await planProjectSync({ cwd: dir, modules: [], pkg: { name: 'demo' } });
    expect(plan.writes.map((w) => w.file).sort()).toEqual([
      '.cursor/rules/stagepass.mdc',
      'AGENTS.md',
      'AGENTS.stagepass.md',
      'stagepass.d.ts',
      'stagepass.json',
    ]);
    expect(plan.writes.find((w) => w.file === 'AGENTS.md').content).toBe(
      `# demo (Stagepass project)\n\n${buildAgentsPointerBlock()}\n`
    );
    const guide = plan.writes.find((w) => w.file === 'AGENTS.stagepass.md').content;
    expect(guide).toContain('stagepass:managed');
    expect(guide).not.toContain('\n## PHP\n');
    expect(plan.writes.find((w) => w.file === 'stagepass.d.ts').content).toBe(renderStagepassTypesFile(['@stagepass/loader']));
    expect(plan.writes.find((w) => w.file === 'stagepass.d.ts').content).toContain(STAGEPASS_TYPES_MARKER);
    expect(plan.notes.join('\n')).toContain('No tsconfig.json or jsconfig.json:');
    await applyProjectSync(dir, plan.writes);
    expect(await fs.readJson(path.join(dir, 'stagepass.json'))).toEqual({ name: 'demo', modules: [], version: 1 });
    const again = await planProjectSync({ cwd: dir, modules: [], pkg: { name: 'demo' } });
    expect(again.writes).toEqual([]);
  });

  it('leaves a foreign cursor rule and broken AGENTS markers alone', async () => {
    await fs.outputFile(path.join(dir, '.cursor/rules/stagepass.mdc'), 'my own rule\n');
    await fs.writeFile(path.join(dir, 'AGENTS.md'), '<!-- stagepass:begin -->\nhalf\n');
    const plan = await planProjectSync({ cwd: dir, modules: ['cookies'], pkg: {} });
    expect(plan.writes.map((w) => w.file)).toEqual(['stagepass.json', 'AGENTS.stagepass.md', 'stagepass.d.ts']);
    const notes = plan.notes.join('\n');
    expect(notes).toContain('without stagepass markers');
    expect(notes).toContain('markers are incomplete');
    expect(notes).toContain('need @stagepass/modules');
  });

  it('keeps unrelated stagepass.json keys and stores origin', async () => {
    await fs.writeJson(path.join(dir, 'stagepass.json'), { name: 'x', custom: 1, modules: true, version: 1 });
    const plan = await planProjectSync({ cwd: dir, modules: ['all'], origin: 'x.webflow.io', pkg: {} });
    const sp = JSON.parse(plan.writes.find((w) => w.file === 'stagepass.json').content);
    expect(sp).toEqual({ name: 'x', custom: 1, modules: ['all'], version: 1, origin: 'x.webflow.io' });
  });

  it('refuses writes outside the project', async () => {
    await expect(applyProjectSync(dir, [{ file: '../evil', content: '' }])).rejects.toThrow(/outside/);
  });

  it('[P-2][INV-3] skips symlinked targets with a note', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-sync-out-'));
    try {
      const agentsOutside = path.join(outside, 'AGENTS.md');
      const guideOutside = path.join(outside, 'AGENTS.stagepass.md');
      const tsOutside = path.join(outside, 'tsconfig.json');
      const cursorOutside = path.join(outside, 'cursor-target');
      await fs.writeFile(agentsOutside, '# secret outside\n');
      await fs.writeFile(guideOutside, '# secret guide\n');
      await fs.writeFile(
        tsOutside,
        JSON.stringify({ compilerOptions: { types: ['@stagepass/loader'] } }, null, 2) + '\n'
      );
      await fs.mkdir(cursorOutside);
      await fs.symlink(agentsOutside, path.join(dir, 'AGENTS.md'));
      await fs.symlink(guideOutside, path.join(dir, 'AGENTS.stagepass.md'));
      await fs.symlink(tsOutside, path.join(dir, 'tsconfig.json'));
      await fs.symlink(cursorOutside, path.join(dir, '.cursor'));

      const agentsBefore = await fs.readFile(agentsOutside, 'utf8');
      const guideBefore = await fs.readFile(guideOutside, 'utf8');
      const tsBefore = await fs.readFile(tsOutside, 'utf8');
      const cursorListing = await fs.readdir(cursorOutside);

      const plan = await planProjectSync({
        cwd: dir,
        modules: ['cookies'],
        pkg: { name: 'demo', devDependencies: { '@stagepass/modules': '^2.2.0' } },
      });
      expect(plan.notes.some((n) => n === 'AGENTS.md is a symlink; left unchanged')).toBe(true);
      expect(plan.notes.some((n) => n === 'AGENTS.stagepass.md is a symlink; left unchanged')).toBe(true);
      expect(plan.notes.some((n) => n === 'tsconfig.json is a symlink; left unchanged')).toBe(true);
      expect(plan.notes.some((n) => n.includes('.cursor/rules/stagepass.mdc') && n.includes('symlink'))).toBe(
        true
      );
      expect(plan.writes.map((w) => w.file)).not.toContain('AGENTS.md');
      expect(plan.writes.map((w) => w.file)).not.toContain('AGENTS.stagepass.md');
      expect(plan.writes.map((w) => w.file)).not.toContain('tsconfig.json');
      expect(plan.writes.map((w) => w.file)).not.toContain('.cursor/rules/stagepass.mdc');

      await applyProjectSync(dir, plan.writes);
      expect(await fs.readFile(agentsOutside, 'utf8')).toBe(agentsBefore);
      expect(await fs.readFile(guideOutside, 'utf8')).toBe(guideBefore);
      expect(await fs.readFile(tsOutside, 'utf8')).toBe(tsBefore);
      expect(await fs.readdir(cursorOutside)).toEqual(cursorListing);

      await expect(
        applyProjectSync(dir, [{ file: 'AGENTS.md', content: 'hijack\n' }])
      ).rejects.toThrow(/symlink/);
      await expect(
        applyProjectSync(dir, [{ file: 'AGENTS.stagepass.md', content: 'hijack\n' }])
      ).rejects.toThrow(/symlink/);
    } finally {
      await fs.remove(outside);
    }
  });

  it('replaces a large managed block and keeps user text byte for byte', async () => {
    const before = '# Mine\n\nKeep me.\n\n## Stagepass feature set\n\nold generated outside\n\n';
    const after = '\nTrailing note.\n';
    await fs.writeFile(
      path.join(dir, 'AGENTS.md'),
      `${before}${BLOCK_BEGIN}\nhuge api sp.cookies.bake\n${BLOCK_END}${after}`
    );
    const plan = await planProjectSync({ cwd: dir, modules: ['cookies'], pkg: { name: 'demo' } });
    const agents = plan.writes.find((w) => w.file === 'AGENTS.md');
    expect(agents.content.startsWith(before)).toBe(true);
    expect(agents.content.endsWith(after)).toBe(true);
    expect(agents.content).toContain('read `AGENTS.stagepass.md`');
    expect(agents.content).not.toContain('huge api');
    expect(agents.content).not.toContain('sp.cookies.bake');
    expect(plan.notes.join('\n')).toContain('older generated');
    const guide = plan.writes.find((w) => w.file === 'AGENTS.stagepass.md').content;
    expect(guide).toContain('sp.cookies.bake');
  });

  it('leaves a hand-edited AGENTS.stagepass.md without --yes and replaces it with --yes', async () => {
    const first = await planProjectSync({ cwd: dir, modules: [], pkg: { name: 'demo' } });
    await applyProjectSync(dir, first.writes);
    const file = path.join(dir, 'AGENTS.stagepass.md');
    const hand = `${await fs.readFile(file, 'utf8')}hand edited\n`;
    await fs.writeFile(file, hand);

    const blocked = await planProjectSync({ cwd: dir, modules: [], pkg: { name: 'demo' } });
    expect(blocked.writes.map((w) => w.file)).not.toContain('AGENTS.stagepass.md');
    expect(blocked.notes.join('\n')).toContain('stagepass upgrade --yes');
    expect(await fs.readFile(file, 'utf8')).toBe(hand);

    const asked = await planProjectSync({
      cwd: dir,
      modules: [],
      pkg: { name: 'demo' },
      interactive: true,
      confirm: async () => false,
    });
    expect(asked.writes.map((w) => w.file)).not.toContain('AGENTS.stagepass.md');
    expect(asked.notes.join('\n')).toContain('left unchanged');

    const allowed = await planProjectSync({
      cwd: dir,
      modules: [],
      pkg: { name: 'demo' },
      assumeYes: true,
    });
    expect(allowed.writes.find((w) => w.file === 'AGENTS.stagepass.md').action).toBe('replaced hand-edited file');
    await applyProjectSync(dir, allowed.writes);
    const replaced = await fs.readFile(file, 'utf8');
    expect(replaced).not.toContain('hand edited');
    expect(replaced.startsWith('<!-- stagepass:managed cli=')).toBe(true);

    const again = await planProjectSync({ cwd: dir, modules: [], pkg: { name: 'demo' } });
    expect(again.writes).toEqual([]);
  });

  it('leaves a guide with no managed header unless --yes', async () => {
    await fs.writeFile(path.join(dir, 'AGENTS.stagepass.md'), '# my own guide\n');
    const blocked = await planProjectSync({ cwd: dir, modules: [], pkg: { name: 'demo' } });
    expect(blocked.writes.map((w) => w.file)).not.toContain('AGENTS.stagepass.md');
    expect(await fs.readFile(path.join(dir, 'AGENTS.stagepass.md'), 'utf8')).toBe('# my own guide\n');
    const allowed = await planProjectSync({ cwd: dir, modules: [], pkg: { name: 'demo' }, assumeYes: true });
    expect(allowed.writes.find((w) => w.file === 'AGENTS.stagepass.md').content).toContain('stagepass:managed');
  });

  it('migrates a generated cursor rule and leaves a foreign one', async () => {
    const old = [
      '---',
      'description: Stagepass runtime API (sp) for this Webflow project',
      'globs: src/**',
      'alwaysApply: false',
      '---',
      '',
      `${BLOCK_BEGIN}`,
      'old api',
      `${BLOCK_END}`,
      'User tail',
      '',
    ].join('\n');
    await fs.outputFile(path.join(dir, '.cursor/rules/stagepass.mdc'), old);
    const plan = await planProjectSync({ cwd: dir, modules: [], pkg: { name: 'demo' } });
    const rule = plan.writes.find((w) => w.file === '.cursor/rules/stagepass.mdc').content;
    expect(rule).toContain('alwaysApply: true');
    expect(rule).not.toContain('globs:');
    expect(rule).toContain('@AGENTS.stagepass.md');
    expect(rule).not.toContain('old api');
    expect(rule.endsWith('User tail\n')).toBe(true);

    await fs.outputFile(path.join(dir, '.cursor/rules/stagepass.mdc'), 'my own rule\n');
    const foreign = await planProjectSync({ cwd: dir, modules: [], pkg: { name: 'demo' } });
    expect(foreign.writes.map((w) => w.file)).not.toContain('.cursor/rules/stagepass.mdc');
    expect(foreign.notes.join('\n')).toContain('without stagepass markers');
  });

  it('points CLAUDE.md at the guide only when the file already exists', async () => {
    const missing = await planProjectSync({ cwd: dir, modules: [], pkg: { name: 'demo' } });
    expect(missing.writes.map((w) => w.file)).not.toContain('CLAUDE.md');
    await fs.writeFile(path.join(dir, 'CLAUDE.md'), '# Claude\n\nKeep.\n');
    const plan = await planProjectSync({ cwd: dir, modules: [], pkg: { name: 'demo' } });
    const claude = plan.writes.find((w) => w.file === 'CLAUDE.md').content;
    expect(claude.startsWith('# Claude\n\nKeep.\n')).toBe(true);
    expect(claude).toContain('AGENTS.stagepass.md');
  });

  it('omits the PHP section when php is false and warns when the boilerplate is missing', async () => {
    await fs.writeJson(path.join(dir, 'stagepass.json'), { name: 'demo', modules: [], php: false, version: 1 });
    const off = await planProjectSync({ cwd: dir, modules: ['cookies'], pkg: { name: 'demo' } });
    expect(off.writes.find((w) => w.file === 'AGENTS.stagepass.md').content).not.toContain('\n## PHP\n');
    expect(off.notes.join('\n')).not.toContain('api/lib/');

    await fs.writeJson(path.join(dir, 'stagepass.json'), {
      name: 'demo',
      modules: ['all'],
      php: true,
      lang: 'ts',
      origin: 'demo.webflow.io',
      production: 'www.example.com',
      version: 1,
    });
    const missing = await planProjectSync({
      cwd: dir,
      modules: ['all'],
      pkg: { name: 'demo', devDependencies: { '@stagepass/modules': '^2.2.0' } },
    });
    const guide = missing.writes.find((w) => w.file === 'AGENTS.stagepass.md').content;
    expect(guide).toContain('Do not rebuild');
    expect(guide).not.toContain('load_dotenv(');
    expect(guide).toContain('if (sp.inject)');
    expect(guide).toContain('if (sp.maintenance');
    expect(missing.notes.join('\n')).toContain('api/lib/');
    expect(await fs.pathExists(path.join(dir, 'api', 'lib'))).toBe(false);
  });
});

describe('originsFromStagepassConfig / phpFromStagepassConfig', () => {
  it('collects origin and production hosts', () => {
    expect(
      originsFromStagepassConfig({
        origin: 'a.webflow.io',
        production: 'www.example.com',
      })
    ).toEqual(['a.webflow.io', 'www.example.com']);
    expect(originsFromStagepassConfig({ origin: 'https://bad.example/path' })).toEqual([]);
    expect(
      originsFromStagepassConfig({
        origin: 'ok.webflow.io',
        production: 'https://bad.example/path',
      })
    ).toEqual(['ok.webflow.io']);
    expect(phpFromStagepassConfig({ php: false })).toBe(false);
    expect(phpFromStagepassConfig({ php: true })).toBe(true);
    expect(phpFromStagepassConfig({})).toBeUndefined();
  });
});

describe('resolveProjectOrigin', () => {
  it('warns when a stored origin is skipped because of a port (F-6)', async () => {
    const logs = [];
    const found = await resolveProjectOrigin(
      '/p',
      { origin: 'a.webflow.io:443' },
      { log: (m) => logs.push(String(m)) }
    );
    expect(found).toBeNull();
    expect(logs.join('\n')).toMatch(/stagepass\.json origin/);
    expect(logs.join('\n')).toMatch(/port/);
  });

  it('prefers stagepass.json origin, else the linked project', async () => {
    expect(await resolveProjectOrigin('/p', { origin: 'a.webflow.io' })).toEqual({ origin: 'a.webflow.io', source: 'stagepass.json' });
    const loadProjects = async () => ({
      projects: { p: { root: '/p', origins: ['*.webflow.io', 'b.webflow.io'] } },
    });
    expect(await resolveProjectOrigin('/p', {}, { loadProjects, realpath: async (x) => x })).toEqual({
      origin: 'b.webflow.io',
      source: 'stagepass link',
    });
    expect(await resolveProjectOrigin('/other', {}, { loadProjects, realpath: async (x) => x })).toBeNull();
  });

  it('[R5 F-05] null stagepass.json data does not throw; falls back to link origin or null', async () => {
    const loadProjects = async () => ({
      projects: {
        p: { root: '/proj', origins: ['linked.webflow.io'] },
      },
    });
    await expect(
      resolveProjectOrigin('/proj', null, {
        loadProjects,
        realpath: async (x) => x,
      })
    ).resolves.toEqual({ origin: 'linked.webflow.io', source: 'stagepass link' });
    await expect(
      resolveProjectOrigin('/other', null, {
        loadProjects,
        realpath: async (x) => x,
      })
    ).resolves.toBeNull();
  });

  it('[R5 F-05] realpath maps cwd to linked root; throw keeps resolved cwd', async () => {
    const loadProjects = async () => ({
      projects: {
        p: { root: '/real/proj', origins: ['via-realpath.webflow.io'] },
      },
    });
    await expect(
      resolveProjectOrigin('/alias/proj', {}, {
        loadProjects,
        realpath: async (p) =>
          p === '/alias/proj' || p.endsWith('/alias/proj')
            ? '/real/proj'
            : p,
      })
    ).resolves.toEqual({
      origin: 'via-realpath.webflow.io',
      source: 'stagepass link',
    });

    const loadSame = async () => ({
      projects: {
        p: { root: '/same', origins: ['fallback.webflow.io'] },
      },
    });
    await expect(
      resolveProjectOrigin('/same', {}, {
        loadProjects: loadSame,
        realpath: async () => {
          throw new Error('ENOENT');
        },
      })
    ).resolves.toEqual({
      origin: 'fallback.webflow.io',
      source: 'stagepass link',
    });
  });
});

describe('resolveUpgradeModules precedence', () => {
  const det = (list, loader = true) =>
    vi.fn(async () => ({ ok: true, url: 'https://s.io/', loader: loader ? { version: '2', cdn: 'jsdelivr' } : null, modules: list.map((id) => ({ id, version: '2', cdn: 'jsdelivr' })), list }));
  const base = (extra) => ({
    detectSite: det(['cookies']),
    interactive: false,
    log: () => {},
    loadProjects: async () => ({ projects: {} }),
    ...extra,
  });

  it('flag wins over detection', async () => {
    const deps = base();
    const r = await resolveUpgradeModules({ cwd: '/p', data: { origin: 's.io' }, pkg: {}, options: { siteModules: 'all' } }, deps);
    expect(r).toMatchObject({ ok: true, modules: ['all'], source: '--site-modules' });
    expect(deps.detectSite).not.toHaveBeenCalled();
  });
  it('detection wins over stagepass.json', async () => {
    const r = await resolveUpgradeModules({ cwd: '/p', data: { origin: 's.io', modules: [] }, pkg: {}, options: {} }, base());
    expect(r).toMatchObject({ modules: ['cookies'], source: 'live site s.io' });
  });
  it('a page without the loader falls back to stagepass.json', async () => {
    const r = await resolveUpgradeModules(
      { cwd: '/p', data: { origin: 's.io', modules: ['inject'] }, pkg: {}, options: {} },
      base({ detectSite: det([], false) })
    );
    expect(r).toMatchObject({ modules: ['inject'], source: 'stagepass.json' });
  });
  it('--skip-site does not fetch', async () => {
    const deps = base();
    const r = await resolveUpgradeModules({ cwd: '/p', data: { origin: 's.io' }, pkg: {}, options: { skipSite: true } }, deps);
    expect(deps.detectSite).not.toHaveBeenCalled();
    expect(r.modules).toEqual([]);
  });
  it('interactive: confirm detected, or ask when declined', async () => {
    let r = await resolveUpgradeModules(
      { cwd: '/p', data: { origin: 's.io' }, pkg: {}, options: {} },
      base({ interactive: true, confirm: async () => true, ask: vi.fn() })
    );
    // F-11: confirm yes must return `{ ok: true, ... }` (not ok: false).
    expect(r).toMatchObject({ ok: true, modules: ['cookies'], source: 'live site s.io' });
    const ask = vi.fn().mockResolvedValueOnce('bogus').mockResolvedValueOnce('maintenance');
    r = await resolveUpgradeModules(
      { cwd: '/p', data: { origin: 's.io' }, pkg: {}, options: {} },
      base({ interactive: true, confirm: async () => false, ask })
    );
    expect(r).toMatchObject({ ok: true, modules: ['maintenance'], source: 'confirmed' });
    expect(ask).toHaveBeenCalledTimes(2);
  });
});
