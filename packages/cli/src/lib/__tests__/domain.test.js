import { describe, it, expect } from 'vitest';
import {
  validateDomain,
  slugifyFolderName,
  resolveLinkDomain,
} from '../domain.js';

describe('validateDomain', () => {
  it('accepts simple labels and normalizes case / .sp', () => {
    expect(validateDomain('My-App')).toEqual({ ok: true, domain: 'my-app.sp' });
    expect(validateDomain('my-app.sp')).toEqual({ ok: true, domain: 'my-app.sp' });
    expect(validateDomain('FOO.SP')).toEqual({ ok: true, domain: 'foo.sp' });
  });

  it('accepts multi-label hosts', () => {
    expect(validateDomain('a.b-c.d')).toEqual({ ok: true, domain: 'a.b-c.d.sp' });
  });

  it('rejects injection / unsafe characters', () => {
    for (const bad of [
      'foo bar',
      'foo\nbar',
      'foo#bar',
      'foo{bar}',
      'foo"bar',
      "foo'bar",
      'foo;bar',
      'foo$bar',
      '../etc',
      'foo/bar',
    ]) {
      expect(validateDomain(bad).ok).toBe(false);
    }
  });

  it('rejects invalid DNS labels', () => {
    expect(validateDomain('-foo').ok).toBe(false);
    expect(validateDomain('foo-').ok).toBe(false);
    expect(validateDomain('foo..bar').ok).toBe(false);
    expect(validateDomain('').ok).toBe(false);
    expect(validateDomain('.sp').ok).toBe(false);
  });
});

describe('slugifyFolderName', () => {
  it('slugifies folder names', () => {
    expect(slugifyFolderName('My Project!')).toBe('my-project');
    expect(slugifyFolderName('  --- ')).toBe('');
    expect(slugifyFolderName('日本語')).toBe('');
  });
});

describe('resolveLinkDomain', () => {
  it('uses explicit domain when provided', () => {
    expect(resolveLinkDomain('custom', 'ignored')).toEqual({
      ok: true,
      domain: 'custom.sp',
      fromFolder: false,
    });
  });

  it('derives from folder and slugs when needed', () => {
    expect(resolveLinkDomain(undefined, 'clean')).toMatchObject({
      ok: true,
      domain: 'clean.sp',
      slugged: false,
    });
    expect(resolveLinkDomain(undefined, 'My Cool App')).toMatchObject({
      ok: true,
      domain: 'my-cool-app.sp',
      slugged: true,
    });
  });

  it('errors when slug is empty', () => {
    expect(resolveLinkDomain(undefined, '!!!').ok).toBe(false);
  });

  it('rejects bad explicit domains without slugging', () => {
    expect(resolveLinkDomain('bad domain', 'folder').ok).toBe(false);
  });
});
