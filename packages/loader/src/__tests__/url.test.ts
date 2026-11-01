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
});

describe('buildLocalAssetUrl', () => {
  it('builds https local URLs with cache bust', () => {
    expect(buildLocalAssetUrl('app.sp', '/js/main.js', 123)).toBe(
      'https://app.sp/js/main.js?_cb=123'
    );
  });
});
