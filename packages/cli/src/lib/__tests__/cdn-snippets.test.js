import { describe, it, expect } from 'vitest';
import {
  findUnpinnedCdnSnippets,
  findUnpinnedCdnMatchesInText,
  isUnpinnedCdnSnippet,
  scanProjectUnpinnedCdn,
  RECOMMENDED_CDN_SNIPPETS,
} from '../cdn-snippets.js';

describe('cdn snippet pinning', () => {
  it('accepts recommended @2 pins', () => {
    expect(findUnpinnedCdnSnippets().ok).toBe(true);
    for (const url of RECOMMENDED_CDN_SNIPPETS) {
      expect(isUnpinnedCdnSnippet(url)).toBe(false);
    }
  });

  it('flags @latest, @1, and bare package URLs', () => {
    expect(
      isUnpinnedCdnSnippet(
        'https://cdn.jsdelivr.net/npm/@stagepass/loader@latest/dist/loader.min.js'
      )
    ).toBe(true);
    expect(
      isUnpinnedCdnSnippet(
        'https://cdn.jsdelivr.net/npm/@stagepass/loader@1/dist/loader.min.js'
      )
    ).toBe(true);
    expect(
      isUnpinnedCdnSnippet(
        'https://cdn.jsdelivr.net/npm/@stagepass/loader/dist/loader.min.js'
      )
    ).toBe(true);
    expect(
      isUnpinnedCdnSnippet(
        'https://unpkg.com/@stagepass/modules@latest/dist/cookies.min.js'
      )
    ).toBe(true);
  });

  it('does not flag exact 1.x or @2 pins', () => {
    expect(
      isUnpinnedCdnSnippet(
        'https://cdn.jsdelivr.net/npm/@stagepass/loader@1.2.0/dist/loader.min.js'
      )
    ).toBe(false);
    expect(
      isUnpinnedCdnSnippet(
        'https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js'
      )
    ).toBe(false);
    expect(
      isUnpinnedCdnSnippet(
        'https://cdn.jsdelivr.net/npm/@stagepass/loader@2.3.1/dist/loader.min.js'
      )
    ).toBe(false);
  });

  it('extracts offenders from free-form README content', () => {
    const text = `
<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@latest/dist/loader.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@1/dist/inject.min.js"></script>
`;
    const matches = findUnpinnedCdnMatchesInText(text);
    expect(matches.some((m) => m.includes('@latest'))).toBe(true);
    expect(matches.some((m) => m.includes('@1/'))).toBe(true);
    expect(matches.every((m) => !m.includes('@2/'))).toBe(true);
  });

  it('scanProjectUnpinnedCdn reads only allowlisted relative files', async () => {
    const files = new Map([
      [
        '/proj/README.md',
        'https://cdn.jsdelivr.net/npm/@stagepass/loader@latest/dist/loader.min.js',
      ],
      [
        '/proj/stagepass.json',
        '{"ok":"https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js"}',
      ],
    ]);
    const result = await scanProjectUnpinnedCdn({
      cwd: '/proj',
      pathExists: async (p) => files.has(p),
      readFile: async (p) => files.get(p),
    });
    expect(result.ok).toBe(false);
    expect(result.offenders[0].file).toBe('README.md');
    expect(result.offenders[0].match).toMatch(/@latest/);
  });
});
