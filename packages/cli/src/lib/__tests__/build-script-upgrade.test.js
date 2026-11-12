import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyTemplate } from '../scaffold.js';
import {
  BUILD_SCRIPT_CUSTOM_HINT,
  BUILD_SCRIPT_MISSING_NOTE,
  KNOWN_SCAFFOLD_BUILD_SCRIPTS,
  canonicalizeBuildScript,
  classifyBuildScript,
  defaultBuildScriptTemplatePath,
  hashBuildScript,
  inspectProjectBuildScript,
  planBuildScriptUpgrade,
  readScaffoldTokens,
  renderCurrentBuildScript,
} from '../build-script-upgrade.js';

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/build-scripts');

const PRESETS = [
  { ENTRY_JS: 'src/main.js', ENTRY_CSS: 'src/styles.css', USE_SASS: 'false' },
  { ENTRY_JS: 'src/main.js', ENTRY_CSS: 'src/styles.scss', USE_SASS: 'true' },
  { ENTRY_JS: 'src/main.ts', ENTRY_CSS: 'src/styles.css', USE_SASS: 'false' },
  { ENTRY_JS: 'src/main.ts', ENTRY_CSS: 'src/styles.scss', USE_SASS: 'true' },
];

const FIXTURES = [
  ['2.1.0-2.2.7.mjs', '2.1.0-2.2.7'],
  ['2.3.0-sri.mjs', '2.3.0-sri'],
  ['2.3.0.mjs', '2.3.0'],
  ['watch-stable.mjs', 'watch-stable'],
  ['pre-php.mjs', 'pre-php'],
];

describe('scaffold build.mjs detection', () => {
  /** @type {string[]} */
  const dirs = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('hashes every known template and treats entry presets and CRLF as unmodified', async () => {
    const current = await fs.readFile(defaultBuildScriptTemplatePath(), 'utf8');
    expect(KNOWN_SCAFFOLD_BUILD_SCRIPTS.map((item) => item.sha256)).not.toContain(hashBuildScript(current));
    expect(classifyBuildScript(current, current).status).toBe('current');

    for (const [file, id] of FIXTURES) {
      const raw = await fs.readFile(path.join(fixtureDir, file), 'utf8');
      const known = KNOWN_SCAFFOLD_BUILD_SCRIPTS.find((item) => item.id === id);
      expect(known, id).toBeTruthy();
      expect(canonicalizeBuildScript(raw)).toBe(raw);
      expect(hashBuildScript(raw)).toBe(known.sha256);
      expect(classifyBuildScript(raw, current)).toMatchObject({ status: 'stock', id });
      expect(classifyBuildScript(raw.replace(/\n/g, '\r\n'), current)).toMatchObject({ status: 'stock', id });
      expect(classifyBuildScript(raw.replace(/\n/g, '\r'), current)).toMatchObject({ status: 'stock', id });

      for (const preset of PRESETS) {
        const rendered = applyTemplate(raw, preset);
        expect(rendered).not.toBe(raw);
        expect(classifyBuildScript(rendered, current)).toMatchObject({ status: 'stock', id });
        expect(readScaffoldTokens(rendered)).toMatchObject(preset);
        const upgraded = renderCurrentBuildScript(current, rendered);
        expect(classifyBuildScript(upgraded, current).status).toBe('current');
        expect(readScaffoldTokens(upgraded)).toMatchObject(preset);
        expect(upgraded).toContain("typeof entry === 'string'");
      }

      const edited = raw.replace('esbuild', 'esbuild /* local */');
      expect(classifyBuildScript(edited, current).status).toBe('custom');
      const padded = `${raw} `;
      expect(classifyBuildScript(padded, current).status).toBe('custom');
    }

    for (const preset of PRESETS) {
      expect(classifyBuildScript(applyTemplate(current, preset), current).status).toBe('current');
    }
  });

  it('reports a missing scripts/build.mjs and does not treat a symlink as stock', async () => {
    const current = await fs.readFile(defaultBuildScriptTemplatePath(), 'utf8');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-build-script-'));
    dirs.push(dir);
    expect(await inspectProjectBuildScript(dir, current, fs)).toEqual({ status: 'missing' });

    await fs.mkdir(path.join(dir, 'scripts'), { recursive: true });
    const target = path.join(dir, 'other.mjs');
    await fs.writeFile(target, 'export {}\n');
    await fs.symlink(target, path.join(dir, 'scripts', 'build.mjs'));
    expect((await inspectProjectBuildScript(dir, current, fs)).status).toBe('symlink');
  });

  it('plans an update for a stock script, and leaves a custom script unprompted', async () => {
    const current = await fs.readFile(defaultBuildScriptTemplatePath(), 'utf8');
    const raw = await fs.readFile(path.join(fixtureDir, '2.1.0-2.2.7.mjs'), 'utf8');
    const preset = PRESETS[3];
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-build-plan-'));
    dirs.push(dir);
    await fs.mkdir(path.join(dir, 'scripts'), { recursive: true });
    const projectFile = applyTemplate(raw, preset).replace(/\n/g, '\r\n');
    await fs.writeFile(path.join(dir, 'scripts', 'build.mjs'), projectFile);

    const confirm = async () => {
      throw new Error('non-interactive upgrade must not ask');
    };
    const planned = await planBuildScriptUpgrade({
      cwd: dir,
      currentSource: current,
      interactive: false,
      confirm,
      fse: fs,
    });
    expect(planned.action).toBe('update');
    expect(planned.from).toBe('2.1.0-2.2.7');
    expect(planned.content).toBe(renderCurrentBuildScript(current, projectFile));
    expect(planned.content?.includes('\r')).toBe(false);

    const questions = [];
    const accepted = await planBuildScriptUpgrade({
      cwd: dir,
      currentSource: current,
      interactive: true,
      confirm: async (question, defYes) => {
        questions.push({ question, defYes });
        return true;
      },
      fse: fs,
    });
    expect(accepted.action).toBe('update');
    expect(questions).toEqual([
      {
        question: 'Replace scripts/build.mjs with the current scaffold? It matches the unmodified 2.1.0-2.2.7 template.',
        defYes: true,
      },
    ]);

    const declined = await planBuildScriptUpgrade({
      cwd: dir,
      currentSource: current,
      interactive: true,
      confirm: async () => false,
      fse: fs,
    });
    expect(declined).toMatchObject({ action: 'declined', note: 'scripts/build.mjs left unchanged.' });

    await fs.writeFile(path.join(dir, 'scripts', 'build.mjs'), `${projectFile}\n// local\n`);
    const custom = await planBuildScriptUpgrade({
      cwd: dir,
      currentSource: current,
      interactive: true,
      confirm: async () => {
        throw new Error('custom script must not be overwritten');
      },
      fse: fs,
    });
    expect(custom.action).toBe('custom');
    expect(custom.note).toBe(BUILD_SCRIPT_CUSTOM_HINT);
    expect(custom.note).toContain('stagepass build');
    expect(custom.note).toContain('stagepass watch');
    expect(custom.note).toContain('stagepass dev');
    expect(custom.note).toContain('docs/cli.md#upgrade');

    await fs.rm(path.join(dir, 'scripts', 'build.mjs'));
    const missing = await planBuildScriptUpgrade({
      cwd: dir,
      currentSource: current,
      interactive: true,
      confirm: async () => {
        throw new Error('missing script must not prompt');
      },
      fse: fs,
    });
    expect(missing).toEqual({ action: 'missing', note: BUILD_SCRIPT_MISSING_NOTE });
  });
});
