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
    expect(fs.existsSync(manifestPath)).toBe(false);

    const mainBefore = await fsp.readFile(mainPath);
    const mainStatBefore = await fsp.stat(mainPath);
    const stylesBefore = await fsp.readFile(stylesPath, 'utf8');

    await fsp.writeFile(path.join(tmp, 'src', 'styles.css'), 'body{color:blue}\n', 'utf8');
    await waitForOutput(child, /rebuild css ok/, 10000);

    const mainAfter = await fsp.readFile(mainPath);
    const mainStatAfter = await fsp.stat(mainPath);
    expect(mainAfter.equals(mainBefore)).toBe(true);
    expect(mainStatAfter.mtimeMs).toBe(mainStatBefore.mtimeMs);

    const stylesAfter = await fsp.readFile(stylesPath, 'utf8');
    expect(stylesAfter).not.toBe(stylesBefore);
    expect(stylesAfter).toContain('blue');
    expect(fs.existsSync(manifestPath)).toBe(false);
    expect(await hashedNames(tmp)).toEqual([]);
  }, 30000);

  function buildEnv() {
    return {
      ...process.env,
      STAGEPASS_ENTRY_JS: 'src/main.js',
      STAGEPASS_ENTRY_CSS: 'src/styles.css',
      STAGEPASS_USE_SASS: 'false',
    };
  }

  /**
   * @param {string} dir
   */
  function runBuild(dir) {
    return new Promise((resolve, reject) => {
      const proc = spawn(process.execPath, ['scripts/build.mjs'], {
        cwd: dir,
        env: buildEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child = proc;
      let out = '';
      proc.stdout?.on('data', (chunk) => {
        out += String(chunk);
      });
      proc.stderr?.on('data', (chunk) => {
        out += String(chunk);
      });
      proc.on('error', reject);
      proc.on('exit', (code) => {
        if (child === proc) child = null;
        resolve({ code, out });
      });
    });
  }

  /**
   * @param {import('node:child_process').ChildProcess} proc
   */
  function track(proc) {
    let buf = '';
    const onData = (chunk) => {
      buf += String(chunk);
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    return {
      text: () => buf,
      /**
       * @param {RegExp} re
       * @param {number} from
       * @param {number} [ms]
       */
      wait(re, from, ms = 10000) {
        return new Promise((resolve, reject) => {
          const finish = (err) => {
            clearInterval(iv);
            clearTimeout(timer);
            proc.off('exit', onExit);
            if (err) reject(err);
            else resolve(buf);
          };
          const check = () => {
            if (re.test(buf.slice(from))) finish();
          };
          const onExit = (code) => finish(new Error(`watch exited early (${code}): ${buf.slice(-500)}`));
          const timer = setTimeout(
            () => finish(new Error(`timeout waiting for ${re}: ${buf.slice(from).slice(-500)}`)),
            ms
          );
          const iv = setInterval(check, 15);
          proc.on('exit', onExit);
          check();
        });
      },
    };
  }

  /**
   * @param {string} dir
   */
  async function readManifest(dir) {
    return JSON.parse(await fsp.readFile(path.join(dir, 'dist', 'manifest.json'), 'utf8'));
  }

  it('DPWjiKiC watch rebuilds write no hashed files and leave an existing manifest untouched', async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp-tmpl-build-'));
    await setupProject(tmp);
    const dist = path.join(tmp, 'dist');
    await fsp.mkdir(path.join(dist, 'images'), { recursive: true });
    const manifestBody = `${JSON.stringify({
      'main.js': { file: 'main.aaaaaaa1.js', integrity: 'sha384-abc' },
      'styles.css': { file: 'styles.bbbbbbb2.css', integrity: 'sha384-def' },
    })}\n`;
    const manifestPath = path.join(dist, 'manifest.json');
    await fsp.writeFile(manifestPath, manifestBody);
    await fsp.writeFile(path.join(dist, 'main.aaaaaaa1.js'), 'old-js');
    await fsp.writeFile(path.join(dist, 'styles.bbbbbbb2.css'), 'old-css');
    await fsp.writeFile(path.join(dist, 'other.12345678.js'), 'keep');
    await fsp.writeFile(path.join(dist, 'images', 'x.png'), 'png');
    const manifestStat = await fsp.stat(manifestPath);
    const hashedBefore = await hashedNames(tmp);

    child = spawn(process.execPath, ['scripts/build.mjs', '--watch'], {
      cwd: tmp,
      env: buildEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    const log = track(child);
    await log.wait(/watching/, 0);

    let mark = log.text().length;
    await fsp.writeFile(path.join(tmp, 'src', 'main.js'), 'console.log("one");\n');
    await log.wait(/rebuild js ok/, mark);
    mark = log.text().length;
    await fsp.writeFile(path.join(tmp, 'src', 'styles.css'), 'body{color:blue}\n');
    await log.wait(/rebuild css ok/, mark);
    mark = log.text().length;
    await fsp.writeFile(path.join(tmp, 'src', 'main.js'), 'console.log("two");\n');
    await log.wait(/rebuild js ok/, mark);

    expect(await hashedNames(tmp)).toEqual(hashedBefore);
    expect(await fsp.readFile(manifestPath, 'utf8')).toBe(manifestBody);
    expect((await fsp.stat(manifestPath)).mtimeMs).toBe(manifestStat.mtimeMs);
    expect(await fsp.readFile(path.join(dist, 'main.js'), 'utf8')).toContain('two');
    expect(await fsp.readFile(path.join(dist, 'styles.css'), 'utf8')).toContain('blue');
    expect(await fsp.readFile(path.join(dist, 'other.12345678.js'), 'utf8')).toBe('keep');
    expect(await fsp.readFile(path.join(dist, 'images', 'x.png'), 'utf8')).toBe('png');
    expect(await fsp.readFile(path.join(dist, 'main.aaaaaaa1.js'), 'utf8')).toBe('old-js');
  }, 45000);

  it('DPWjiKiC production build removes the previous hash and keeps the new one', async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp-tmpl-build-'));
    await setupProject(tmp);
    let result = await runBuild(tmp);
    expect(result.code).toBe(0);
    const first = await readManifest(tmp);
    const oldJs = first['main.js'].file;
    const oldCss = first['styles.css'].file;
    expect(oldJs).toMatch(/^main\.[0-9a-f]{8}\.js$/);
    expect(oldCss).toMatch(/^styles\.[0-9a-f]{8}\.css$/);
    expect(fs.existsSync(path.join(tmp, 'dist', oldJs))).toBe(true);

    await fsp.writeFile(path.join(tmp, 'src', 'main.js'), 'console.log("changed");\n');
    result = await runBuild(tmp);
    expect(result.code).toBe(0);
    const second = await readManifest(tmp);
    expect(second['main.js'].file).not.toBe(oldJs);
    expect(second['main.js'].integrity).toMatch(/^sha384-/);
    expect(second['styles.css'].file).toBe(oldCss);
    expect(fs.existsSync(path.join(tmp, 'dist', oldJs))).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'dist', second['main.js'].file))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'dist', oldCss))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'dist', 'main.js'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'dist', 'styles.css'))).toBe(true);
  }, 20000);

  it('DPWjiKiC production build keeps unrelated dist files', async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp-tmpl-build-'));
    await setupProject(tmp);
    let result = await runBuild(tmp);
    expect(result.code).toBe(0);
    const first = await readManifest(tmp);
    await fsp.writeFile(path.join(tmp, 'dist', 'other.12345678.js'), 'keep');
    await fsp.mkdir(path.join(tmp, 'dist', 'images'), { recursive: true });
    await fsp.writeFile(path.join(tmp, 'dist', 'images', 'x.png'), 'png');
    await fsp.writeFile(path.join(tmp, 'src', 'main.js'), 'console.log("changed");\n');
    result = await runBuild(tmp);
    expect(result.code).toBe(0);
    const second = await readManifest(tmp);
    expect(fs.existsSync(path.join(tmp, 'dist', first['main.js'].file))).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'dist', second['main.js'].file))).toBe(true);
    expect(await fsp.readFile(path.join(tmp, 'dist', 'other.12345678.js'), 'utf8')).toBe('keep');
    expect(await fsp.readFile(path.join(tmp, 'dist', 'images', 'x.png'), 'utf8')).toBe('png');
  }, 20000);

  it('DPWjiKiC production build never deletes unsafe manifest entries', async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp-tmpl-build-'));
    await setupProject(tmp);
    let result = await runBuild(tmp);
    expect(result.code).toBe(0);
    const first = await readManifest(tmp);
    const oldJs = first['main.js'].file;

    const outside = path.join(tmp, 'x');
    const abs = path.join(tmp, 'abs-target.js');
    const linkTarget = path.join(tmp, 'link-target.txt');
    await fsp.writeFile(outside, 'outside');
    await fsp.writeFile(abs, 'abs');
    await fsp.writeFile(linkTarget, 'target');
    await fsp.mkdir(path.join(tmp, 'dist', 'sub'), { recursive: true });
    await fsp.writeFile(path.join(tmp, 'dist', 'sub', 'dir.js'), 'sub');
    await fsp.writeFile(path.join(tmp, 'dist', 'plain.js'), 'plain');
    await fsp.writeFile(path.join(tmp, 'dist', 'main.DEADBEEF.js'), 'upper');
    await fsp.symlink(linkTarget, path.join(tmp, 'dist', 'main.deadbeef.js'));
    await fsp.writeFile(
      path.join(tmp, 'dist', 'manifest.json'),
      JSON.stringify({
        'main.js': { file: '../x', integrity: 'sha384-x' },
        'styles.css': { file: 'sub/dir.js', integrity: 'sha384-x' },
        abs: { file: abs, integrity: 'sha384-x' },
        plain: { file: 'plain.js', integrity: 'sha384-x' },
        upper: { file: 'main.DEADBEEF.js', integrity: 'sha384-x' },
        link: { file: 'main.deadbeef.js', integrity: 'sha384-x' },
        slash: { file: 'sub\\dir.js', integrity: 'sha384-x' },
        old: { file: oldJs, integrity: first['main.js'].integrity },
      })
    );

    await fsp.writeFile(path.join(tmp, 'src', 'main.js'), 'console.log("next");\n');
    result = await runBuild(tmp);
    expect(result.code).toBe(0);
    expect(await fsp.readFile(outside, 'utf8')).toBe('outside');
    expect(await fsp.readFile(abs, 'utf8')).toBe('abs');
    expect(await fsp.readFile(path.join(tmp, 'dist', 'sub', 'dir.js'), 'utf8')).toBe('sub');
    expect(await fsp.readFile(path.join(tmp, 'dist', 'plain.js'), 'utf8')).toBe('plain');
    expect(await fsp.readFile(path.join(tmp, 'dist', 'main.DEADBEEF.js'), 'utf8')).toBe('upper');
    expect(await fsp.readFile(linkTarget, 'utf8')).toBe('target');
    expect((await fsp.lstat(path.join(tmp, 'dist', 'main.deadbeef.js'))).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'dist', oldJs))).toBe(false);
    const next = await readManifest(tmp);
    expect(next['main.js'].file).toMatch(/^main\.[0-9a-f]{8}\.js$/);
    expect(fs.existsSync(path.join(tmp, 'dist', next['main.js'].file))).toBe(true);
  }, 20000);

  it('DPWjiKiC malformed manifest does not fail the production build', async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp-tmpl-build-'));
    await setupProject(tmp);
    const manifestPath = path.join(tmp, 'dist', 'manifest.json');
    await fsp.mkdir(path.join(tmp, 'dist'), { recursive: true });
    await fsp.writeFile(path.join(tmp, 'dist', 'main.abcdef01.js'), 'stale');
    for (const bad of ['{not json', '[]', 'null', '"x"', '']) {
      await fsp.writeFile(manifestPath, bad);
      const result = await runBuild(tmp);
      expect(result.code, JSON.stringify(bad)).toBe(0);
    }
    const manifest = await readManifest(tmp);
    expect(manifest['main.js'].file).toMatch(/^main\.[0-9a-f]{8}\.js$/);
    expect(manifest['styles.css'].integrity).toMatch(/^sha384-/);
    expect(await fsp.readFile(path.join(tmp, 'dist', 'main.abcdef01.js'), 'utf8')).toBe('stale');
  }, 30000);

  it('DPWjiKiC unchanged content keeps the same hash file', async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp-tmpl-build-'));
    await setupProject(tmp);
    let result = await runBuild(tmp);
    expect(result.code).toBe(0);
    const first = await readManifest(tmp);
    const jsPath = path.join(tmp, 'dist', first['main.js'].file);
    const cssPath = path.join(tmp, 'dist', first['styles.css'].file);
    const manifestPath = path.join(tmp, 'dist', 'manifest.json');
    const jsStat = await fsp.stat(jsPath);
    const cssStat = await fsp.stat(cssPath);
    const manifestStat = await fsp.stat(manifestPath);
    await new Promise((r) => setTimeout(r, 40));
    result = await runBuild(tmp);
    expect(result.code).toBe(0);
    const second = await readManifest(tmp);
    expect(second).toEqual(first);
    expect((await fsp.stat(jsPath)).mtimeMs).toBe(jsStat.mtimeMs);
    expect((await fsp.stat(cssPath)).mtimeMs).toBe(cssStat.mtimeMs);
    expect((await fsp.stat(manifestPath)).mtimeMs).toBe(manifestStat.mtimeMs);
    expect(fs.existsSync(jsPath)).toBe(true);
    expect(fs.existsSync(cssPath)).toBe(true);
  }, 20000);
});

const HASHED_NAME = /^[\w-]+\.[0-9a-f]{8}\.[A-Za-z0-9]+$/;

/**
 * @param {string} dir
 */
async function hashedNames(dir) {
  const names = await fsp.readdir(path.join(dir, 'dist'));
  return names.filter((name) => HASHED_NAME.test(name)).sort();
}
