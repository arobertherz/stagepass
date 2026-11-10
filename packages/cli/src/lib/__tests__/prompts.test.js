import { describe, it, expect, vi } from 'vitest';
import { confirm } from '../prompts.js';

describe('confirm [N-1]', () => {
  it('resolves normally when the prompt answers', async () => {
    const confirmFn = vi.fn(async () => true);
    const exit = vi.fn();
    const write = vi.fn();
    const answer = await confirm('ok?', { confirm: confirmFn, exit, write });
    expect(answer).toBe(true);
    expect(exit).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('SIGINT abort: one short line, no stack trace, exit 130', async () => {
    const error = new Error('User force closed the prompt with SIGINT');
    error.name = 'ExitPromptError';
    const confirmFn = vi.fn(async () => {
      throw error;
    });
    const exit = vi.fn();
    const write = vi.fn();
    const answer = await confirm('ok?', { confirm: confirmFn, exit, write });
    expect(answer).toBe(false);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toBe('Aborted.\n');
    expect(write.mock.calls[0][0]).not.toMatch(/at .*\.js:\d+/);
    expect(exit).toHaveBeenCalledWith(130);
  });

  it('EOF/closed stdin abort: one short line, no stack trace, exit 1', async () => {
    const error = new Error('User force closed the prompt with 13 null');
    error.name = 'ExitPromptError';
    const confirmFn = vi.fn(async () => {
      throw error;
    });
    const exit = vi.fn();
    const write = vi.fn();
    const answer = await confirm('ok?', { confirm: confirmFn, exit, write });
    expect(answer).toBe(false);
    expect(write).toHaveBeenCalledWith('Aborted.\n');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('other errors are rethrown unchanged (no "Aborted.", no exit)', async () => {
    const error = new Error('disk full');
    const confirmFn = vi.fn(async () => {
      throw error;
    });
    const exit = vi.fn();
    const write = vi.fn();
    await expect(
      confirm('ok?', { confirm: confirmFn, exit, write })
    ).rejects.toThrow('disk full');
    expect(exit).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('defaults to process.exit/stderr when exit/write are not injected', async () => {
    const error = new Error('User force closed the prompt with SIGINT');
    error.name = 'ExitPromptError';
    const confirmFn = vi.fn(async () => {
      throw error;
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
    const writeSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    await confirm('ok?', { confirm: confirmFn });
    expect(writeSpy).toHaveBeenCalledWith('Aborted.\n');
    expect(exitSpy).toHaveBeenCalledWith(130);
    exitSpy.mockRestore();
    writeSpy.mockRestore();
  });
});
