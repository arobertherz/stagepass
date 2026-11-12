import { describe, it, expect } from 'vitest';
import { appendQueryParam, buildLocalAssetUrl } from '../url.js';

describe('appendQueryParam', () => {
  it('appends to bare URLs', () => {
    expect(appendQueryParam('https://cdn.example.com/a.js', 'v', '2.0.0')).toBe(
      'https://cdn.example.com/a.js?v=2.0.0'
    );
  });

  it('handles existing query and hash', () => {
    expect(
      appendQueryParam('https://cdn.example.com/a.js?x=1#sec', 'v', '1.2.3')
    ).toBe('https://cdn.example.com/a.js?x=1&v=1.2.3#sec');
  });

  it('URL-encodes values', () => {
    expect(appendQueryParam('/app.js', 'v', 'a b')).toBe('/app.js?v=a%20b');
  });

  it('still appends v when the URL already has v (2.4.0 behaviour)', () => {
    expect(appendQueryParam('https://cdn.example.com/a.js?v=1&x=2', 'v', '9')).toBe(
      'https://cdn.example.com/a.js?v=1&x=2&v=9'
    );
  });

  it('replaces a single existing _cb and keeps other params and the hash', () => {
    expect(appendQueryParam('https://cdn.example.com/a.js?_cb=111&x=1#sec', '_cb', '999')).toBe(
      'https://cdn.example.com/a.js?x=1&_cb=999#sec'
    );
  });

  it('replaces every existing _cb with exactly one, preserving order of the rest', () => {
    expect(
      appendQueryParam('https://cdn.example.com/a.js?_cb=111&a=1&_cb=222&b=2#frag', '_cb', '999')
    ).toBe('https://cdn.example.com/a.js?a=1&b=2&_cb=999#frag');
    expect(appendQueryParam('https://cdn.example.com/a.js?_cb=111&_cb=222', '_cb', '999')).toBe(
      'https://cdn.example.com/a.js?_cb=999'
    );
  });

  it('does not treat a different key that contains _cb as a cache-bust parameter', () => {
    expect(appendQueryParam('https://cdn.example.com/a.js?_cbExtra=1&x_cb=2', '_cb', '999')).toBe(
      'https://cdn.example.com/a.js?_cbExtra=1&x_cb=2&_cb=999'
    );
  });
});

describe('buildLocalAssetUrl', () => {
  it('builds https local URLs with cache bust', () => {
    expect(buildLocalAssetUrl('app.sp', '/js/main.js', 123)).toBe(
      'https://app.sp/js/main.js?_cb=123'
    );
  });
});
