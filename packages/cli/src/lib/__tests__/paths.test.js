import { describe, it, expect } from 'vitest';
import os from 'os';
import path from 'path';
import {
  escapeCaddyQuotedString,
  validateRoot,
  FORBIDDEN_ROOTS,
} from '../paths.js';

describe('escapeCaddyQuotedString', () => {
  it('escapes backslashes and quotes', () => {
    expect(escapeCaddyQuotedString('a\\b"c')).toBe('a\\\\b\\"c');
    expect(escapeCaddyQuotedString('/Users/me/My Project')).toBe(
      '/Users/me/My Project'
    );
  });
});

describe('validateRoot', () => {
  it('accepts normal project paths', () => {
    const result = validateRoot('/Users/someone/Sites/my-app');
    expect(result.ok).toBe(true);
    expect(result.path).toBe(path.resolve('/Users/someone/Sites/my-app'));
  });

  it('rejects control characters', () => {
    expect(validateRoot('/tmp/foo\nbar').ok).toBe(false);
    expect(validateRoot('/tmp/foo\0bar').ok).toBe(false);
  });

  it('rejects home directory and system roots', () => {
    expect(validateRoot(os.homedir()).ok).toBe(false);
    for (const root of FORBIDDEN_ROOTS) {
      expect(validateRoot(root).ok).toBe(false);
    }
  });
});
