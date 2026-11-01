import { describe, expect, it } from 'vitest';
import { isGlobalFree, isValidJsIdentifier } from '../alias.js';

describe('isValidJsIdentifier', () => {
  it('accepts valid identifiers including $ and _', () => {
    expect(isValidJsIdentifier('sp')).toBe(true);
    expect(isValidJsIdentifier('$sp')).toBe(true);
    expect(isValidJsIdentifier('_sp')).toBe(true);
    expect(isValidJsIdentifier('myAlias2')).toBe(true);
  });

  it('rejects invalid identifiers', () => {
    expect(isValidJsIdentifier('')).toBe(false);
    expect(isValidJsIdentifier('2sp')).toBe(false);
    expect(isValidJsIdentifier('sp-name')).toBe(false);
    expect(isValidJsIdentifier('sp.name')).toBe(false);
    expect(isValidJsIdentifier('sp name')).toBe(false);
  });
});

describe('isGlobalFree', () => {
  it('reports undefined properties as free', () => {
    const target: Record<string, unknown> = {};
    expect(isGlobalFree(target, 'freshName')).toBe(true);
    target.freshName = 1;
    expect(isGlobalFree(target, 'freshName')).toBe(false);
  });
});
