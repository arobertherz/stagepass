import { describe, it, expect } from 'vitest';
import { isNoCacheEnabled, NOCACHE_ATTR } from '../script-attrs.js';

function scriptWith(attr?: string | null): HTMLScriptElement {
  const el = document.createElement('script');
  if (attr !== undefined && attr !== null) el.setAttribute(NOCACHE_ATTR, attr);
  return el;
}

describe('isNoCacheEnabled', () => {
  it('is off when the attribute is absent', () => {
    expect(isNoCacheEnabled(scriptWith())).toBe(false);
  });

  it('is on as a bare boolean attribute (empty value)', () => {
    expect(isNoCacheEnabled(scriptWith(''))).toBe(true);
  });

  it('is on with an explicit "true" value', () => {
    expect(isNoCacheEnabled(scriptWith('true'))).toBe(true);
  });

  it('is off with an explicit "false" value', () => {
    expect(isNoCacheEnabled(scriptWith('false'))).toBe(false);
  });

  it('treats any other value as on (presence wins, only "false" opts out)', () => {
    expect(isNoCacheEnabled(scriptWith('yes'))).toBe(true);
  });
});
