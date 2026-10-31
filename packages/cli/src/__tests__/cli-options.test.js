import { describe, it, expect } from 'vitest';
import { createProgram } from '../cli.js';

/**
 * Parse real Commander link argv with exitOverride; capture options via injectable handler.
 * @param {string[]} argvAfterLink
 */
function parseLinkArgv(argvAfterLink) {
  let captured;
  const program = createProgram({
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
      'old.com',
      '--remove-origin',
      '*.gone.com',
    ]);
    expect(options.removeOrigin).toEqual(['old.com', '*.gone.com']);
  });

  it('accepts domain argument with flags together', () => {
    const { domain, options } = parseLinkArgv([
      'my-app',
      '--origin',
      'live.com',
      '--no-allow-all-origins',
    ]);
    expect(domain).toBe('my-app');
    expect(options.origin).toEqual(['live.com']);
    expect(options.allowAllOrigins).toBe(false);
  });
});
