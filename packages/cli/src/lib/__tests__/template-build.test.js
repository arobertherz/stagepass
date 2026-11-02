import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const templateBuild = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../templates/project/scripts/build.mjs'
);

describe('template build.mjs watch', () => {
  /** @type {string|null} */
  let tmp = null;
  /** @type {import('node:child_process').ChildProcess|null} */
  let child = null;

  /**
   * @param {import('node:child_process').ChildProcess} proc
   * @param {NodeJS.Signals} signal
   */
  function signalProc(proc, signal) {
    if (!proc.pid) return;
    try {
      process.kill(-proc.pid, signal);
    } catch {
      try {
        process.kill(proc.pid, signal);
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * @param {import('node:child_process').ChildProcess|null} proc
   * @param {number} [timeoutMs]
   */
  async function stopWatch(proc, timeoutMs = 3000) {
    if (!proc || !proc.pid) return;
    for (const stream of [proc.stdin, proc.stdout, proc.stderr]) {
      try {
        stream?.destroy();
      } catch {
        /* ignore */
      }
    }
    if (proc.exitCode !== null || proc.signalCode) return;
    signalProc(proc, 'SIGTERM');
    await new Promise((resolve) => {
      const t = setTimeout(() => {
        signalProc(proc, 'SIGKILL');
        setTimeout(resolve, 250);
      }, timeoutMs);
      proc.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  afterEach(async () => {
    await stopWatch(child);
    child = null;
    if (tmp) {
      await fsp.rm(tmp, { recursive: true, force: true });
      tmp = null;
    }
  });

  /**
   * @param {string} dir
   */
  async function setupProject(dir) {
    await fsp.mkdir(path.join(dir, 'scripts'), { recursive: true });
    await fsp.mkdir(path.join(dir, 'src'), { recursive: true });
    await fsp.copyFile(templateBuild, path.join(dir, 'scripts', 'build.mjs'));
    await fsp.writeFile(
      path.join(dir, 'src', 'main.js'),
      'console.log("hello");\n',
      'utf8'
    );
    await fsp.writeFile(path.join(dir, 'src', 'styles.css'), 'body{color:red}\n', 'utf8');
    await fsp.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({
        name: 'template-build-test',
        private: true,
        type: 'module',
        scripts: {
          build: 'node scripts/build.mjs',
          watch: 'node scripts/build.mjs --watch',
        },
      }),
      'utf8'
    );

    // esbuild is a template runtime dep; hoist from the monorepo install (via tsup).
    const cliRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const candidates = [
      path.join(cliRoot, 'node_modules', 'esbuild'),
      path.join(cliRoot, '..', 'loader', 'node_modules', 'esbuild'),
      path.join(cliRoot, '..', '..', 'node_modules', 'esbuild'),
    ];
    const esbuildRoot = candidates.find((p) => fs.existsSync(p));
    if (!esbuildRoot) {
      throw new Error('esbuild not found; run npm ci in the monorepo first');
    }
    await fsp.mkdir(path.join(dir, 'node_modules'), { recursive: true });
    await fsp.symlink(esbuildRoot, path.join(dir, 'node_modules', 'esbuild'), 'junction');
  }

  /**
   * @param {import('node:child_process').ChildProcess} proc
   * @param {RegExp} re
   * @param {number} ms
   */
  function waitForOutput(proc, re, ms = 15000) {
    return new Promise((resolve, reject) => {
      let buf = '';
      const onData = (chunk) => {
        buf += String(chunk);
        if (re.test(buf)) {
          cleanup();
          resolve(buf);
        }
      };
      const onExit = (code) => {
        cleanup();
        reject(new Error(`watch exited early (${code}): ${buf}`));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`timeout waiting for ${re}: ${buf}`));
      }, ms);
      const cleanup = () => {
        clearTimeout(timer);
        proc.stdout?.off('data', onData);
        proc.stderr?.off('data', onData);
        proc.off('exit', onExit);
      };
      proc.stdout?.on('data', onData);
      proc.stderr?.on('data', onData);
      proc.on('exit', onExit);
    });
  }

  it('CSS-only change rewrites style files and does not touch main.js bytes or mtime', async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp-tmpl-build-'));
    await setupProject(tmp);

    child = spawn(process.execPath, ['scripts/build.mjs', '--watch'], {
      cwd: tmp,
      env: {
        ...process.env,
        STAGEPASS_ENTRY_JS: 'src/main.js',
        STAGEPASS_ENTRY_CSS: 'src/styles.css',
        STAGEPASS_USE_SASS: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });

    await waitForOutput(child, /watching/);

    const mainPath = path.join(tmp, 'dist', 'main.js');
    const stylesPath = path.join(tmp, 'dist', 'styles.css');
    const manifestPath = path.join(tmp, 'dist', 'manifest.json');
    expect(fs.existsSync(mainPath)).toBe(true);
    expect(fs.existsSync(stylesPath)).toBe(true);

    const mainBefore = await fsp.readFile(mainPath);
    const mainStatBefore = await fsp.stat(mainPath);
    const manifestBefore = await fsp.readFile(manifestPath);
    const manifestStatBefore = await fsp.stat(manifestPath);
    const stylesBefore = await fsp.readFile(stylesPath, 'utf8');

    // Unchanged rebuild should not rewrite manifest (or main.js).
    await new Promise((r) => setTimeout(r, 50));
    const manifestStatIdle = await fsp.stat(manifestPath);
    expect(manifestStatIdle.mtimeMs).toBe(manifestStatBefore.mtimeMs);

    await fsp.writeFile(path.join(tmp, 'src', 'styles.css'), 'body{color:blue}\n', 'utf8');
    await waitForOutput(child, /rebuild css ok/, 10000);

    const mainAfter = await fsp.readFile(mainPath);
    const mainStatAfter = await fsp.stat(mainPath);
    expect(mainAfter.equals(mainBefore)).toBe(true);
    expect(mainStatAfter.mtimeMs).toBe(mainStatBefore.mtimeMs);

    const stylesAfter = await fsp.readFile(stylesPath, 'utf8');
    expect(stylesAfter).not.toBe(stylesBefore);
    expect(stylesAfter).toContain('blue');

    const manifestAfter = await fsp.readFile(manifestPath);
    expect(manifestAfter.equals(manifestBefore)).toBe(false);
  }, 30000);
});
