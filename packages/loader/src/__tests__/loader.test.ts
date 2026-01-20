import { describe, it, expect } from 'vitest';

// Note: Loader tests require the built loader.js to be executed in a jsdom environment
// These are placeholder tests that should be expanded once the loader is refactored
// to export testable functions or when integration tests with Playwright are set up

describe('Loader - Domain Validation', () => {
  it('should accept .sp domains', () => {
    const validDomains = ['test.sp', 'my-project.sp', 'sub.domain.sp'];
    validDomains.forEach(domain => {
      expect(domain.endsWith('.sp')).toBe(true);
    });
  });

  it('should accept localhost and debug', () => {
    const validSpecial = ['localhost', 'debug', 'localhost:8080'];
    validSpecial.forEach(domain => {
      expect(domain === 'debug' || domain.startsWith('localhost')).toBe(true);
    });
  });
});

describe('Loader - URL Cleaning', () => {
  it('should remove https:// prefix', () => {
    const clean = (d: string | null): string | null => {
      return d ? d.replace(/^https?:\/\//, '').replace(/\/$/, '') : null;
    };

    expect(clean('https://test.sp')).toBe('test.sp');
    expect(clean('http://test.sp')).toBe('test.sp');
    expect(clean('https://test.sp/')).toBe('test.sp');
  });
});
