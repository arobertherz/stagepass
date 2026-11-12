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

describe('cli-php build publish', () => {
  /** @type {string|null} */
  let tmp = null;
  /** @type {import('node:child_process').ChildProcess|null} */
  let child = null;

  afterEach(async () => {
    if (child && child.exitCode == null && !child.signalCode) {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
    child = null;
    if (tmp) {
      await fsp.rm(tmp, { recursive: true, force: true });
      tmp = null;
    }
  });

  async function setup(php) {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp-php-build-'));
    await fsp.mkdir(path.join(tmp, 'scripts'), { recursive: true });
    await fsp.mkdir(path.join(tmp, 'src'), { recursive: true });
    await fsp.copyFile(templateBuild, path.join(tmp, 'scripts', 'build.mjs'));
    await fsp.writeFile(path.join(tmp, 'src', 'main.js'), 'console.log("hello");\n');
    await fsp.writeFile(path.join(tmp, 'src', 'styles.css'), 'body{color:red}\n');
    await fsp.writeFile(
      path.join(tmp, 'stagepass.json'),
      JSON.stringify({ name: 'app', php, modules: [] })
    );
    const cliRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const esbuildRoot = [
      path.join(cliRoot, 'node_modules', 'esbuild'),
      path.join(cliRoot, '..', 'loader', 'node_modules', 'esbuild'),
      path.join(cliRoot, '..', '..', 'node_modules', 'esbuild'),
    ].find((p) => fs.existsSync(p));
    if (!esbuildRoot) throw new Error('esbuild not found');
    await fsp.mkdir(path.join(tmp, 'node_modules'), { recursive: true });
    await fsp.symlink(esbuildRoot, path.join(tmp, 'node_modules', 'esbuild'), 'junction');
  }

  function runBuild(args = []) {
    return new Promise((resolve, reject) => {
      const proc = spawn(process.execPath, ['scripts/build.mjs', ...args], {
        cwd: tmp,
        env: {
          ...process.env,
          STAGEPASS_ENTRY_JS: 'src/main.js',
          STAGEPASS_ENTRY_CSS: 'src/styles.css',
          STAGEPASS_USE_SASS: 'false',
        },
      });
      let out = '';
      proc.stdout.on('data', (c) => {
        out += String(c);
      });
      proc.stderr.on('data', (c) => {
        out += String(c);
      });
      proc.on('error', reject);
      proc.on('close', (code) => resolve({ code, out }));
    });
  }

  async function seedApi() {
    await fsp.mkdir(path.join(tmp, 'api', 'actions'), { recursive: true });
    await fsp.mkdir(path.join(tmp, '.php', 'rate-limit'), { recursive: true });
    await fsp.writeFile(path.join(tmp, 'api', 'action.php'), '<?php echo "ping";\n');
    await fsp.writeFile(path.join(tmp, 'api', '.env.example'), 'ALLOWED_ORIGINS=\n');
    await fsp.writeFile(path.join(tmp, 'api', '.env'), 'SECRET_API_ENV\n');
    await fsp.writeFile(path.join(tmp, '.env'), 'SECRET_ROOT_ENV\n');
    await fsp.writeFile(path.join(tmp, '.php', 'config.php'), '<?php return [];\n');
    await fsp.writeFile(path.join(tmp, '.php', 'rate-limit', 'hit.json'), '{}\n');
    await fsp.writeFile(path.join(tmp, '.php', 'server-1.log'), 'log\n');
    await fsp.writeFile(path.join(tmp, '.php', 'server-1.pid'), '9\n');
  }

  it('cli-php: production build copies api and config and keeps the manifest', async () => {
    await setup(true);
    await seedApi();
    const dist = path.join(tmp, 'dist');
    await fsp.mkdir(dist, { recursive: true });
    await fsp.writeFile(path.join(dist, 'main.aaaa1111.js'), 'stale');
    await fsp.writeFile(path.join(dist, 'keep-me.txt'), 'stay');
    await fsp.writeFile(
      path.join(dist, 'manifest.json'),
      `${JSON.stringify({
        'main.js': { file: 'main.aaaa1111.js', integrity: 'sha384-old' },
        'styles.css': { file: 'styles.bbbb2222.css', integrity: 'sha384-old' },
      })}\n`
    );

    const result = await runBuild();
    expect(result.code, result.out).toBe(0);
    expect(await fsp.readFile(path.join(dist, 'api', 'action.php'), 'utf8')).toContain('ping');
    expect(await fsp.readFile(path.join(dist, 'api', '.env.example'), 'utf8')).toContain('ALLOWED_ORIGINS');
    expect(await fsp.readFile(path.join(dist, '.php', 'config.php'), 'utf8')).toContain('return');
    expect(fs.existsSync(path.join(dist, '.env'))).toBe(false);
    expect(fs.existsSync(path.join(dist, 'api', '.env'))).toBe(false);
    expect(fs.existsSync(path.join(dist, '.php', 'rate-limit'))).toBe(false);
    expect(fs.existsSync(path.join(dist, '.php', 'server-1.log'))).toBe(false);
    expect(fs.existsSync(path.join(dist, '.php', 'server-1.pid'))).toBe(false);
    expect(fs.existsSync(path.join(dist, 'main.aaaa1111.js'))).toBe(false);
    expect(await fsp.readFile(path.join(dist, 'keep-me.txt'), 'utf8')).toBe('stay');
    const manifest = JSON.parse(await fsp.readFile(path.join(dist, 'manifest.json'), 'utf8'));
    expect(manifest['main.js'].file).toMatch(/^main\.[0-9a-f]{8}\.js$/);
    expect(manifest['main.js'].integrity).toMatch(/^sha384-/);
    expect(manifest['styles.css'].file).toMatch(/^styles\.[0-9a-f]{8}\.css$/);
  });

  it('cli-php: a non-PHP project build does not copy api/', async () => {
    await setup(false);
    await seedApi();
    const result = await runBuild();
    expect(result.code, result.out).toBe(0);
    expect(fs.existsSync(path.join(tmp, 'dist', 'api'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'dist', '.php'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'dist', 'main.js'))).toBe(true);
    const manifest = JSON.parse(await fsp.readFile(path.join(tmp, 'dist', 'manifest.json'), 'utf8'));
    expect(manifest['main.js'].file).toMatch(/^main\./);
  });

  it('cli-php: watch does not copy PHP into dist', async () => {
    await setup(true);
    await seedApi();
    child = spawn(process.execPath, ['scripts/build.mjs', '--watch'], {
      cwd: tmp,
      env: {
        ...process.env,
        STAGEPASS_ENTRY_JS: 'src/main.js',
        STAGEPASS_ENTRY_CSS: 'src/styles.css',
        STAGEPASS_USE_SASS: 'false',
      },
    });
    let buf = '';
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout: ${buf}`)), 15000);
      const onData = (chunk) => {
        buf += String(chunk);
        if (/watching/.test(buf)) {
          clearTimeout(timer);
          resolve();
        }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`exited ${code}: ${buf}`));
      });
    });
    expect(fs.existsSync(path.join(tmp, 'dist', 'api'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'dist', '.php'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'dist', 'manifest.json'))).toBe(false);
    child.kill('SIGTERM');
  });
});
