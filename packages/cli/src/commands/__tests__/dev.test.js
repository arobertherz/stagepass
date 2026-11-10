import { describe, it, expect, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {
  dev,
  defaultSpawnWatch,
  signalExitCode,
} from '../dev.js';
import { saveProjects, loadProjects } from '../../lib/projects.js';
import { SKIP_PLATFORM_CHECK_ENV } from '../../lib/platform.js';

const readyOk = async () => ({
  ok: true,
  running: true,
  linked: true,
  started: false,
});

const binPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../bin/index.js'
);

/**
 * @param {string} root
 * @param {string} projectsPath
 */
async function linkedApp(root, projectsPath) {
  await fs.ensureDir(root);
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ scripts: { watch: 'echo watch' } })
  );
  await fs.writeFile(
    path.join(root, 'stagepass.json'),
    JSON.stringify({ name: 'app', domain: 'app.sp', version: 1 })
  );
  await saveProjects(
    {
      version: 1,
      projects: {
        'app.sp': {
          root,
          origins: ['example.com'],
          allowAllOrigins: false,
          php: false,
        },
      },
    },
    projectsPath
  );
}

describe('stagepass dev command', () => {
  it('errors when the directory is not linked', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-dev-'));
    const projectsPath = path.join(tmp, 'projects.json');
    await saveProjects({ version: 1, projects: {} }, projectsPath);
    const errors = [];
    const ensure = vi.fn(readyOk);
    const code = await dev(
      {},
      {
        cwd: tmp,
        projectsPath,
        caddyfilePath: path.join(tmp, 'Caddyfile'),
        log: () => {},
        error: (m) => errors.push(String(m)),
        ensureStagepassReady: ensure,
        createLiveServer: () => {
          throw new Error('should not start');
        },
        spawnWatch: async () => ({ code: 0 }),
        reloadCaddy: async () => {},
      }
    );
    expect(code).toBe(1);
    expect(errors.join(' ')).toMatch(/link/i);
    expect(ensure).not.toHaveBeenCalled();
    await fs.remove(tmp);
  });

  it('refuses a second dev while a foreign live pid owns the port', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-dev2-'));
    const root = path.join(tmp, 'app');
    await fs.ensureDir(root);
    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ scripts: { watch: 'echo watch' } })
    );
    const projectsPath = path.join(tmp, 'projects.json');
    await saveProjects(
      {
        version: 1,
        projects: {
          'app.sp': {
            root,
            origins: ['example.com'],
            allowAllOrigins: false,
            php: false,
            devPort: 34567,
            devPid: 1,
          },
        },
      },
      projectsPath
    );
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{}, 1000)'], {
      stdio: 'ignore',
      detached: true,
    });
    child.unref();
    const doc = await loadProjects(projectsPath);
    doc.projects['app.sp'].devPid = child.pid;
    await saveProjects(doc, projectsPath);
    const errors = [];
    try {
      const code = await dev(
        {},
        {
          cwd: root,
          projectsPath,
          caddyfilePath: path.join(tmp, 'Caddyfile'),
          log: () => {},
          error: (m) => errors.push(String(m)),
          ensureStagepassReady: readyOk,
          createLiveServer: () => {
            throw new Error('should not start');
          },
          spawnWatch: async () => ({ code: 0 }),
          reloadCaddy: async () => {},
        }
      );
      expect(code).toBe(1);
      expect(errors.join(' ')).toMatch(/already running/i);
    } finally {
      try {
        process.kill(child.pid, 'SIGKILL');
      } catch {
        /* ignore */
      }
      await fs.remove(tmp);
    }
  });

  it('runs ensure before starting when Stagepass is down', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-dev-'));
    const root = path.join(tmp, 'app');
    await fs.ensureDir(root);
    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ scripts: { watch: 'echo watch' } })
    );
    await fs.writeFile(
      path.join(root, 'stagepass.json'),
      JSON.stringify({ name: 'app', domain: 'app.sp', version: 1 })
    );
    const projectsPath = path.join(tmp, 'projects.json');
    await saveProjects(
      {
        version: 1,
        projects: {
          'app.sp': {
            root,
            origins: ['example.com'],
            allowAllOrigins: false,
            php: false,
          },
        },
      },
      projectsPath
    );
    const ensure = vi.fn(readyOk);
    const spawn = vi.fn(async () => ({ code: 0, signal: null }));
    const code = await dev(
      {},
      {
        cwd: root,
        projectsPath,
        caddyfilePath: path.join(tmp, 'Caddyfile'),
        log: () => {},
        error: () => {},
        ensureStagepassReady: ensure,
        spawnWatch: spawn,
        reloadCaddy: async () => {},
        createLiveServer: () => ({
          listen: async () => ({
            port: 34567,
            close: async () => {},
          }),
        }),
      }
    );
    expect(code).toBe(0);
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(ensure.mock.invocationCallOrder[0]).toBeLessThan(
      spawn.mock.invocationCallOrder[0]
    );
    await fs.remove(tmp);
  });

  it('starts watch, stores devPort, reloads Caddy, and clears on exit', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-dev-'));
    const root = path.join(tmp, 'app');
    await fs.ensureDir(root);
    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ scripts: { watch: 'echo watch' } })
    );
    await fs.writeFile(
      path.join(root, 'stagepass.json'),
      JSON.stringify({ name: 'app', domain: 'app.sp', version: 1 })
    );
    const projectsPath = path.join(tmp, 'projects.json');
    await saveProjects(
      {
        version: 1,
        projects: {
          'app.sp': {
            root,
            origins: ['example.com'],
            allowAllOrigins: false,
            php: false,
          },
        },
      },
      projectsPath
    );
    const caddyfilePath = path.join(tmp, 'Caddyfile');
    const reloads = [];
    const spawn = vi.fn(async () => ({ code: 0, signal: null }));
    let closed = false;

    const code = await dev(
      { verbose: true },
      {
        cwd: root,
        projectsPath,
        caddyfilePath,
        log: () => {},
        error: () => {},
        ensureStagepassReady: readyOk,
        spawnWatch: spawn,
        reloadCaddy: async (cfg) => {
          reloads.push(cfg);
        },
        createLiveServer: () => ({
          listen: async () => ({
            port: 34567,
            close: async () => {
              closed = true;
            },
          }),
        }),
      }
    );

    expect(code).toBe(0);
    expect(spawn).toHaveBeenCalledWith(
      'npm',
      ['run', 'watch'],
      expect.objectContaining({ cwd: root, shell: false })
    );
    expect(closed).toBe(true);
    expect(reloads.length).toBeGreaterThanOrEqual(1);
    const doc = await loadProjects(projectsPath);
    expect(doc.projects['app.sp'].devPort).toBeUndefined();
    const caddy = await fs.readFile(caddyfilePath, 'utf8');
    expect(caddy).toContain('app.sp');
    expect(caddy).not.toContain('reverse_proxy 127.0.0.1:34567');
    await fs.remove(tmp);
  });

  it('rejects when watch script is missing', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-dev-'));
    const root = path.join(tmp, 'app');
    await fs.ensureDir(root);
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: {} }));
    const projectsPath = path.join(tmp, 'projects.json');
    await saveProjects(
      {
        version: 1,
        projects: {
          'app.sp': { root, origins: [], allowAllOrigins: false },
        },
      },
      projectsPath
    );
    const errors = [];
    const code = await dev(
      {},
      {
        cwd: root,
        projectsPath,
        caddyfilePath: path.join(tmp, 'Caddyfile'),
        log: () => {},
        error: (m) => errors.push(String(m)),
        ensureStagepassReady: readyOk,
        createLiveServer: () => ({ listen: async () => ({ port: 1, close: async () => {} }) }),
        spawnWatch: async () => ({ code: 0 }),
        reloadCaddy: async () => {},
      }
    );
    expect(code).toBe(1);
    expect(errors.join(' ')).toMatch(/watch/);
    await fs.remove(tmp);
  });

  it('[P-3][AC-7] SIGHUP during watch clears devPort and returns 128+SIGHUP', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-dev-hup-'));
    const root = path.join(tmp, 'app');
    const projectsPath = path.join(tmp, 'projects.json');
    await linkedApp(root, projectsPath);
    const code = await dev(
      {},
      {
        cwd: root,
        projectsPath,
        caddyfilePath: path.join(tmp, 'Caddyfile'),
        log: () => {},
        error: () => {},
        ensureStagepassReady: readyOk,
        signalGraceMs: 50,
        reloadCaddy: async () => {},
        createLiveServer: () => ({
          listen: async () => ({ port: 34567, close: async () => {} }),
        }),
        spawnWatch: async () => {
          // Emit without OS delivery so the vitest worker is not terminated.
          process.emit('SIGHUP');
          await new Promise((r) => setTimeout(r, 30));
          return { code: null, signal: 'SIGHUP' };
        },
      }
    );
    expect(code).toBe(signalExitCode('SIGHUP'));
    const doc = await loadProjects(projectsPath);
    expect(doc.projects['app.sp'].devPort).toBeUndefined();
    await fs.remove(tmp);
  });

  it('[P-3][AC-7] signal during setup clears devPort without spawning watch', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-dev-setup-'));
    const root = path.join(tmp, 'app');
    const projectsPath = path.join(tmp, 'projects.json');
    await linkedApp(root, projectsPath);
    const spawn = vi.fn(async () => ({ code: 0 }));
    const code = await dev(
      {},
      {
        cwd: root,
        projectsPath,
        caddyfilePath: path.join(tmp, 'Caddyfile'),
        log: () => {},
        error: () => {},
        ensureStagepassReady: readyOk,
        spawnWatch: spawn,
        createLiveServer: () => ({
          listen: async () => ({ port: 34567, close: async () => {} }),
        }),
        reloadCaddy: async () => {
          process.emit('SIGTERM');
          await new Promise((r) => setTimeout(r, 40));
        },
      }
    );
    expect(code).toBe(signalExitCode('SIGTERM'));
    expect(spawn).not.toHaveBeenCalled();
    const doc = await loadProjects(projectsPath);
    expect(doc.projects['app.sp'].devPort).toBeUndefined();
    await fs.remove(tmp);
  });

  it('[P-3][AC-7] SIGTERM while setProjectDevPort pending clears port without watch', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-dev-race-'));
    const root = path.join(tmp, 'app');
    const projectsPath = path.join(tmp, 'projects.json');
    await linkedApp(root, projectsPath);
    const spawn = vi.fn(async () => ({ code: 0 }));
    const origWrite = fs.writeFile.bind(fs);
    let releaseWrite;
    const writeHeld = new Promise((resolve) => {
      releaseWrite = resolve;
    });
    let resolveEntered;
    const holdEntered = new Promise((resolve) => {
      resolveEntered = resolve;
    });
    let gated = false;
    const spy = vi.spyOn(fs, 'writeFile').mockImplementation(async (file, data, enc) => {
      if (
        !gated &&
        String(file) === projectsPath &&
        /"devPort"\s*:/.test(String(data))
      ) {
        gated = true;
        process.emit('SIGTERM');
        resolveEntered();
        await writeHeld;
      }
      return origWrite(file, data, enc);
    });
    try {
      const pending = dev(
        {},
        {
          cwd: root,
          projectsPath,
          caddyfilePath: path.join(tmp, 'Caddyfile'),
          log: () => {},
          error: () => {},
          ensureStagepassReady: readyOk,
          spawnWatch: spawn,
          createLiveServer: () => ({
            listen: async () => ({ port: 34567, close: async () => {} }),
          }),
          reloadCaddy: async () => {},
        }
      );
      await holdEntered;
      releaseWrite();
      const code = await pending;
      expect(code).toBe(143);
      expect(spawn).not.toHaveBeenCalled();
      const doc = await loadProjects(projectsPath);
      expect(doc.projects['app.sp'].devPort).toBeUndefined();
    } finally {
      spy.mockRestore();
      await fs.remove(tmp);
    }
  });

  it('[P-3] defaultSpawnWatch forwards SIGHUP and SIGKILLs a ignoring child after grace', async () => {
    const start = Date.now();
    const pending = defaultSpawnWatch(
      process.execPath,
      [
        '-e',
        "['SIGHUP','SIGINT','SIGTERM'].forEach(s=>process.on(s,()=>{})); setInterval(()=>{}, 1000)",
      ],
      { stdio: 'ignore', signalGraceMs: 80 }
    );
    await new Promise((r) => setTimeout(r, 40));
    process.emit('SIGHUP');
    const result = await pending;
    expect(Date.now() - start).toBeLessThan(2000);
    expect(result.signal === 'SIGKILL' || result.code !== 0 || result.signal != null).toBe(true);
  });
});

describe('stagepass dev process SIGHUP [P-3][AC-7]', () => {
  it('exits within 10s on SIGHUP to the dev pid and clears devPort', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-dev-proc-'));
    const binDir = path.join(home, 'bin');
    const project = path.join(home, 'Sites', 'app');
    const stageDir = path.join(home, '.stagepass');
    fs.mkdirSync(binDir, { recursive: true });
    fs.mkdirSync(project, { recursive: true });
    fs.mkdirSync(stageDir, { recursive: true });
    fs.writeFileSync(
      path.join(project, 'package.json'),
      JSON.stringify({ name: 'app', scripts: { watch: 'node -e "setInterval(()=>{},1000)"' } })
    );
    fs.writeFileSync(
      path.join(project, 'stagepass.json'),
      JSON.stringify({ name: 'app', version: 1 })
    );
    fs.writeFileSync(
      path.join(stageDir, 'projects.json'),
      JSON.stringify({
        version: 1,
        projects: {
          'app.sp': {
            root: project,
            origins: ['example.com'],
            allowAllOrigins: false,
            php: false,
          },
        },
      })
    );
    fs.writeFileSync(path.join(stageDir, 'Caddyfile'), '');
    fs.writeFileSync(path.join(binDir, 'caddy'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    fs.writeFileSync(
      path.join(binDir, 'npm'),
      `#!/bin/sh
if [ "$1" = "run" ] && [ "$2" = "watch" ]; then
  exec "${process.execPath}" -e "['SIGHUP','SIGINT','SIGTERM'].forEach(s=>process.on(s,()=>{})); setInterval(()=>{},1000)"
fi
exit 0
`,
      { mode: 0o755 }
    );
    fs.writeFileSync(path.join(binDir, 'lsof'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });

    const child = spawn(process.execPath, [binPath, 'dev'], {
      cwd: project,
      env: {
        ...process.env,
        HOME: home,
        PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
        CI: 'true',
        [SKIP_PLATFORM_CHECK_ENV]: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    const onData = (chunk) => {
      output += chunk.toString('utf8');
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    const ready = await new Promise((resolve) => {
      const deadline = setTimeout(() => resolve(false), 8000);
      const check = () => {
        if (/Live reload/i.test(output)) {
          clearTimeout(deadline);
          resolve(true);
        }
      };
      child.stdout?.on('data', check);
      child.stderr?.on('data', check);
    });

    expect(ready).toBe(true);
    expect(child.pid).toBeTypeOf('number');
    process.kill(child.pid, 'SIGHUP');

    const closed = await new Promise((resolve) => {
      const t = setTimeout(() => resolve({ timedOut: true }), 10000);
      child.once('close', (code, signal) => {
        clearTimeout(t);
        resolve({ timedOut: false, code, signal });
      });
    });

    if (closed.timedOut && child.pid) {
      try {
        process.kill(child.pid, 'SIGKILL');
      } catch {
        /* ignore */
      }
    }
    expect(closed.timedOut).toBe(false);
    const doc = JSON.parse(fs.readFileSync(path.join(stageDir, 'projects.json'), 'utf8'));
    expect(doc.projects['app.sp'].devPort).toBeUndefined();
    fs.rmSync(home, { recursive: true, force: true });
  }, 20000);
});
