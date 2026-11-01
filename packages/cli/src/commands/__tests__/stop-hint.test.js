import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/autostart.js', () => ({
  getAutostartStatus: vi.fn(),
}));

vi.mock('execa', () => ({
  execa: vi.fn(async () => ({ stdout: '', stderr: '' })),
}));

import { stop } from '../stop.js';
import { getAutostartStatus } from '../../lib/autostart.js';

describe('stop autostart hint', () => {
  let logSpy;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints a hint when autostart plist exists', async () => {
    getAutostartStatus.mockResolvedValue({
      loaded: false,
      plistExists: true,
    });
    await stop({ verbose: true });
    const joined = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(joined).toMatch(/Autostart is enabled/);
    expect(joined).toMatch(/autostart off/);
  });

  it('prints a hint when LaunchAgent is loaded', async () => {
    getAutostartStatus.mockResolvedValue({
      loaded: true,
      plistExists: false,
    });
    await stop({ verbose: true });
    const joined = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(joined).toMatch(/Autostart is enabled/);
  });

  it('does not print a hint when autostart is off', async () => {
    getAutostartStatus.mockResolvedValue({
      loaded: false,
      plistExists: false,
    });
    await stop({ verbose: true });
    const joined = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(joined).not.toMatch(/Autostart is enabled/);
  });

  it('still succeeds if autostart status throws', async () => {
    getAutostartStatus.mockRejectedValue(new Error('boom'));
    await expect(stop({ verbose: true })).resolves.toBeUndefined();
  });
});
