import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HTACCESS_DENY_LINE, defaultHtaccessTemplatePath } from '../../lib/htaccess-upgrade.js';
import { upgrade } from '../upgrade.js';

const templates = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../templates/project');

const published = async () => ({ distTags: { latest: '2.4.0' }, versions: ['2.2.0', '2.4.0'] });

describe('upgrade PHP .htaccess', () => {
  /** @type {string[]} */
  const dirs = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => fs.remove(dir)));
  });

  /**
   * @param {boolean | undefined} php
   */
  async function project(php) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-upgrade-ht-'));
    dirs.push(dir);
    await fs.writeJson(
      path.join(dir, 'package.json'),
      { name: 'app', private: true, devDependencies: { '@stagepass/loader': '^2.0.0' } },
      { spaces: 2 }
    );
    /** @type {Record<string, unknown>} */
    const stagepass = { name: 'app', modules: [], version: 1 };
    if (php !== undefined) stagepass.php = php;
    await fs.writeJson(path.join(dir, 'stagepass.json'), stagepass, { spaces: 2 });
    return dir;
  }

  /**
   * @param {string} dir
   * @param {string[]} logs
   * @param {object} [extra]
   */
  function deps(dir, logs, extra = {}) {
    return {
      cwd: dir,
      fetchPublished: published,
      log: (message) => logs.push(String(message ?? '')),
      isTTY: false,
      loadProjects: async () => ({ projects: {} }),
      detectSite: vi.fn(async () => {
        throw new Error('detectSite must not be called');
      }),
      ...extra,
    };
  }

  it('creates a missing .htaccess with the template bytes new --php writes', async () => {
    const dir = await project(true);
    const template = await fs.readFile(path.join(templates, 'htaccess'));
    expect(template.equals(await fs.readFile(defaultHtaccessTemplatePath()))).toBe(true);
    const logs = [];
    const code = await upgrade({ siteModules: 'none', skipSite: true }, deps(dir, logs));
    expect(code).toBe(0);
    const written = await fs.readFile(path.join(dir, '.htaccess'));
    expect(written.equals(template)).toBe(true);
    expect(logs.join('\n')).toContain('.htaccess: created');

    const again = [];
    const second = await upgrade({ siteModules: 'none', skipSite: true }, deps(dir, again));
    expect(second).toBe(0);
    expect((await fs.readFile(path.join(dir, '.htaccess'))).equals(template)).toBe(true);
    expect(again.join('\n')).not.toContain('.htaccess: created');
    expect(again.join('\n')).not.toContain(HTACCESS_DENY_LINE);
  });

  it('--dry-run plans a missing .htaccess and writes nothing', async () => {
    const dir = await project(true);
    const logs = [];
    const code = await upgrade({ dryRun: true, siteModules: 'none', skipSite: true }, deps(dir, logs));
    expect(code).toBe(0);
    expect(await fs.pathExists(path.join(dir, '.htaccess'))).toBe(false);
    const out = logs.join('\n');
    expect(out).toContain('.htaccess: created');
    expect(out).toContain('Dry run');
  });

  it('leaves an existing .htaccess that contains RewriteRule "(^|/)\\." - [F] untouched and prints no hint', async () => {
    const dir = await project(true);
    const body = `# keep\n${HTACCESS_DENY_LINE}\n# tail\n`;
    await fs.writeFile(path.join(dir, '.htaccess'), body);
    const logs = [];
    const code = await upgrade({ yes: true, siteModules: 'none', skipSite: true }, deps(dir, logs, { isTTY: true }));
    expect(code).toBe(0);
    expect(await fs.readFile(path.join(dir, '.htaccess'), 'utf8')).toBe(body);
    const out = logs.join('\n');
    expect(out).not.toContain('.htaccess:');
    expect(out).not.toContain('.htaccess exists');
    expect(out).not.toContain('stagepass.one/docs/php/');
  });

  it('leaves an existing .htaccess without the RewriteRule "(^|/)\\." - [F] line untouched and prints a hint', async () => {
    const dir = await project(true);
    const body = 'RewriteRule (^|/)\\. - [F]\n';
    expect(body.includes(HTACCESS_DENY_LINE)).toBe(false);
    await fs.writeFile(path.join(dir, '.htaccess'), body);
    const logs = [];
    const code = await upgrade({ siteModules: 'none', skipSite: true }, deps(dir, logs));
    expect(code).toBe(0);
    expect(await fs.readFile(path.join(dir, '.htaccess'), 'utf8')).toBe(body);
    const out = logs.join('\n');
    expect(out).toContain(HTACCESS_DENY_LINE);
    expect(out).toContain('Left unchanged');
    expect(out).toContain('https://stagepass.one/docs/php/');
    expect(out).toContain('api/README.md');
    expect(out).not.toContain('.htaccess: created');
  });

  it('does not create .htaccess or print a hint when php is not true', async () => {
    for (const php of /** @type {const} */ ([false, undefined])) {
      const dir = await project(php);
      const logs = [];
      const code = await upgrade({ siteModules: 'none', skipSite: true }, deps(dir, logs));
      expect(code).toBe(0);
      expect(await fs.pathExists(path.join(dir, '.htaccess'))).toBe(false);
      expect(logs.join('\n')).not.toMatch(/\.htaccess/);
    }
  });

  it('does not follow a symlink or replace a directory named .htaccess', async () => {
    const linkDir = await project(true);
    const target = path.join(linkDir, 'real-htaccess.txt');
    await fs.writeFile(target, 'secret-target\n');
    await fs.symlink(target, path.join(linkDir, '.htaccess'));
    const linkLogs = [];
    const linkCode = await upgrade({ yes: true, siteModules: 'none', skipSite: true }, deps(linkDir, linkLogs));
    expect(linkCode).toBe(0);
    expect((await fs.lstat(path.join(linkDir, '.htaccess'))).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(target, 'utf8')).toBe('secret-target\n');
    expect(linkLogs.join('\n')).toContain('.htaccess is a symlink; left unchanged.');
    expect(linkLogs.join('\n')).not.toContain('.htaccess exists and has no');

    const brokenDir = await project(true);
    await fs.symlink(path.join(brokenDir, 'missing.txt'), path.join(brokenDir, '.htaccess'));
    const brokenLogs = [];
    const broken = await upgrade({ siteModules: 'none', skipSite: true }, deps(brokenDir, brokenLogs));
    expect(broken).toBe(0);
    expect((await fs.lstat(path.join(brokenDir, '.htaccess'))).isSymbolicLink()).toBe(true);
    expect(await fs.pathExists(path.join(brokenDir, 'missing.txt'))).toBe(false);
    expect(brokenLogs.join('\n')).toContain('.htaccess is a symlink; left unchanged.');

    const dir = await project(true);
    const folder = path.join(dir, '.htaccess');
    await fs.mkdir(folder);
    await fs.writeFile(path.join(folder, 'keep.txt'), 'keep\n');
    const logs = [];
    const code = await upgrade({ siteModules: 'none', skipSite: true }, deps(dir, logs));
    expect(code).toBe(0);
    expect((await fs.lstat(folder)).isDirectory()).toBe(true);
    expect(await fs.readFile(path.join(folder, 'keep.txt'), 'utf8')).toBe('keep\n');
    expect(logs.join('\n')).toContain('.htaccess is a directory; left unchanged.');
    expect(logs.join('\n')).not.toContain('.htaccess: created');
  });
});
