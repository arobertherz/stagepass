import { describe, it, expect, vi } from 'vitest';
import {
  buildOsascriptNotificationArgs,
  truncateNotifyText,
  notifyMac,
} from '../notify.js';

describe('macOS notifications', () => {
  it('truncates text', () => {
    expect(truncateNotifyText('  hello   world  ', 20)).toBe('hello world');
    expect(truncateNotifyText('x'.repeat(50), 10).length).toBe(10);
  });

  it('passes title/body via argv, not script interpolation', () => {
    const evil = ['"; display dialog "', 'pwned', '"; me'].join('');
    const args = buildOsascriptNotificationArgs(evil, evil);
    expect(args[0]).toBe('-e');
    expect(args[1]).toContain('on run argv');
    expect(args[1]).not.toContain('pwned');
    expect(args[1]).not.toContain('display dialog');
    expect(args[2]).toBe('--');
    expect(args[3]).toContain('pwned');
    expect(args[4]).toContain('pwned');
  });

  it('notifyMac swallows exec failures', async () => {
    const exec = vi.fn(async () => {
      throw new Error('osascript missing');
    });
    await expect(
      notifyMac({ title: 'T', body: 'B', exec, timeoutMs: 10 })
    ).resolves.toBe(false);
  });

  it('notifyMac invokes osascript with safe argv', async () => {
    const exec = vi.fn(async () => ({ stdout: '', stderr: '', code: 0 }));
    await expect(
      notifyMac({ title: 'Stagepass', body: 'PHP failed', exec })
    ).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith(
      'osascript',
      expect.arrayContaining(['-e', expect.stringContaining('on run argv'), '--']),
      expect.objectContaining({ timeout: expect.any(Number) })
    );
    const args = exec.mock.calls[0][1];
    expect(args[args.length - 2]).toBe('Stagepass');
    expect(args[args.length - 1]).toBe('PHP failed');
  });
});
