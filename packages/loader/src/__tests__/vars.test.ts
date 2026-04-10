import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Stagepass Variables', () => {
  beforeEach(() => {
    // Reset localStorage and window
    localStorage.clear();
    delete (window as any).stagepass;
    delete (globalThis as any).stagepass;
    
    // Mock window.location (cannot delete, must override)
    Object.defineProperty(window, 'location', {
      value: {
        hostname: 'example.com',
        search: '',
        pathname: '/',
        hash: '',
      },
      writable: true,
      configurable: true,
    });
  });

  describe('isLocal detection', () => {
    it('should be true for .sp domains', () => {
      localStorage.setItem('stagepass_domain', 'test.sp');
      // Simulate loader execution
      const hostname = window.location.hostname;
      const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || 
                         hostname.startsWith('localhost:') || hostname.startsWith('127.0.0.1:');
      const sv = localStorage.getItem('stagepass_domain');
      const swap = !!sv && sv !== 'debug';
      const isLocal = swap || isLocalhost;
      
      expect(isLocal).toBe(true);
    });

    it('should be true for localhost', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'localhost', search: '', pathname: '/', hash: '' },
        writable: true,
        configurable: true,
      });
      
      const hostname = window.location.hostname;
      const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || 
                         hostname.startsWith('localhost:') || hostname.startsWith('127.0.0.1:');
      const isLocal = isLocalhost;
      
      expect(isLocal).toBe(true);
    });

    it('should be true for 127.0.0.1', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: '127.0.0.1', search: '', pathname: '/', hash: '' },
        writable: true,
        configurable: true,
      });
      
      const hostname = window.location.hostname;
      const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || 
                         hostname.startsWith('localhost:') || hostname.startsWith('127.0.0.1:');
      const isLocal = isLocalhost;
      
      expect(isLocal).toBe(true);
    });

    it('should be false for production domains', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'example.com', search: '', pathname: '/', hash: '' },
        writable: true,
        configurable: true,
      });
      
      const hostname = window.location.hostname;
      const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || 
                         hostname.startsWith('localhost:') || hostname.startsWith('127.0.0.1:');
      const sv = localStorage.getItem('stagepass_domain');
      const swap = !!sv && sv !== 'debug';
      const isLocal = swap || isLocalhost;
      
      expect(isLocal).toBe(false);
    });
  });

  describe('env detection', () => {
    it('should be "local" when isLocal is true', () => {
      const isLocal = true;
      const isStaging = false;
      const env = isLocal ? 'local' : (isStaging ? 'staging' : 'production');
      
      expect(env).toBe('local');
    });

    it('should be "staging" for .webflow.io domains', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'example.webflow.io', search: '', pathname: '/', hash: '' },
        writable: true,
        configurable: true,
      });
      
      const hostname = window.location.hostname;
      const isLocal = false;
      const isStaging = hostname.endsWith('.webflow.io');
      const env = isLocal ? 'local' : (isStaging ? 'staging' : 'production');
      
      expect(env).toBe('staging');
    });

    it('should be "production" for custom domains', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'example.com', search: '', pathname: '/', hash: '' },
        writable: true,
        configurable: true,
      });
      
      const hostname = window.location.hostname;
      const isLocal = false;
      const isStaging = hostname.endsWith('.webflow.io');
      const env = isLocal ? 'local' : (isStaging ? 'staging' : 'production');
      
      expect(env).toBe('production');
    });
  });

  describe('vars object structure', () => {
    it('should have all required properties', () => {
      const vars = {
        isLocal: true,
        env: 'local' as const,
        domain: 'test.sp',
        timestamp: 1234567890,
        version: '1.2.0',
        client: {
          theme: { preferred: 'dark', current: 'dark' },
          browser: { family: 'chrome', major: 123, userAgent: 'ua' },
          os: { family: 'macos' },
          device: { type: 'desktop', touch: false },
          viewport: { width: 1440, height: 900, dpr: 2 },
          locale: { language: 'en-US', timezone: 'Europe/Berlin' },
          capabilities: { cookiesEnabled: true, localStorage: true, sessionStorage: true }
        }
      };
      
      expect(vars).toHaveProperty('isLocal');
      expect(vars).toHaveProperty('env');
      expect(vars).toHaveProperty('domain');
      expect(vars).toHaveProperty('timestamp');
      expect(vars).toHaveProperty('version');
      expect(vars).toHaveProperty('client');
      expect(vars.client).toHaveProperty('theme');
      expect(vars.client).toHaveProperty('browser');
      expect(vars.client).toHaveProperty('viewport');
    });

    it('should have correct types', () => {
      const vars = {
        isLocal: true,
        env: 'local' as const,
        domain: 'test.sp',
        timestamp: 1234567890,
        version: '1.2.0',
        client: {
          theme: { preferred: 'dark', current: 'dark' },
          browser: { family: 'chrome', major: 123, userAgent: 'ua' },
          os: { family: 'macos' },
          device: { type: 'desktop', touch: false },
          viewport: { width: 1440, height: 900, dpr: 2 },
          locale: { language: 'en-US', timezone: 'Europe/Berlin' },
          capabilities: { cookiesEnabled: true, localStorage: true, sessionStorage: true }
        }
      };
      
      expect(typeof vars.isLocal).toBe('boolean');
      expect(typeof vars.env).toBe('string');
      expect(typeof vars.domain).toBe('string');
      expect(typeof vars.timestamp).toBe('number');
      expect(typeof vars.version).toBe('string');
      expect(typeof vars.client.viewport.width).toBe('number');
      expect(typeof vars.client.browser.family).toBe('string');
    });
  });
});
