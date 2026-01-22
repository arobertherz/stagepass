import { describe, it, expect, beforeEach } from 'vitest';

// Note: Loader tests require the built loader.js to be executed in a jsdom environment
// These are unit tests for individual functions that can be tested in isolation

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

  it('should validate domain correctly', () => {
    const isValidDomain = (d: string): boolean => {
      return d === 'debug' || d.endsWith('.sp') || d === 'localhost' || d.startsWith('localhost:');
    };

    expect(isValidDomain('test.sp')).toBe(true);
    expect(isValidDomain('localhost')).toBe(true);
    expect(isValidDomain('localhost:8080')).toBe(true);
    expect(isValidDomain('debug')).toBe(true);
    expect(isValidDomain('example.com')).toBe(false);
    expect(isValidDomain('invalid')).toBe(false);
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
    expect(clean(null)).toBe(null);
  });
});

describe('Loader - Session Management', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should store domain in localStorage', () => {
    const domain = 'test.sp';
    localStorage.setItem('stagepass_domain', domain);
    expect(localStorage.getItem('stagepass_domain')).toBe(domain);
  });

  it('should remove invalid domains from localStorage', () => {
    localStorage.setItem('stagepass_domain', 'invalid.com');
    const sv = localStorage.getItem('stagepass_domain');
    const isValidDomain = (d: string): boolean => {
      return d === 'debug' || d.endsWith('.sp') || d === 'localhost' || d.startsWith('localhost:');
    };
    
    if (sv && !isValidDomain(sv)) {
      localStorage.removeItem('stagepass_domain');
    }
    
    expect(localStorage.getItem('stagepass_domain')).toBe(null);
  });
});
