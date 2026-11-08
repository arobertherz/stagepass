import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/autostart.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getAutostartStatus: vi.fn(),
  };
});

vi.mock('execa', () => ({
  execa: vi.fn(async () => ({ stdout: '', stderr: '' })),
}));

import { stop } from '../stop.js';
import { getAutostartStatus } from '../../lib/autostart.js';
import { execa } from 'execa';

describe('stop autostart bootout', () => {
  let logSpy;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    execa.mockClear();
    execa.mockImplementation(async () => ({ stdout: '', stderr: '' }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('bootouts LaunchAgent when plist exists and prints until-next-login hint', async () => {
    getAutostartStatus.mockResolvedValue({
      loaded: false,
      plistExists: true,
    });
    await stop({ verbose: true, uid: 501 });
    const joined = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(joined).toMatch(/bootout/);
    expect(joined).toMatch(/until next login/);
    expect(joined).toMatch(/autostart off/);
    expect(
      execa.mock.calls.some(
        (c) => c[0] === 'launchctl' && c[1]?.[0] === 'bootout'
      )
    ).toBe(true);
  });

  it('bootouts when LaunchAgent is loaded', async () => {
    getAutostartStatus.mockResolvedValue({
      loaded: true,
      plistExists: false,
    });
    await stop({ verbose: true, uid: 501 });
    const joined = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(joined).toMatch(/bootout/);
    expect(
      execa.mock.calls.some(
        (c) => c[0] === 'launchctl' && c[1]?.[0] === 'bootout'
      )
    ).toBe(true);
  });

  it('does not bootout when autostart is off', async () => {
    getAutostartStatus.mockResolvedValue({
      loaded: false,
      plistExists: false,
    });
    await stop({ verbose: true, uid: 501 });
    const joined = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(joined).not.toMatch(/bootout \(until next login\)/);
    expect(
      execa.mock.calls.some(
        (c) => c[0] === 'launchctl' && c[1]?.[0] === 'bootout'
      )
    ).toBe(false);
  });

  it('still succeeds if autostart status throws', async () => {
    getAutostartStatus.mockRejectedValue(new Error('boom'));
    await expect(stop({ verbose: true })).resolves.toBeUndefined();
  });
});
