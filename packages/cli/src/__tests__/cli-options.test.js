import { describe, it, expect } from 'vitest';
import { createProgram, rewriteArgvForUpgrade } from '../cli.js';

/**
 * Parse real Commander link argv with exitOverride; capture options via injectable handler.
 * @param {string[]} argvAfterLink
 */
function parseLinkArgv(argvAfterLink) {
  let captured;
  const program = createProgram({
    // Linux CI/Docker: skip macOS guard so option parsing can be tested anywhere.
    assertPlatform: () => {},
    link: async (domain, options) => {
      captured = { domain, options };
    },
  });
  program.exitOverride();
  program.parse(['node', 'stagepass', 'link', ...argvAfterLink]);
  return captured;
}

describe('createProgram link options (commander)', () => {
  it('maps --allow-all-origins to true', () => {
    const { options } = parseLinkArgv(['--allow-all-origins']);
    expect(options.allowAllOrigins).toBe(true);
  });

  it('maps --no-allow-all-origins to false', () => {
    const { options } = parseLinkArgv(['--no-allow-all-origins']);
    expect(options.allowAllOrigins).toBe(false);
  });

  it('leaves allowAllOrigins undefined when neither flag is set', () => {
    const { options } = parseLinkArgv([]);
    expect(options.allowAllOrigins).toBeUndefined();
  });

  it('collects repeatable --origin values', () => {
    const { options } = parseLinkArgv([
      '--origin',
      'example.com',
      '--origin',
      '*.example.org',
    ]);
    expect(options.origin).toEqual(['example.com', '*.example.org']);
  });

  it('collects repeatable --remove-origin values', () => {
    const { options } = parseLinkArgv([
      '--remove-origin',
      'old.example.com',
      '--remove-origin',
      '*.gone.example.com',
    ]);
    expect(options.removeOrigin).toEqual(['old.example.com', '*.gone.example.com']);
  });

  it('accepts domain argument with flags together', () => {
    const { domain, options } = parseLinkArgv([
      'my-app',
      '--origin',
      'live.example.com',
      '--no-allow-all-origins',
    ]);
    expect(domain).toBe('my-app');
    expect(options.origin).toEqual(['live.example.com']);
    expect(options.allowAllOrigins).toBe(false);
  });
});

describe('createProgram scaffold commands (commander)', () => {
  it('parses upgrade --dry-run and --version (via argv rewrite)', () => {
    let captured;
    const program = createProgram({
      assertPlatform: () => {},
      upgrade: async (options) => {
        captured = options;
        return 0;
      },
    });
    program.exitOverride();
    program.parse(
      rewriteArgvForUpgrade([
        'node',
        'stagepass',
        'upgrade',
        '--dry-run',
        '--version',
        '2.1.0',
      ])
    );
    expect(captured.dryRun).toBe(true);
    expect(captured.version).toBe('2.1.0');
  });

  it('rewriteArgvForUpgrade leaves root --version alone', () => {
    expect(rewriteArgvForUpgrade(['node', 'stagepass', '--version'])).toEqual([
      'node',
      'stagepass',
      '--version',
    ]);
  });

  it('parses new flags including negations', () => {
    let captured;
    const program = createProgram({
      assertPlatform: () => {},
      createNew: async (name, options) => {
        captured = { name, options };
        return 0;
      },
    });
    program.exitOverride();
    program.parse([
      'node',
      'stagepass',
      'new',
      'demo',
      '--yes',
      '--lang',
      'js',
      '--styles',
      'css',
      '--no-modules',
      '--no-git',
      '--no-install',
      '--dir',
      './demo',
      '--remote',
      'https://github.com/org/demo.git',
    ]);
    expect(captured.name).toBe('demo');
    expect(captured.options.yes).toBe(true);
    expect(captured.options.lang).toBe('js');
    expect(captured.options.styles).toBe('css');
    expect(captured.options.modules).toBe(false);
    expect(captured.options.git).toBe(false);
    expect(captured.options.install).toBe(false);
    expect(captured.options.dir).toBe('./demo');
    expect(captured.options.remote).toBe('https://github.com/org/demo.git');
  });

  it('registers watch and build handlers', () => {
    let watchCalled = false;
    let buildCalled = false;
    const program = createProgram({
      assertPlatform: () => {},
      watch: async () => {
        watchCalled = true;
        return 0;
      },
      build: async () => {
        buildCalled = true;
        return 0;
      },
    });
    program.exitOverride();
    program.parse(['node', 'stagepass', 'watch']);
    program.parse(['node', 'stagepass', 'build']);
    expect(watchCalled).toBe(true);
    expect(buildCalled).toBe(true);
  });
});
