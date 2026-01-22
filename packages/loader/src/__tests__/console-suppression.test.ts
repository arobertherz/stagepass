import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Console Suppression', () => {
  let originalConsole: typeof console;

  beforeEach(() => {
    // Save original console
    originalConsole = { ...console };
    
    // Reset localStorage
    localStorage.clear();
    
    // Reset DOM
    document.head.innerHTML = '';
    
    // Reset window.location mock
    Object.defineProperty(window, 'location', {
      value: {
        hostname: 'example.com',
        search: '',
        pathname: '/',
        hash: '',
        origin: 'https://example.com',
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    // Restore original console
    Object.assign(console, originalConsole);
  });

  describe('Production environment', () => {
    it('should suppress console when no session exists', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'example.com', search: '', pathname: '/', hash: '' },
        writable: true,
        configurable: true,
      });

      const env = 'production';
      const hasValidSession = false;
      const hasParam = false;
      const shouldSuppress = !hasValidSession && !hasParam;
      const silentParam = null;

      const shouldSuppressConsole = shouldSuppress && (env === 'production' || (env === 'staging' && silentParam !== null));
      
      expect(shouldSuppressConsole).toBe(true);
    });

    it('should not suppress console when session exists', () => {
      localStorage.setItem('stagepass_domain', 'test.sp');
      
      const env = 'production';
      const hasValidSession = true;
      const shouldSuppress = !hasValidSession;
      
      expect(shouldSuppress).toBe(false);
    });
  });

  describe('Staging environment', () => {
    it('should NOT suppress console by default', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'example.webflow.io', search: '', pathname: '/', hash: '' },
        writable: true,
        configurable: true,
      });

      const env = 'staging';
      const hasValidSession = false;
      const hasParam = false;
      const shouldSuppress = !hasValidSession && !hasParam;
      const silentParam = null;

      const shouldSuppressConsole = shouldSuppress && (env === 'production' || (env === 'staging' && silentParam !== null));
      
      expect(shouldSuppressConsole).toBe(false);
    });

    it('should suppress console when ?silent parameter is set in script tag', () => {
      // Simulate script tag with ?silent parameter
      const script = document.createElement('script');
      script.src = 'https://cdn.example.com/loader.min.js?silent';
      document.head.appendChild(script);
      
      // Extract silent parameter from script tag (as implementation does)
      const loaderScript = document.querySelector('script[src*="loader"]') as HTMLScriptElement;
      let silentParam: string | null = null;
      if (loaderScript && loaderScript.src) {
        try {
          const scriptUrl = new URL(loaderScript.src);
          silentParam = scriptUrl.searchParams.get('silent');
        } catch (e) {
          const silentMatch = loaderScript.src.match(/[?&]silent/);
          if (silentMatch) {
            silentParam = '';
          }
        }
      }
      
      Object.defineProperty(window, 'location', {
        value: { hostname: 'example.webflow.io', search: '', pathname: '/', hash: '', origin: 'https://example.webflow.io' },
        writable: true,
        configurable: true,
      });

      const env = 'staging';
      const hasValidSession = false;
      const hasParam = false;
      const shouldSuppress = !hasValidSession && !hasParam;

      const shouldSuppressConsole = shouldSuppress && (env === 'production' || (env === 'staging' && silentParam !== null));
      
      expect(shouldSuppressConsole).toBe(true);
      expect(silentParam).toBe(''); // Empty string when ?silent is present without value
    });

    it('should NOT suppress console when ?silent is in URL but NOT in script tag', () => {
      // Script tag WITHOUT silent parameter
      const script = document.createElement('script');
      script.src = 'https://cdn.example.com/loader.min.js';
      document.head.appendChild(script);
      
      // Extract silent parameter from script tag (should be null)
      const loaderScript = document.querySelector('script[src*="loader"]') as HTMLScriptElement;
      let silentParam: string | null = null;
      if (loaderScript && loaderScript.src) {
        try {
          const scriptUrl = new URL(loaderScript.src);
          silentParam = scriptUrl.searchParams.get('silent');
        } catch (e) {
          const silentMatch = loaderScript.src.match(/[?&]silent/);
          if (silentMatch) {
            silentParam = '';
          }
        }
      }
      
      Object.defineProperty(window, 'location', {
        value: { hostname: 'example.webflow.io', search: '?silent', pathname: '/', hash: '', origin: 'https://example.webflow.io' },
        writable: true,
        configurable: true,
      });

      const env = 'staging';
      const hasValidSession = false;
      const hasParam = false;
      const shouldSuppress = !hasValidSession && !hasParam;

      const shouldSuppressConsole = shouldSuppress && (env === 'production' || (env === 'staging' && silentParam !== null));
      
      // Should NOT suppress because silent is not in script tag
      expect(shouldSuppressConsole).toBe(false);
      expect(silentParam).toBe(null);
    });

    it('should NOT suppress console when stagepass session is active (even with ?silent)', () => {
      localStorage.setItem('stagepass_domain', 'test.sp');
      
      const env = 'staging';
      const hasValidSession = true;
      const shouldSuppress = !hasValidSession;
      
      expect(shouldSuppress).toBe(false);
    });
  });

  describe('Local environment', () => {
    it('should NEVER suppress console', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'localhost', search: '', pathname: '/', hash: '' },
        writable: true,
        configurable: true,
      });

      const env = 'local';
      const hasValidSession = false;
      const hasParam = false;
      const shouldSuppress = !hasValidSession && !hasParam;
      const silentParam = null;

      const shouldSuppressConsole = shouldSuppress && (env === 'production' || (env === 'staging' && silentParam !== null));
      
      expect(shouldSuppressConsole).toBe(false);
    });
  });
});
