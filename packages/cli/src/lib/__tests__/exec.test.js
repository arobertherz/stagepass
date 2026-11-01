import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const execFileMock = vi.fn();

vi.mock('node:child_process', () => ({
  execFile: (...args) => execFileMock(...args),
}));

describe('defaultExec', () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('always forces shell:false even if options request a shell', async () => {
    execFileMock.mockImplementation((file, args, options, callback) => {
      // promisify style: (file, args, options, cb) OR (file, args, cb)
      const cb = typeof options === 'function' ? options : callback;
      const opts = typeof options === 'function' ? {} : options;
      expect(opts.shell).toBe(false);
      cb(null, { stdout: 'ok', stderr: '' });
    });

    const { defaultExec } = await import('../exec.js');
    const result = await defaultExec('echo', ['hi'], { shell: true });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('ok');
    expect(execFileMock).toHaveBeenCalled();
  });
});
