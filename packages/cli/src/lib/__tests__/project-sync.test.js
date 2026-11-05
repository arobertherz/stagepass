import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import {
  applyProjectSync,
  declaredModules,
  planProjectSync,
  resolveProjectOrigin,
  resolveUpgradeModules,
  updateConfigTypes,
} from '../project-sync.js';

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
    expect(plan.writes.map((w) => w.file).sort()).toEqual(['.cursor/rules/stagepass.mdc', 'AGENTS.md', 'stagepass.json']);
    expect(plan.notes.join('\n')).toContain('No tsconfig.json');
    await applyProjectSync(dir, plan.writes);
    expect(await fs.readJson(path.join(dir, 'stagepass.json'))).toEqual({ name: 'demo', modules: [], version: 1 });
    const again = await planProjectSync({ cwd: dir, modules: [], pkg: { name: 'demo' } });
    expect(again.writes).toEqual([]);
  });

  it('leaves a foreign cursor rule and broken AGENTS markers alone', async () => {
    await fs.outputFile(path.join(dir, '.cursor/rules/stagepass.mdc'), 'my own rule\n');
    await fs.writeFile(path.join(dir, 'AGENTS.md'), '<!-- stagepass:begin -->\nhalf\n');
    const plan = await planProjectSync({ cwd: dir, modules: ['cookies'], pkg: {} });
    expect(plan.writes.map((w) => w.file)).toEqual(['stagepass.json']);
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
});

describe('resolveProjectOrigin', () => {
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

  it('[F-6] warns once for stagepass.json origin with a port without echoing it', async () => {
    const logs = [];
    const result = await resolveProjectOrigin(
      '/p',
      { origin: 'my-site.webflow.io:443' },
      { log: (m) => logs.push(String(m)), loadProjects: async () => ({ projects: {} }) }
    );
    expect(result).toBeNull();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/stagepass\.json origin/i);
    expect(logs[0]).toMatch(/port/i);
    expect(logs[0]).not.toContain('my-site.webflow.io:443');
  });

  it('[F-6] warns once for a linked origin with a port without echoing it', async () => {
    const logs = [];
    const loadProjects = async () => ({
      projects: { p: { root: '/p', origins: ['my-site.webflow.io:443'] } },
    });
    const result = await resolveProjectOrigin('/p', {}, {
      log: (m) => logs.push(String(m)),
      loadProjects,
      realpath: async (x) => x,
    });
    expect(result).toBeNull();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/linked origin from stagepass link/i);
    expect(logs[0]).toMatch(/port/i);
    expect(logs[0]).not.toContain('my-site.webflow.io:443');
  });

  it.each([
    ['evil\u001b[31m.example:443', '\u001b'],
    ['evil\n.example:443', '\n'],
  ])('[F-6] warning for control-character origin %j does not echo raw value', async (origin, forbidden) => {
    const logs = [];
    const result = await resolveProjectOrigin(
      '/p',
      { origin },
      { log: (m) => logs.push(String(m)), loadProjects: async () => ({ projects: {} }) }
    );
    expect(result).toBeNull();
    expect(logs).toHaveLength(1);
    expect(logs[0]).not.toContain(forbidden);
    expect(logs[0]).not.toContain(origin);
    expect(logs[0]).toMatch(/port/i);
  });

  it('[F-6] valid origin produces no warning and same resolution as before', async () => {
    const logs = [];
    const result = await resolveProjectOrigin(
      '/p',
      { origin: 'a.webflow.io' },
      { log: (m) => logs.push(String(m)) }
    );
    expect(result).toEqual({ origin: 'a.webflow.io', source: 'stagepass.json' });
    expect(logs).toEqual([]);
  });

  it('[F-6] skipped stagepass.json origin falls through to a valid linked origin', async () => {
    const logs = [];
    const loadProjects = async () => ({
      projects: { p: { root: '/p', origins: ['ok.webflow.io'] } },
    });
    const result = await resolveProjectOrigin(
      '/p',
      { origin: 'my-site.webflow.io:443' },
      { log: (m) => logs.push(String(m)), loadProjects, realpath: async (x) => x }
    );
    expect(result).toEqual({ origin: 'ok.webflow.io', source: 'stagepass link' });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/stagepass\.json origin/i);
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
    expect(r.modules).toEqual(['cookies']);
    const ask = vi.fn().mockResolvedValueOnce('bogus').mockResolvedValueOnce('maintenance');
    r = await resolveUpgradeModules(
      { cwd: '/p', data: { origin: 's.io' }, pkg: {}, options: {} },
      base({ interactive: true, confirm: async () => false, ask })
    );
    expect(r).toMatchObject({ ok: true, modules: ['maintenance'], source: 'confirmed' });
    expect(ask).toHaveBeenCalledTimes(2);
  });
});
