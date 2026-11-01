import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

describe('deprecated globals removed', () => {
  beforeEach(() => {
    delete (window as any).splog;
    delete (window as any).spwarn;
    delete (window as any).sperror;
  });

  it('built loader source does not assign deprecated globals', () => {
    const distPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../dist/loader.js'
    );
    let src = '';
    try {
      src = readFileSync(distPath, 'utf-8');
    } catch {
      // Dist may not exist before first build in some environments
      src = readFileSync(
        path.join(path.dirname(fileURLToPath(import.meta.url)), '../index.ts'),
        'utf-8'
      );
    }
    expect(src).not.toMatch(/\.splog\s*=/);
    expect(src).not.toMatch(/\.spwarn\s*=/);
    expect(src).not.toMatch(/\.sperror\s*=/);
  });
});
