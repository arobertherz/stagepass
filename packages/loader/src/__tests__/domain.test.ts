import { describe, it, expect } from 'vitest';
import { isValidDomain, cleanDomain } from '../domain.js';

describe('isValidDomain', () => {
  it('accepts safe .sp hostnames and keywords', () => {
    expect(isValidDomain('test.sp')).toBe(true);
    expect(isValidDomain('my-project.sp')).toBe(true);
    expect(isValidDomain('sub.domain.sp')).toBe(true);
    expect(isValidDomain('debug')).toBe(true);
    expect(isValidDomain('localhost')).toBe(true);
    expect(isValidDomain('localhost:8080')).toBe(true);
  });

  it('rejects unsafe or external values', () => {
    expect(isValidDomain('example.com')).toBe(false);
    expect(isValidDomain('invalid')).toBe(false);
    expect(isValidDomain('"><img>.sp')).toBe(false);
    expect(isValidDomain('evil.com.sp')).toBe(true); // still ends in .sp with valid labels
    expect(isValidDomain('foo bar.sp')).toBe(false);
    expect(isValidDomain('https://test.sp')).toBe(false);
    expect(isValidDomain('localhost:99999')).toBe(false);
  });

  it('accepts localhost ports 1–65535 without leading zeros (AC-2)', () => {
    expect(isValidDomain('localhost')).toBe(true);
    expect(isValidDomain('localhost:1')).toBe(true);
    expect(isValidDomain('localhost:65535')).toBe(true);
  });

  it('rejects localhost port 0, out of range, leading zeros and non-decimal (AC-2)', () => {
    expect(isValidDomain('localhost:0')).toBe(false);
    expect(isValidDomain('localhost:65536')).toBe(false);
    expect(isValidDomain('localhost:99999')).toBe(false);
    expect(isValidDomain('localhost:080')).toBe(false);
    expect(isValidDomain('localhost:00080')).toBe(false);
    expect(isValidDomain('localhost:00000')).toBe(false);
    expect(isValidDomain('localhost:')).toBe(false);
    expect(isValidDomain('localhost:8a')).toBe(false);
    expect(isValidDomain('localhost:+80')).toBe(false);
    expect(isValidDomain('localhost:-1')).toBe(false);
  });

  it('port regex is capped at five digits via \\d{0,4} (AC-2)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const src = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '../domain.ts'),
      'utf-8'
    );
    expect(src).toMatch(/\[1-9\]\\d\{0,4\}/);
  });
});

describe('cleanDomain', () => {
  it('strips scheme and trailing slash', () => {
    expect(cleanDomain('https://test.sp')).toBe('test.sp');
    expect(cleanDomain('http://test.sp/')).toBe('test.sp');
    expect(cleanDomain(null)).toBe(null);
  });
});
