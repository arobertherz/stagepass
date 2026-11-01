import { describe, it, expect, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SKIP_PLATFORM_CHECK_ENV,
  isMacOS,
  unsupportedPlatformMessage,
  assertSupportedPlatform,
} from '../platform.js';
import { createProgram } from '../../cli.js';

const binPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../bin/index.js'
);

function runCli(args, envOverrides = {}) {
  const env = { ...process.env, ...envOverrides };
  if (
    Object.prototype.hasOwnProperty.call(envOverrides, SKIP_PLATFORM_CHECK_ENV) &&
    envOverrides[SKIP_PLATFORM_CHECK_ENV] == null
  ) {
    delete env[SKIP_PLATFORM_CHECK_ENV];
  }
  return spawnSync(process.execPath, [binPath, ...args], {
    encoding: 'utf8',
    env,
  });
}

describe('isMacOS', () => {
  it('returns true for darwin', () => {
    expect(isMacOS('darwin')).toBe(true);
  });

  it('returns false for linux and win32', () => {
    expect(isMacOS('linux')).toBe(false);
    expect(isMacOS('win32')).toBe(false);
  });
});

describe('assertSupportedPlatform', () => {
  it('allows darwin without writing or exiting', () => {
    const write = vi.fn();
    const exit = vi.fn();
    assertSupportedPlatform({ platform: 'darwin', env: {}, write, exit });
    expect(write).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it('blocks linux with message and exit code 1', () => {
    const write = vi.fn();
    const exit = vi.fn();
    assertSupportedPlatform({ platform: 'linux', env: {}, write, exit });
    expect(write).toHaveBeenCalledWith(unsupportedPlatformMessage('linux'));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('blocks win32 with message and exit code 1', () => {
    const write = vi.fn();
    const exit = vi.fn();
    assertSupportedPlatform({ platform: 'win32', env: {}, write, exit });
    expect(write).toHaveBeenCalledWith(unsupportedPlatformMessage('win32'));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it(`skips the check when ${SKIP_PLATFORM_CHECK_ENV}=1`, () => {
    const write = vi.fn();
    const exit = vi.fn();
    assertSupportedPlatform({
      platform: 'linux',
      env: { [SKIP_PLATFORM_CHECK_ENV]: '1' },
      write,
      exit,
    });
    expect(write).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });
});

describe('createProgram platform hook', () => {
  it('invokes assertPlatform before a system command action', async () => {
    const assertPlatform = vi.fn();
    const link = vi.fn(async () => {});
    const program = createProgram({ assertPlatform, link });
    program.exitOverride();
    await program.parseAsync(['node', 'stagepass', 'link', 'demo']);
    expect(assertPlatform).toHaveBeenCalledTimes(1);
    expect(link).toHaveBeenCalled();
  });

  it('does not run the command handler when assertPlatform exits', async () => {
    const link = vi.fn(async () => {});
    const program = createProgram({
      assertPlatform: () => {
        const err = new Error('platform blocked');
        err.exitCode = 1;
        throw err;
      },
      link,
    });
    program.exitOverride();
    await expect(
      program.parseAsync(['node', 'stagepass', 'link', 'demo'])
    ).rejects.toThrow('platform blocked');
    expect(link).not.toHaveBeenCalled();
  });
});

describe('CLI bin platform behaviour', () => {
  it('allows --version everywhere', () => {
    const result = runCli(['--version']);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('allows --help everywhere', () => {
    const result = runCli(['--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage:');
  });

  it('blocks system commands on non-macOS with exit 1', () => {
    if (process.platform === 'darwin') {
      // Real process.platform cannot be mocked in a child; covered by unit tests.
      return;
    }
    const result = runCli(['setup'], { [SKIP_PLATFORM_CHECK_ENV]: null });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      unsupportedPlatformMessage(process.platform)
    );
  });

  it(`env ${SKIP_PLATFORM_CHECK_ENV}=1 bypasses the platform message`, () => {
    if (process.platform === 'darwin') {
      return;
    }
    const result = runCli(['setup'], { [SKIP_PLATFORM_CHECK_ENV]: '1' });
    expect(result.stderr + result.stdout).not.toContain('supports macOS only');
    // Setup may still fail for missing Homebrew etc.; the process must start.
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBeNull();
  });
});
