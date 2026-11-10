import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import {
  findUnpinnedCdnSnippets,
  findUnpinnedCdnMatchesInText,
  isUnpinnedCdnSnippet,
  scanProjectUnpinnedCdn,
  listProjectHtmlCdnScanFiles,
  RECOMMENDED_CDN_SNIPPETS,
  PROJECT_CDN_SCAN_MAX_BYTES,
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
      skipHtmlDiscover: true,
      pathExists: async (p) => files.has(p),
      readFile: async (p) => files.get(p),
      fs: {
        pathExists: async (p) => files.has(p),
        readFile: async (p) => files.get(p),
        lstat: async () => ({
          isSymbolicLink: () => false,
          isFile: () => true,
          size: 100,
        }),
        readdir: async () => [],
      },
    });
    expect(result.ok).toBe(false);
    expect(result.offenders[0].file).toBe('README.md');
    expect(result.offenders[0].match).toMatch(/@latest/);
  });
});

describe('scanProjectUnpinnedCdn HTML discovery [P-5][AC-18]', () => {
  /** @type {string} */
  let dir;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-cdn-'));
  });
  afterEach(async () => fs.remove(dir));

  it('flags @latest in snippets/head.html and root *.html', async () => {
    await fs.ensureDir(path.join(dir, 'snippets'));
    await fs.writeFile(
      path.join(dir, 'snippets', 'head.html'),
      '<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@latest/dist/loader.min.js"></script>\n'
    );
    await fs.writeFile(
      path.join(dir, 'custom-head.html'),
      '<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@latest/dist/cookies.min.js"></script>\n'
    );
    await fs.ensureDir(path.join(dir, 'snippets', 'nested'));
    await fs.writeFile(
      path.join(dir, 'snippets', 'nested', 'deep.html'),
      '<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@latest/dist/loader.min.js"></script>\n'
    );
    const listed = await listProjectHtmlCdnScanFiles(dir);
    expect(listed).toEqual(expect.arrayContaining(['custom-head.html', path.join('snippets', 'head.html')]));
    expect(listed.some((f) => f.includes('nested'))).toBe(false);

    const result = await scanProjectUnpinnedCdn({ cwd: dir });
    expect(result.ok).toBe(false);
    expect(result.offenders.some((o) => o.file === path.join('snippets', 'head.html'))).toBe(true);
    expect(result.offenders.some((o) => o.file === 'custom-head.html')).toBe(true);
    expect(result.offenders.every((o) => !String(o.file).includes('nested'))).toBe(true);
  });

  it('skips symlinks and files larger than 1 MB', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-cdn-out-'));
    try {
      const target = path.join(outside, 'evil.html');
      await fs.writeFile(
        target,
        '<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@latest/dist/loader.min.js"></script>\n'
      );
      await fs.symlink(target, path.join(dir, 'linked.html'));
      await fs.ensureDir(path.join(dir, 'snippets'));
      const big = path.join(dir, 'snippets', 'big.html');
      await fs.writeFile(big, 'x'.repeat(PROJECT_CDN_SCAN_MAX_BYTES + 1));
      const listed = await listProjectHtmlCdnScanFiles(dir);
      expect(listed).not.toContain('linked.html');
      expect(listed).not.toContain(path.join('snippets', 'big.html'));
      const result = await scanProjectUnpinnedCdn({ cwd: dir });
      expect(result.offenders.every((o) => o.file !== 'linked.html')).toBe(true);
      expect(await fs.readFile(target, 'utf8')).toContain('@latest');
    } finally {
      await fs.remove(outside);
    }
  });
});
