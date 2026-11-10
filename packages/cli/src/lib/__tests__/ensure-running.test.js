import { describe, it, expect, vi } from 'vitest';
import { isStagepassRunning, ensureStagepassReady } from '../ensure-running.js';

describe('isStagepassRunning', () => {
  it('returns true when lsof shows caddy on 443', async () => {
    const exec = vi.fn(async () => ({
      stdout:
        'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\ncaddy 1234 me 8u IPv6 0x1 0t0 TCP *:443 (LISTEN)\n',
      stderr: '',
      code: 0,
    }));
    expect(await isStagepassRunning({ exec })).toBe(true);
    expect(exec).toHaveBeenCalledWith('lsof', [
      '-nP',
      '-iTCP:443',
      '-sTCP:LISTEN',
    ]);
  });

  it('returns false when lsof exits 1 (nothing listening)', async () => {
    const exec = vi.fn(async () => {
      const err = new Error('no match');
      /** @type {{ code?: number }} */ (err).code = 1;
      throw err;
    });
    expect(await isStagepassRunning({ exec })).toBe(false);
  });

  it('returns null when inspection fails for other reasons', async () => {
    const exec = vi.fn(async () => {
      const err = new Error('denied');
      /** @type {{ code?: string }} */ (err).code = 'EPERM';
      throw err;
    });
    expect(await isStagepassRunning({ exec })).toBe(null);
  });
});

describe('ensureStagepassReady', () => {
  const baseDeps = (overrides = {}) => ({
    ci: true,
    stdin: { isTTY: false },
    stdout: { isTTY: false },
    log: vi.fn(),
    cwd: '/proj',
    projectsPath: '/tmp/projects.json',
    start: vi.fn(async () => 0),
    confirm: vi.fn(async () => false),
    isStagepassRunning: vi.fn(async () => true),
    findProjectByRoot: vi.fn(async () => ({ domain: 'proj.sp' })),
    ...overrides,
  });

  it('running + linked: no prompt, no start, no warning', async () => {
    const deps = baseDeps();
    const result = await ensureStagepassReady({}, deps);
    expect(result).toEqual({
      running: true,
      linked: true,
      started: false,
    });
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.start).not.toHaveBeenCalled();
    expect(deps.log).not.toHaveBeenCalled();
  });

  it('not running + TTY yes: starts in-process then continues', async () => {
    const deps = baseDeps({
      ci: false,
      stdin: { isTTY: true },
      stdout: { isTTY: true },
      isStagepassRunning: vi
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true),
      confirm: vi.fn(async () => true),
      start: vi.fn(async () => 0),
    });
    const result = await ensureStagepassReady({ verbose: true }, deps);
    expect(result.started).toBe(true);
    expect(result.running).toBe(true);
    expect(deps.confirm).toHaveBeenCalledWith(
      'Stagepass is not running. Start it now?',
      { default: true }
    );
    expect(deps.start).toHaveBeenCalledWith(
      expect.objectContaining({ verbose: true, interactive: true })
    );
  });

  it('not running + TTY no: warns and does not start', async () => {
    const deps = baseDeps({
      ci: false,
      stdin: { isTTY: true },
      stdout: { isTTY: true },
      isStagepassRunning: vi.fn(async () => false),
      confirm: vi.fn(async () => false),
    });
    const result = await ensureStagepassReady({}, deps);
    expect(result.started).toBe(false);
    expect(deps.start).not.toHaveBeenCalled();
    expect(String(deps.log.mock.calls[0][0])).toMatch(/stagepass start/);
  });

  it('not running + non-TTY: warning, no prompt', async () => {
    const deps = baseDeps({
      isStagepassRunning: vi.fn(async () => false),
    });
    await ensureStagepassReady({}, deps);
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.start).not.toHaveBeenCalled();
    expect(String(deps.log.mock.calls[0][0])).toMatch(/stagepass start/);
  });

  it('not running + --yes: auto-starts without prompt', async () => {
    const deps = baseDeps({
      isStagepassRunning: vi
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true),
      start: vi.fn(async () => 0),
    });
    const result = await ensureStagepassReady({ yes: true }, deps);
    expect(result.started).toBe(true);
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.start).toHaveBeenCalledWith(
      expect.objectContaining({ interactive: false })
    );
  });

  it('start returns undefined: does not count as started/running', async () => {
    const deps = baseDeps({
      isStagepassRunning: vi.fn(async () => false),
      start: vi.fn(async () => undefined),
    });
    const result = await ensureStagepassReady({ yes: true }, deps);
    expect(result.started).toBe(false);
    expect(result.running).toBe(false);
    expect(String(deps.log.mock.calls[0][0])).toMatch(/Could not start Stagepass/);
  });

  it('start returns 0 but Stagepass still down: started=false', async () => {
    const deps = baseDeps({
      isStagepassRunning: vi.fn(async () => false),
      start: vi.fn(async () => 0),
    });
    const result = await ensureStagepassReady({ yes: true }, deps);
    expect(result.started).toBe(false);
    expect(result.running).toBe(false);
  });

  it('not linked (warn): prints stagepass link hint and continues', async () => {
    const deps = baseDeps({
      findProjectByRoot: vi.fn(async () => null),
    });
    const result = await ensureStagepassReady({}, deps);
    expect(result.linked).toBe(false);
    expect(result.started).toBe(false);
    expect(String(deps.log.mock.calls[0][0])).toMatch(/stagepass link/);
  });

  it('unlinked skip: does not check link or warn', async () => {
    const deps = baseDeps({
      findProjectByRoot: vi.fn(async () => null),
      unlinked: 'skip',
    });
    const result = await ensureStagepassReady({}, deps);
    expect(result.linked).toBe(true);
    expect(deps.findProjectByRoot).not.toHaveBeenCalled();
    expect(deps.log).not.toHaveBeenCalled();
  });

  it('start throws: warns, continues, started=false', async () => {
    const deps = baseDeps({
      isStagepassRunning: vi.fn(async () => false),
      start: vi.fn(async () => {
        throw new Error('boot failed');
      }),
    });
    const result = await ensureStagepassReady({ yes: true }, deps);
    expect(result).toEqual({
      running: false,
      linked: true,
      started: false,
    });
    expect(String(deps.log.mock.calls[0][0])).toMatch(
      /Could not start Stagepass\. Run: stagepass start/
    );
  });

  it('start returns non-zero: warns, continues, started=false', async () => {
    const deps = baseDeps({
      isStagepassRunning: vi.fn(async () => false),
      start: vi.fn(async () => 1),
    });
    const result = await ensureStagepassReady({ yes: true }, deps);
    expect(result).toEqual({
      running: false,
      linked: true,
      started: false,
    });
    expect(String(deps.log.mock.calls[0][0])).toMatch(
      /Could not start Stagepass\. Run: stagepass start/
    );
  });

  it('unknown running status: skips start prompt', async () => {
    const deps = baseDeps({
      isStagepassRunning: vi.fn(async () => null),
    });
    await ensureStagepassReady({}, deps);
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.start).not.toHaveBeenCalled();
    expect(deps.log).not.toHaveBeenCalled();
  });
});
