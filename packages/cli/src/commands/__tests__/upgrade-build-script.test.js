import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyTemplate } from '../../lib/scaffold.js';
import {
  BUILD_SCRIPT_CUSTOM_HINT,
  BUILD_SCRIPT_MISSING_NOTE,
  defaultBuildScriptTemplatePath,
  renderCurrentBuildScript,
} from '../../lib/build-script-upgrade.js';
import { upgrade } from '../upgrade.js';

const oldTemplate = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../lib/__tests__/fixtures/build-scripts/2.1.0-2.2.7.mjs'
);

const published = async () => ({ distTags: { latest: '2.4.0' }, versions: ['2.2.0', '2.4.0'] });

describe('upgrade scripts/build.mjs', () => {
  /** @type {string[]} */
  const dirs = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => fs.remove(dir)));
  });

  /**
   * @param {string} buildScript
   */
  async function project(buildScript) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-upgrade-build-'));
    dirs.push(dir);
    await fs.writeJson(
      path.join(dir, 'package.json'),
      { name: 'app', private: true, devDependencies: { '@stagepass/loader': '^2.0.0' } },
      { spaces: 2 }
    );
    await fs.writeJson(path.join(dir, 'stagepass.json'), { name: 'app', modules: [], version: 1 }, { spaces: 2 });
    if (buildScript != null) {
      await fs.mkdir(path.join(dir, 'scripts'));
      await fs.writeFile(path.join(dir, 'scripts', 'build.mjs'), buildScript);
    }
    return dir;
  }

  /**
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

  it('replaces an unmodified scaffold without a TTY and leaves a second run unchanged', async () => {
    const raw = applyTemplate(await fs.readFile(oldTemplate, 'utf8'), {
      ENTRY_JS: 'src/main.ts',
      ENTRY_CSS: 'src/styles.scss',
      USE_SASS: 'true',
    });
    const dir = await project(raw.replace(/\n/g, '\r\n'));
    const logs = [];
    const code = await upgrade({ siteModules: 'none', skipSite: true }, deps(dir, logs));
    expect(code).toBe(0);
    const current = await fs.readFile(defaultBuildScriptTemplatePath(), 'utf8');
    const written = await fs.readFile(path.join(dir, 'scripts', 'build.mjs'), 'utf8');
    expect(written).toBe(renderCurrentBuildScript(current, raw));
    expect(written).toContain("|| 'src/main.ts'");
    expect(written).toContain("|| 'src/styles.scss'");
    expect(written).toContain("|| 'true'");
    expect(logs.join('\n')).toContain('scripts/build.mjs: replace unmodified scaffold (2.1.0-2.2.7)');

    const again = [];
    const second = await upgrade({ siteModules: 'none', skipSite: true }, deps(dir, again));
    expect(second).toBe(0);
    expect(await fs.readFile(path.join(dir, 'scripts', 'build.mjs'), 'utf8')).toBe(written);
    expect(again.join('\n')).toContain('scripts/build.mjs already matches the current scaffold.');
  });

  it('--dry-run prints the replacement and writes nothing', async () => {
    const raw = await fs.readFile(oldTemplate, 'utf8');
    const dir = await project(raw);
    const before = await fs.readFile(path.join(dir, 'scripts', 'build.mjs'), 'utf8');
    const logs = [];
    const code = await upgrade({ dryRun: true, siteModules: 'none', skipSite: true }, deps(dir, logs));
    expect(code).toBe(0);
    expect(await fs.readFile(path.join(dir, 'scripts', 'build.mjs'), 'utf8')).toBe(before);
    expect(await fs.pathExists(path.join(dir, 'AGENTS.md'))).toBe(false);
    const out = logs.join('\n');
    expect(out).toContain('scripts/build.mjs: replace unmodified scaffold (2.1.0-2.2.7)');
    expect(out).toContain('Dry run');
  });

  it('--yes on a TTY replaces without asking; a no leaves the file', async () => {
    const raw = await fs.readFile(oldTemplate, 'utf8');
    const dir = await project(raw);
    const logs = [];
    const ask = vi.fn(async () => {
      throw new Error('must not prompt');
    });
    const code = await upgrade(
      { yes: true, siteModules: 'none', skipSite: true },
      deps(dir, logs, { isTTY: true, createReadline: ask })
    );
    expect(code).toBe(0);
    expect(ask).not.toHaveBeenCalled();
    const current = await fs.readFile(defaultBuildScriptTemplatePath(), 'utf8');
    expect(await fs.readFile(path.join(dir, 'scripts', 'build.mjs'), 'utf8')).toBe(
      renderCurrentBuildScript(current, raw)
    );

    await fs.writeFile(path.join(dir, 'scripts', 'build.mjs'), raw);
    const questions = [];
    const declined = await upgrade(
      { siteModules: 'none', skipSite: true },
      deps(dir, [], {
        isTTY: true,
        createReadline: () => ({
          question: async (prompt) => {
            questions.push(prompt);
            return 'n';
          },
          close() {},
        }),
      })
    );
    expect(declined).toBe(0);
    expect(questions.some((prompt) => prompt.includes('scripts/build.mjs') && prompt.includes('Y/n'))).toBe(true);
    expect(await fs.readFile(path.join(dir, 'scripts', 'build.mjs'), 'utf8')).toBe(raw);

    const accepted = await upgrade(
      { siteModules: 'none', skipSite: true },
      deps(dir, [], {
        isTTY: true,
        createReadline: () => ({
          question: async () => '',
          close() {},
        }),
      })
    );
    expect(accepted).toBe(0);
    expect(await fs.readFile(path.join(dir, 'scripts', 'build.mjs'), 'utf8')).toBe(
      renderCurrentBuildScript(current, raw)
    );
  });

  it('leaves a custom or missing script in place and points at the docs', async () => {
    const dir = await project('// local build\n');
    const logs = [];
    const ask = vi.fn(async () => {
      throw new Error('must not prompt');
    });
    const code = await upgrade(
      { siteModules: 'none', skipSite: true },
      deps(dir, logs, { isTTY: true, createReadline: ask })
    );
    expect(code).toBe(0);
    expect(ask).not.toHaveBeenCalled();
    expect(await fs.readFile(path.join(dir, 'scripts', 'build.mjs'), 'utf8')).toBe('// local build\n');
    expect(logs.join('\n')).toContain(BUILD_SCRIPT_CUSTOM_HINT);

    await fs.remove(path.join(dir, 'scripts', 'build.mjs'));
    const missingLogs = [];
    const missing = await upgrade({ siteModules: 'none', skipSite: true }, deps(dir, missingLogs));
    expect(missing).toBe(0);
    expect(await fs.pathExists(path.join(dir, 'scripts', 'build.mjs'))).toBe(false);
    expect(missingLogs.join('\n')).toContain(BUILD_SCRIPT_MISSING_NOTE);
  });

  it('does not follow a symlinked scripts/build.mjs', async () => {
    const dir = await project(null);
    const target = path.join(dir, 'real.mjs');
    await fs.writeFile(target, 'export {}\n');
    await fs.mkdir(path.join(dir, 'scripts'));
    await fs.symlink(target, path.join(dir, 'scripts', 'build.mjs'));
    const logs = [];
    const code = await upgrade({ yes: true, siteModules: 'none', skipSite: true }, deps(dir, logs, { isTTY: true }));
    expect(code).toBe(0);
    expect((await fs.lstat(path.join(dir, 'scripts', 'build.mjs'))).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(target, 'utf8')).toBe('export {}\n');
    expect(logs.join('\n')).toContain('scripts/build.mjs is a symlink; left unchanged.');
  });
});
