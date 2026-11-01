import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const spawnMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: (...args) => spawnMock(...args),
}));

describe('defaultSpawn', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('always forces shell:false even if options request a shell', async () => {
    spawnMock.mockImplementation(() => {
      const handlers = { error: null, close: null };
      return {
        on(event, cb) {
          handlers[event] = cb;
          if (event === 'close') {
            queueMicrotask(() => handlers.close?.(0, null));
          }
          return this;
        },
      };
    });

    const { defaultSpawn } = await import('../spawn.js');
    const result = await defaultSpawn('npm', ['run', 'build'], { shell: true });
    expect(result.code).toBe(0);
    expect(spawnMock).toHaveBeenCalledWith(
      'npm',
      ['run', 'build'],
      expect.objectContaining({ shell: false })
    );
  });
});
