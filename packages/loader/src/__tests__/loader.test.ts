import { describe, it, expect } from 'vitest';
import { isValidDomain, cleanDomain } from '../domain.js';
import { parseSession, serializeSession, createSession } from '../session.js';

describe('Loader - Domain Validation', () => {
  it('should accept .sp domains', () => {
    for (const domain of ['test.sp', 'my-project.sp', 'sub.domain.sp']) {
      expect(isValidDomain(domain)).toBe(true);
    }
  });

  it('should accept localhost and debug', () => {
    expect(isValidDomain('localhost')).toBe(true);
    expect(isValidDomain('debug')).toBe(true);
    expect(isValidDomain('localhost:8080')).toBe(true);
  });

  it('should reject external hosts', () => {
    expect(isValidDomain('example.com')).toBe(false);
    expect(isValidDomain('invalid')).toBe(false);
  });
});

describe('Loader - URL Cleaning', () => {
  it('should remove https:// prefix', () => {
    expect(cleanDomain('https://test.sp')).toBe('test.sp');
    expect(cleanDomain('http://test.sp')).toBe('test.sp');
    expect(cleanDomain('https://test.sp/')).toBe('test.sp');
    expect(cleanDomain(null)).toBe(null);
  });
});

describe('Loader - Session Management', () => {
  it('stores JSON sessions with expiry', () => {
    const now = Date.now();
    const record = createSession('test.sp', 12, now);
    const raw = serializeSession(record);
    expect(parseSession(raw, now)?.domain).toBe('test.sp');
  });

  it('clears legacy plain-string sessions', () => {
    expect(parseSession('invalid.com')).toBe(null);
    expect(parseSession('test.sp')).toBe(null);
  });
});

describe('Loader - removed deprecated globals', () => {
  it('source no longer assigns splog/spwarn/sperror', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const src = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '../index.ts'),
      'utf-8'
    );
    expect(src).not.toMatch(/window\.splog\s*=/);
    expect(src).not.toMatch(/window\.spwarn\s*=/);
    expect(src).not.toMatch(/window\.sperror\s*=/);
  });
});
