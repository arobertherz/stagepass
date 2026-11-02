import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/autostart.js', async () => {
  const actual = await vi.importActual('../../lib/autostart.js');
  return {
    ...actual,
    getAutostartStatus: vi.fn(),
  };
});

import { stop } from '../stop.js';
import { getAutostartStatus, LAUNCH_AGENT_LABEL } from '../../lib/autostart.js';

describe('stop autostart-aware', () => {
  let logSpy;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('bootouts LaunchAgent and explains until-next-login semantics', async () => {
    getAutostartStatus.mockResolvedValue({
      loaded: true,
      plistExists: true,
      plistPath: '/tmp/agent.plist',
    });
    const calls = [];
    await stop({
      verbose: true,
      uid: 501,
      exec: async (file, args) => {
        calls.push({ file, args });
        return { stdout: '', stderr: '', code: 0 };
      },
    });
    expect(
      calls.some(
        (c) =>
          c.file === 'launchctl' &&
          c.args[0] === 'bootout' &&
          c.args[1] === `gui/501/${LAUNCH_AGENT_LABEL}`
      )
    ).toBe(true);
    const joined = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(joined).toMatch(/bootout/);
    expect(joined).toMatch(/autostart off/);
  });

  it('does not bootout when autostart is off', async () => {
    getAutostartStatus.mockResolvedValue({
      loaded: false,
      plistExists: false,
    });
    const calls = [];
    await stop({
      verbose: true,
      exec: async (file, args) => {
        calls.push({ file, args });
        return { stdout: '', stderr: '', code: 0 };
      },
    });
    expect(calls.every((c) => c.file !== 'launchctl')).toBe(true);
  });
});
