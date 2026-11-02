import { describe, it, expect, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { dev } from '../dev.js';
import { saveProjects, loadProjects } from '../../lib/projects.js';

describe('stagepass dev command', () => {
  it('errors when the directory is not linked', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-dev-'));
    const projectsPath = path.join(tmp, 'projects.json');
    await saveProjects({ version: 1, projects: {} }, projectsPath);
    const errors = [];
    const code = await dev(
      {},
      {
        cwd: tmp,
        projectsPath,
        caddyfilePath: path.join(tmp, 'Caddyfile'),
        log: () => {},
        error: (m) => errors.push(String(m)),
        createLiveServer: () => {
          throw new Error('should not start');
        },
        spawnWatch: async () => ({ code: 0 }),
        reloadCaddy: async () => {},
      }
    );
    expect(code).toBe(1);
    expect(errors.join(' ')).toMatch(/link/i);
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
        createLiveServer: () => ({ listen: async () => ({ port: 1, close: async () => {} }) }),
        spawnWatch: async () => ({ code: 0 }),
        reloadCaddy: async () => {},
      }
    );
    expect(code).toBe(1);
    expect(errors.join(' ')).toMatch(/watch/);
    await fs.remove(tmp);
  });
});
