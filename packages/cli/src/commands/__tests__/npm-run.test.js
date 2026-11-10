import { describe, it, expect, vi } from 'vitest';
import { runNpmScript, watch, build } from '../npm-run.js';

const readyOk = async () => ({
  ok: true,
  running: true,
  linked: true,
  started: false,
});

describe('runNpmScript', () => {
  it('errors when script is missing', async () => {
    const errors = [];
    const code = await runNpmScript(
      'watch',
      {},
      {
        fs: {
          pathExists: async () => true,
          readFile: async () => JSON.stringify({ scripts: { build: 'echo hi' } }),
        },
        cwd: '/proj',
        spawn: vi.fn(),
        error: (m) => errors.push(String(m)),
        log: () => {},
      }
    );
    expect(code).toBe(1);
    expect(errors.join(' ')).toMatch(/No "watch" script/);
  });

  it('forwards exit codes from spawn', async () => {
    const spawn = vi.fn(async () => ({ code: 7, signal: null }));
    const code = await runNpmScript(
      'build',
      {},
      {
        fs: {
          pathExists: async () => true,
          readFile: async () =>
            JSON.stringify({ scripts: { build: 'node scripts/build.mjs' } }),
        },
        cwd: '/proj',
        spawn,
        error: () => {},
        log: () => {},
      }
    );
    expect(code).toBe(7);
    expect(spawn).toHaveBeenCalledWith(
      'npm',
      ['run', 'build'],
      expect.objectContaining({ cwd: '/proj', shell: false })
    );
  });

  it('watch and build call the matching script names', async () => {
    const spawn = vi.fn(async () => ({ code: 0, signal: null }));
    const fs = {
      pathExists: async () => true,
      readFile: async () =>
        JSON.stringify({ scripts: { watch: 'w', build: 'b' } }),
    };
    expect(
      await watch(
        {},
        {
          fs,
          cwd: '/p',
          spawn,
          log: () => {},
          error: () => {},
          ensureStagepassReady: readyOk,
        }
      )
    ).toBe(0);
    expect(spawn.mock.calls[0][1]).toEqual(['run', 'watch']);
    expect(await build({}, { fs, cwd: '/p', spawn, log: () => {}, error: () => {} })).toBe(0);
    expect(spawn.mock.calls[1][1]).toEqual(['run', 'build']);
  });

  it('watch runs ensure before npm and still forwards exit code', async () => {
    const ensure = vi.fn(readyOk);
    const spawn = vi.fn(async () => ({ code: 0, signal: null }));
    const code = await watch(
      {},
      {
        fs: {
          pathExists: async () => true,
          readFile: async () => JSON.stringify({ scripts: { watch: 'w' } }),
        },
        cwd: '/p',
        spawn,
        log: () => {},
        error: () => {},
        ensureStagepassReady: ensure,
      }
    );
    expect(code).toBe(0);
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});
