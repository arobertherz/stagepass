import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { runProjectSiteChecks } from '../doctor-site.js';

const live = (list, version = '2') =>
  vi.fn(async () => ({
    ok: true,
    url: 'https://s.webflow.io/',
    loader: { version, cdn: 'jsdelivr' },
    modules: list.map((id) => ({ id, version, cdn: 'jsdelivr' })),
    list,
  }));

describe('runProjectSiteChecks', () => {
  let dir;
  const noProjects = async () => ({ projects: {} });
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-doc-'));
  });
  afterEach(async () => fs.remove(dir));
  const write = (data) => fs.writeJson(path.join(dir, 'stagepass.json'), data);

  it('returns nothing outside a project', async () => {
    expect(await runProjectSiteChecks({ cwd: dir })).toEqual([]);
  });

  it('reports the loaded version when everything matches', async () => {
    await write({ modules: ['cookies'], origin: 's.webflow.io' });
    const checks = await runProjectSiteChecks({ cwd: dir, detectSite: live(['cookies']), loadProjects: noProjects });
    expect(checks.map((c) => c.status)).toEqual(['ok', 'ok']);
    expect(checks[1].message).toBe('Live site s.webflow.io loads @stagepass/loader@2');
  });

  it('[P-4][AC-3] self-hosted vs CDN vs empty loader messages differ', async () => {
    await write({ modules: [], origin: 's.webflow.io' });
    const cdn = await runProjectSiteChecks({
      cwd: dir,
      detectSite: live([], '2.3.0'),
      loadProjects: noProjects,
    });
    const cdnMsg = cdn.find((c) => c.id === 'project.site').message;
    expect(cdnMsg).toBe('Live site s.webflow.io loads @stagepass/loader@2.3.0');
    expect(cdnMsg).not.toMatch(/self-hosted/);

    const selfDetect = vi.fn(async () => ({
      ok: true,
      url: 'https://s.webflow.io/',
      loader: { version: 'latest', cdn: 'self' },
      modules: [],
      list: [],
    }));
    const selfChecks = await runProjectSiteChecks({
      cwd: dir,
      detectSite: selfDetect,
      loadProjects: noProjects,
    });
    const selfMsg = selfChecks.find((c) => c.id === 'project.site').message;
    expect(selfMsg).toBe('Live site s.webflow.io loads a self-hosted @stagepass/loader');
    expect(selfMsg).toMatch(/self-hosted/);
    expect(selfMsg).not.toMatch(/version/);

    const selfVer = vi.fn(async () => ({
      ok: true,
      url: 'https://s.webflow.io/',
      loader: { version: '2.1.0', cdn: 'self' },
      modules: [],
      list: [],
    }));
    const selfVerMsg = (
      await runProjectSiteChecks({ cwd: dir, detectSite: selfVer, loadProjects: noProjects })
    ).find((c) => c.id === 'project.site').message;
    expect(selfVerMsg).toBe(
      'Live site s.webflow.io loads a self-hosted @stagepass/loader (version 2.1.0)'
    );

    const empty = await runProjectSiteChecks({
      cwd: dir,
      detectSite: vi.fn(async () => ({
        ok: true,
        url: 'https://s.webflow.io/',
        loader: null,
        modules: [],
        list: [],
      })),
      loadProjects: noProjects,
    });
    expect(empty.find((c) => c.id === 'project.site').message).toMatch(/does not load/);
    expect(cdnMsg).not.toEqual(selfMsg);
    expect(selfMsg).not.toEqual(empty.find((c) => c.id === 'project.site').message);
  });

  it('warns on a mismatch', async () => {
    await write({ modules: [], origin: 's.webflow.io' });
    const checks = await runProjectSiteChecks({ cwd: dir, detectSite: live(['all'], '2.0.0'), loadProjects: noProjects });
    const mismatch = checks.find((c) => c.id === 'project.site.modules');
    expect(mismatch.status).toBe('warn');
    expect(mismatch.message).toContain('stagepass.json none, live site all');
    expect(checks.find((c) => c.id === 'project.site').message).toContain('@2.0.0');
  });

  it('warns on unreachable site and legacy modules boolean', async () => {
    await write({ modules: true, origin: 's.webflow.io' });
    const detectSite = vi.fn(async () => ({ ok: false, error: 'Site did not answer within 5 s.' }));
    const checks = await runProjectSiteChecks({ cwd: dir, detectSite, loadProjects: noProjects });
    expect(checks.map((c) => [c.id, c.status])).toEqual([
      ['project.modules', 'warn'],
      ['project.site', 'warn'],
    ]);
  });

  it('info without origin; skipSite never fetches', async () => {
    await write({ modules: [] });
    const detectSite = vi.fn();
    let checks = await runProjectSiteChecks({ cwd: dir, detectSite, loadProjects: noProjects });
    expect(checks[1]).toMatchObject({ id: 'project.site', status: 'info' });
    await write({ modules: [], origin: 's.webflow.io' });
    checks = await runProjectSiteChecks({ cwd: dir, detectSite, skipSite: true });
    expect(checks).toHaveLength(1);
    expect(detectSite).not.toHaveBeenCalled();
  });

  it('reports project PHP off / missing binary / ok with api/', async () => {
    await write({ modules: [], php: false });
    let checks = await runProjectSiteChecks({
      cwd: dir,
      skipSite: true,
      loadProjects: noProjects,
    });
    expect(checks.find((c) => c.id === 'project.php')).toMatchObject({
      status: 'info',
      message: expect.stringMatching(/PHP is off/i),
    });

    await write({ modules: [], php: true });
    checks = await runProjectSiteChecks({
      cwd: dir,
      skipSite: true,
      loadProjects: noProjects,
      resolveCommand: async () => null,
    });
    expect(checks.find((c) => c.id === 'project.php').status).toBe('fail');

    await fs.ensureDir(path.join(dir, 'api'));
    checks = await runProjectSiteChecks({
      cwd: dir,
      skipSite: true,
      loadProjects: noProjects,
      platform: 'darwin',
      resolveCommand: async (name) => (name === 'php' || name === 'php-fpm' ? `/usr/bin/${name}` : null),
      exec: async (_file, args = []) => {
        if (args[0] === '-v') return { stdout: 'PHP 8.2.28 (cli)\n', stderr: '' };
        return { stdout: '', stderr: '' };
      },
    });
    expect(checks.find((c) => c.id === 'project.php')).toMatchObject({
      status: 'ok',
      message: expect.stringContaining('/usr/bin/php'),
    });
  });
});
