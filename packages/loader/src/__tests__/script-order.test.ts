import { describe, it, expect } from 'vitest';
import { applyScriptLoadOrder } from '../script-attrs.js';

describe('applyScriptLoadOrder', () => {
  it('sets async=false and defer when neither was set', () => {
    const source = document.createElement('script');
    const script = document.createElement('script');
    // Simulate browser default for dynamic scripts
    script.async = true;
    applyScriptLoadOrder(script, source);
    expect(script.async).toBe(false);
    expect(script.defer).toBe(true);
  });

  it('preserves async when original had async', () => {
    const source = document.createElement('script');
    source.setAttribute('async', '');
    const script = document.createElement('script');
    applyScriptLoadOrder(script, source);
    expect(script.async).toBe(true);
  });

  it('preserves defer without forcing async', () => {
    const source = document.createElement('script');
    source.setAttribute('defer', '');
    const script = document.createElement('script');
    script.async = true;
    applyScriptLoadOrder(script, source);
    expect(script.async).toBe(false);
  });
});
