import { describe, it, expect } from 'vitest';
import { createProgram } from '../cli.js';

function parseArgv(argv) {
  /** @type {object|undefined} */
  let captured;
  const program = createProgram({
    // Linux CI/Docker: skip macOS guard so option parsing can be tested anywhere.
    assertPlatform: () => {},
    doctor: async (options) => {
      captured = { cmd: 'doctor', options };
      return 0;
    },
    certsCheck: async (options) => {
      captured = { cmd: 'certsCheck', options };
      return 0;
    },
    certsTrust: async (options) => {
      captured = { cmd: 'certsTrust', options };
      return 0;
    },
    autostart: async (action, options) => {
      captured = { cmd: 'autostart', action, options };
      return 0;
    },
    daemon: async () => {
      captured = { cmd: 'daemon' };
      return 0;
    },
  });
  program.exitOverride();
  program.parse(['node', 'stagepass', ...argv]);
  return captured;
}

describe('createProgram cli-ops commands', () => {
  it('registers doctor --json', () => {
    const captured = parseArgv(['doctor', '--json']);
    expect(captured.cmd).toBe('doctor');
    expect(captured.options.json).toBe(true);
  });

  it('registers certs check --skip-handshake', () => {
    const captured = parseArgv(['certs', 'check', '--skip-handshake']);
    expect(captured.cmd).toBe('certsCheck');
    expect(captured.options.skipHandshake).toBe(true);
  });

  it('registers certs trust --yes', () => {
    const captured = parseArgv(['certs', 'trust', '--yes']);
    expect(captured.cmd).toBe('certsTrust');
    expect(captured.options.yes).toBe(true);
  });

  it('registers autostart status', () => {
    const captured = parseArgv(['autostart', 'status']);
    expect(captured.cmd).toBe('autostart');
    expect(captured.action).toBe('status');
  });

  it('registers daemon', () => {
    const captured = parseArgv(['daemon']);
    expect(captured.cmd).toBe('daemon');
  });
});
