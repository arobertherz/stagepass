import { describe, it, expect } from 'vitest';
import {
  buildWebflowSnippets,
  sanitizeSnippetVersion,
} from '../snippets.js';

describe('sanitizeSnippetVersion', () => {
  it('accepts strict stable X.Y.Z', () => {
    expect(sanitizeSnippetVersion('2.0.0')).toBe('2.0.0');
    expect(sanitizeSnippetVersion('2.10.0')).toBe('2.10.0');
  });

  it('[INV-4] rejects +, prerelease, quotes, ranges and HTML', () => {
    expect(() => sanitizeSnippetVersion('2.9.0+EVILMARK5')).toThrow(/Invalid version/);
    expect(() => sanitizeSnippetVersion('2.3.4+build.1')).toThrow(/Invalid version/);
    expect(() => sanitizeSnippetVersion('2.4.0-rc.1')).toThrow(/Invalid version/);
    expect(() => sanitizeSnippetVersion('^2.1.0')).toThrow(/Invalid version/);
    expect(() => sanitizeSnippetVersion('~2.0.0')).toThrow(/Invalid version/);
    expect(() => sanitizeSnippetVersion('2"><img src=x onerror=alert(1)>')).toThrow(
      /Invalid version/
    );
    expect(() => sanitizeSnippetVersion('2.0.0</script>')).toThrow(/Invalid version/);
    expect(() => sanitizeSnippetVersion('2.0.0"')).toThrow(/Invalid version/);
    expect(() => sanitizeSnippetVersion('<2.0.0')).toThrow(/Invalid version/);
  });
});

describe('buildWebflowSnippets', () => {
  it('uses jsDelivr @2 loader and optional module dist paths', () => {
    const withModules = buildWebflowSnippets({ version: '2.0.0', modules: true });
    expect(withModules.head).toContain(
      'cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js'
    );
    expect(withModules.head).toContain(
      'cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/inject.min.js'
    );
    expect(withModules.head).toContain(
      'cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/cookies.min.js'
    );
    expect(withModules.head).not.toContain('unpkg.com');
    expect(withModules.head).toContain('data-stagepass-version="2.0.0"');

    const without = buildWebflowSnippets({ version: '2.0.0', modules: false });
    expect(without.head).not.toContain('@stagepass/modules');
  });

  it('[INV-4] refuses build-metadata versions for snippets', () => {
    expect(() => buildWebflowSnippets({ version: '2.9.0+EVILMARK5' })).toThrow(/Invalid version/);
  });
});
