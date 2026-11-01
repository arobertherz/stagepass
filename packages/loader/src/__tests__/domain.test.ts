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
});

describe('cleanDomain', () => {
  it('strips scheme and trailing slash', () => {
    expect(cleanDomain('https://test.sp')).toBe('test.sp');
    expect(cleanDomain('http://test.sp/')).toBe('test.sp');
    expect(cleanDomain(null)).toBe(null);
  });
});
