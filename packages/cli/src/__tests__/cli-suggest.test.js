import { afterEach, describe, expect, it } from 'vitest';
import { createProgram } from '../cli.js';

const previousExitCode = process.exitCode;

afterEach(() => {
  process.exitCode = previousExitCode;
});

/**
 * Parse argv with stderr/stdout captured. Subcommand errors throw instead of exiting.
 * @param {string[]} argv
 * @param {Record<string, Function>} [deps]
 */
async function capture(argv, deps = {}) {
  const stderr = [];
  const stdout = [];
  const called = [];
  const program = createProgram({
    assertPlatform: () => {},
    link: async () => {
      called.push('link');
    },
    doctor: async (options) => {
      called.push('doctor');
      if (options.json) stdout.push('{"ok":true}\n');
      return 0;
    },
    ...deps,
  });
  const visit = (cmd) => {
    cmd.exitOverride();
    cmd.configureOutput({
      writeErr: (s) => stderr.push(s),
      writeOut: (s) => stdout.push(s),
    });
    cmd.commands.forEach(visit);
  };
  visit(program);
  let error;
  try {
    await program.parseAsync(['node', 'stagepass', ...argv]);
  } catch (err) {
    error = err;
  }
  return { stderr: stderr.join(''), stdout: stdout.join(''), error, called, program };
}

function suggestionLines(stderr) {
  return stderr.split('\n').filter((line) => line.startsWith('Did you mean:'));
}

describe('t4SN4TuQ unknown option and typo suggestions', () => {
  it('[F-7] does not repeat the subcommand when the rest of the line already starts with it', async () => {
    const result = await capture(['--dry-run', 'upgrade']);
    expect(result.called).toEqual([]);
    expect(result.stdout).toBe('');
    expect(result.error).toMatchObject({ exitCode: 1, code: 'commander.unknownOption' });
    expect(suggestionLines(result.stderr)).toEqual([
      'Did you mean: stagepass new --dry-run upgrade',
      'Did you mean: stagepass upgrade --dry-run',
    ]);
    expect(result.stderr).not.toContain('stagepass upgrade --dry-run upgrade');
  });

  it('t4SN4TuQ suggests the one subcommand for a top-level option and keeps the value', async () => {
    const result = await capture(['--origin', 'wln-widget.webflow.io']);
    expect(result.called).toEqual([]);
    expect(result.stdout).toBe('');
    expect(result.error).toMatchObject({ exitCode: 1, code: 'commander.unknownOption' });
    expect(suggestionLines(result.stderr)).toEqual([
      'Did you mean: stagepass link --origin wln-widget.webflow.io',
    ]);
  });

  it('t4SN4TuQ keeps later arguments on the suggested command line', async () => {
    const result = await capture(['--origin', 'wln-widget.webflow.io', '--verbose']);
    expect(result.called).toEqual([]);
    expect(result.error.exitCode).toBe(1);
    expect(suggestionLines(result.stderr)).toEqual([
      'Did you mean: stagepass link --origin wln-widget.webflow.io --verbose',
    ]);
  });

  it('t4SN4TuQ suggests a single subcommand for --opt=value', async () => {
    const result = await capture(['--origin=wln-widget.webflow.io']);
    expect(result.called).toEqual([]);
    expect(result.stdout).toBe('');
    expect(result.error).toMatchObject({ exitCode: 1, code: 'commander.unknownOption' });
    expect(suggestionLines(result.stderr)).toEqual([
      'Did you mean: stagepass link --origin=wln-widget.webflow.io',
    ]);
  });

  it('t4SN4TuQ lists every subcommand that declares the option', async () => {
    const result = await capture(['--json']);
    expect(result.called).toEqual([]);
    expect(result.stdout).toBe('');
    expect(result.error).toMatchObject({ exitCode: 1, code: 'commander.unknownOption' });
    expect(suggestionLines(result.stderr)).toEqual([
      'Did you mean: stagepass autostart --json',
      'Did you mean: stagepass certs check --json',
      'Did you mean: stagepass doctor --json',
    ]);
  });

  it('t4SN4TuQ lists every match for --opt=value', async () => {
    const result = await capture(['--json=1', 'status']);
    expect(result.called).toEqual([]);
    expect(result.stdout).toBe('');
    expect(result.error.exitCode).toBe(1);
    expect(suggestionLines(result.stderr)).toEqual([
      'Did you mean: stagepass autostart --json=1 status',
      'Did you mean: stagepass certs check --json=1 status',
      'Did you mean: stagepass doctor --json=1 status',
    ]);
  });

  it('t4SN4TuQ suggests a command typo via commander and does not run it', async () => {
    const result = await capture(['lnik']);
    expect(result.called).toEqual([]);
    expect(result.stdout).toBe('');
    expect(result.error).toMatchObject({ exitCode: 1, code: 'commander.unknownCommand' });
    expect(result.stderr).toContain("error: unknown command 'lnik'");
    expect(result.stderr).toContain('(Did you mean link?)');
    expect(suggestionLines(result.stderr)).toEqual([]);
  });

  it('t4SN4TuQ suggests an option typo via commander and does not run it', async () => {
    const result = await capture(['link', '--orgin', 'x']);
    expect(result.called).toEqual([]);
    expect(result.stdout).toBe('');
    expect(result.error).toMatchObject({ exitCode: 1, code: 'commander.unknownOption' });
    expect(result.stderr).toContain("error: unknown option '--orgin'");
    expect(result.stderr).toContain('(Did you mean --origin?)');
    expect(suggestionLines(result.stderr)).toEqual([]);
  });

  it('t4SN4TuQ prints no suggestion line when nothing matches', async () => {
    const result = await capture(['--definitely-not-an-option', 'x']);
    expect(result.called).toEqual([]);
    expect(result.stdout).toBe('');
    expect(result.error).toMatchObject({ exitCode: 1, code: 'commander.unknownOption' });
    expect(result.stderr).toBe("error: unknown option '--definitely-not-an-option'\n");
    expect(result.stderr.toLowerCase()).not.toContain('did you mean');
  });

  it('t4SN4TuQ leaves a successful --json stdout unchanged and keeps suggestions off stdout', async () => {
    const ok = await capture(['doctor', '--json']);
    expect(ok.error).toBeUndefined();
    expect(ok.called).toEqual(['doctor']);
    expect(ok.stdout).toBe('{"ok":true}\n');
    expect(ok.stderr).toBe('');
    expect(process.exitCode).toBe(0);

    const bad = await capture(['doctro', '--json']);
    expect(bad.called).toEqual([]);
    expect(bad.stdout).toBe('');
    expect(bad.error).toMatchObject({ exitCode: 1, code: 'commander.unknownCommand' });
    expect(bad.stderr).toContain("error: unknown command 'doctro'");
    expect(bad.stderr).toContain('(Did you mean doctor?)');
    expect(bad.stdout).not.toContain('Did you mean');
  });

  it('t4SN4TuQ strips control characters from the suggestion line', async () => {
    const result = await capture([
      '--origin',
      'a\nb\rc\u0000d\u001be\u007ff',
    ]);
    expect(result.stdout).toBe('');
    expect(result.error.exitCode).toBe(1);
    expect(result.stderr).toBe(
      "error: unknown option '--origin'\nDid you mean: stagepass link --origin abcdef\n"
    );
    expect(result.stderr.includes('\u0000')).toBe(false);
    expect(result.stderr.includes('\u001b')).toBe(false);
    expect(result.stderr.includes('\r')).toBe(false);
    expect(result.stderr.includes('\u007f')).toBe(false);
  });

  it('t4SN4TuQ enables showSuggestionAfterError on the program and every subcommand', () => {
    const program = createProgram({ assertPlatform: () => {} });
    const flags = [];
    const visit = (cmd) => {
      flags.push(cmd._showSuggestionAfterError);
      cmd.commands.forEach(visit);
    };
    visit(program);
    expect(flags.length).toBeGreaterThan(10);
    expect(flags.every((on) => on === true)).toBe(true);
  });
});
