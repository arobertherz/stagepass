import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/autostart.js', async () => {
  const actual = await vi.importActual('../../lib/autostart.js');
  return {
    ...actual,
    getAutostartStatus: vi.fn(),
  };
});

import { stop } from '../stop.js';
import { getAutostartStatus } from '../../lib/autostart.js';

describe('stop autostart messaging', () => {
  let logSpy;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mentions bootout / next login when autostart plist exists', async () => {
    getAutostartStatus.mockResolvedValue({
      loaded: false,
      plistExists: true,
    });
    await stop({
      verbose: true,
      exec: async () => ({ stdout: '', stderr: '', code: 0 }),
    });
    const joined = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(joined).toMatch(/bootout|next login|autostart off/i);
  });

  it('mentions bootout when LaunchAgent is loaded', async () => {
    getAutostartStatus.mockResolvedValue({
      loaded: true,
      plistExists: false,
    });
    await stop({
      verbose: true,
      exec: async () => ({ stdout: '', stderr: '', code: 0 }),
    });
    const joined = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(joined).toMatch(/bootout|autostart off/i);
  });

  it('does not print autostart messaging when autostart is off', async () => {
    getAutostartStatus.mockResolvedValue({
      loaded: false,
      plistExists: false,
    });
    await stop({
      verbose: true,
      exec: async () => ({ stdout: '', stderr: '', code: 0 }),
    });
    const joined = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(joined).not.toMatch(/Autostart LaunchAgent/);
  });

  it('still succeeds if autostart status throws', async () => {
    getAutostartStatus.mockRejectedValue(new Error('boom'));
    await expect(
      stop({
        verbose: true,
        exec: async () => ({ stdout: '', stderr: '', code: 0 }),
      })
    ).resolves.toBeUndefined();
  });
});
