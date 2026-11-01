import { describe, it, expect } from 'vitest';
import {
  buildWebflowSnippets,
  sanitizeSnippetVersion,
} from '../snippets.js';

describe('sanitizeSnippetVersion', () => {
  it('accepts semver and optional range prefixes', () => {
    expect(sanitizeSnippetVersion('2.0.0')).toBe('2.0.0');
    expect(sanitizeSnippetVersion('^2.1.0')).toBe('^2.1.0');
    expect(sanitizeSnippetVersion('~2.0.0')).toBe('~2.0.0');
  });

  it('rejects HTML / quote injection', () => {
    expect(() => sanitizeSnippetVersion('2"><img src=x onerror=alert(1)>')).toThrow(
      /Invalid version/
    );
    expect(() => sanitizeSnippetVersion('2.0.0</script>')).toThrow(/Invalid version/);
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
});
