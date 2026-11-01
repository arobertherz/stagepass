import { describe, it, expect } from 'vitest';
import { validateProjectName } from '../project-name.js';

describe('validateProjectName', () => {
  it('accepts DNS-safe names', () => {
    expect(validateProjectName('a').ok).toBe(true);
    expect(validateProjectName('my-project').name).toBe('my-project');
    expect(validateProjectName('x'.repeat(63)).ok).toBe(true);
  });

  it('rejects empty, uppercase, leading/trailing hyphen, and bad chars', () => {
    expect(validateProjectName('').ok).toBe(false);
    expect(validateProjectName('MyProject').ok).toBe(false);
    expect(validateProjectName('-bad').ok).toBe(false);
    expect(validateProjectName('bad-').ok).toBe(false);
    expect(validateProjectName('bad_name').ok).toBe(false);
    expect(validateProjectName('has space').ok).toBe(false);
    expect(validateProjectName('x'.repeat(64)).ok).toBe(false);
  });
});
