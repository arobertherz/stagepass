import { describe, it, expect } from 'vitest';
import {
  validateOriginEntry,
  buildOriginAllowlistRegex,
  originMatchesAllowlist,
  isBroadWebflowWildcard,
  DEFAULT_ORIGIN_ALTERNATIVES,
} from '../origins.js';

describe('validateOriginEntry', () => {
  it('accepts hostnames, wildcards, and https origins', () => {
    expect(validateOriginEntry('Example.COM')).toEqual({
      ok: true,
      value: 'example.com',
    });
    expect(validateOriginEntry('*.example.com')).toEqual({
      ok: true,
      value: '*.example.com',
    });
    expect(validateOriginEntry('https://www.example.com')).toEqual({
      ok: true,
      value: 'www.example.com',
    });
  });

  it('accepts full Webflow staging hostnames and explicit wildcards', () => {
    expect(validateOriginEntry('my-project.webflow.io')).toEqual({
      ok: true,
      value: 'my-project.webflow.io',
    });
    expect(validateOriginEntry('https://my-project.webflow.io')).toEqual({
      ok: true,
      value: 'my-project.webflow.io',
    });
    expect(validateOriginEntry('*.webflow.io')).toEqual({
      ok: true,
      value: '*.webflow.io',
    });
    expect(validateOriginEntry('*.webflow.com')).toEqual({
      ok: true,
      value: '*.webflow.com',
    });
  });

  it('rejects injection and unsafe values', () => {
    for (const bad of [
      'http://example.com',
      'example.com/path',
      'example.com:443',
      'foo bar',
      'foo#bar',
      'foo{bar}',
      '*.*.com',
      '',
    ]) {
      expect(validateOriginEntry(bad).ok).toBe(false);
    }
  });
});

describe('isBroadWebflowWildcard', () => {
  it('detects only the broad Webflow wildcards', () => {
    expect(isBroadWebflowWildcard('*.webflow.io')).toBe(true);
    expect(isBroadWebflowWildcard('*.webflow.com')).toBe(true);
    expect(isBroadWebflowWildcard('my-project.webflow.io')).toBe(false);
    expect(isBroadWebflowWildcard('*.example.com')).toBe(false);
  });
});

describe('origin allowlist matching', () => {
  it('allows default .sp / localhost origins but not Webflow by default', () => {
    expect(originMatchesAllowlist('https://a.sp')).toBe(true);
    expect(originMatchesAllowlist('http://localhost:3000')).toBe(true);
    expect(originMatchesAllowlist('https://127.0.0.1')).toBe(true);
    expect(originMatchesAllowlist('https://foo.webflow.io')).toBe(false);
    expect(originMatchesAllowlist('https://x.y.webflow.com')).toBe(false);
    expect(DEFAULT_ORIGIN_ALTERNATIVES.some((p) => p.includes('webflow'))).toBe(
      false
    );
  });

  it('rejects lookalike and unrelated origins', () => {
    expect(originMatchesAllowlist('https://attacker.example')).toBe(false);
    expect(originMatchesAllowlist('https://evilwebflow.example')).toBe(false);
    expect(originMatchesAllowlist('https://evil-webflow.example')).toBe(false);
    expect(originMatchesAllowlist('https://webflow.io.attacker.example')).toBe(false);
  });

  it('allows configured live domains including explicit Webflow entries', () => {
    expect(
      originMatchesAllowlist('https://www.example.com', ['www.example.com'])
    ).toBe(true);
    expect(
      originMatchesAllowlist('https://shop.example.com', ['*.example.com'])
    ).toBe(true);
    expect(
      originMatchesAllowlist('https://other.example.com', ['www.example.com'])
    ).toBe(false);
    expect(
      originMatchesAllowlist('https://my-project.webflow.io', [
        'my-project.webflow.io',
      ])
    ).toBe(true);
    expect(
      originMatchesAllowlist('https://any.webflow.io', ['*.webflow.io'])
    ).toBe(true);
  });

  it('builds a non-empty anchored regex', () => {
    const re = buildOriginAllowlistRegex(['example.com']);
    expect(re.startsWith('(?i)^')).toBe(true);
    expect(re.endsWith(')$')).toBe(true);
    expect(re).toContain('example\\.com');
    expect(re).not.toContain('webflow');
  });
});
