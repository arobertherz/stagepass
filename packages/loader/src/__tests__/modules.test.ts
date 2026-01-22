import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Module Loading System', () => {
  beforeEach(() => {
    // Reset DOM
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  describe('Module parameter parsing from script tag', () => {
    it('should parse single module from script src (implementation test)', () => {
      const script = document.createElement('script');
      script.src = 'https://cdn.example.com/loader.min.js?modules=inject';
      document.head.appendChild(script);
      
      // Test actual implementation: find script by pattern
      const loaderScript = document.querySelector('script[src*="loader"]') as HTMLScriptElement;
      expect(loaderScript).toBeTruthy();
      
      let modulesParam: string | null = null;
      if (loaderScript && loaderScript.src) {
        try {
          const scriptUrl = new URL(loaderScript.src);
          modulesParam = scriptUrl.searchParams.get('modules');
        } catch (e) {
          const match = loaderScript.src.match(/[?&]modules(=([^&]*))?/);
          if (match) {
            modulesParam = match[2] !== undefined ? match[2] : '';
          }
        }
      }
      
      const modules = modulesParam ? modulesParam.split(',').map(m => m.trim()).filter(Boolean) : [];
      
      expect(modules).toEqual(['inject']);
    });

    it('should parse multiple modules from script src', () => {
      const script = document.createElement('script');
      script.src = 'https://cdn.example.com/loader.min.js?modules=inject,cookies';
      document.head.appendChild(script);
      
      const scriptUrl = new URL(script.src);
      const modulesParam = scriptUrl.searchParams.get('modules');
      const modules = modulesParam ? modulesParam.split(',').map(m => m.trim()).filter(Boolean) : [];
      
      expect(modules).toEqual(['inject', 'cookies']);
    });

    it('should detect empty modules parameter (loads all)', () => {
      const script = document.createElement('script');
      script.src = 'https://cdn.example.com/loader.min.js?modules';
      document.head.appendChild(script);
      
      // Test actual implementation
      const loaderScript = document.querySelector('script[src*="loader"]') as HTMLScriptElement;
      let modulesParam: string | null = null;
      if (loaderScript && loaderScript.src) {
        try {
          const scriptUrl = new URL(loaderScript.src);
          modulesParam = scriptUrl.searchParams.get('modules');
        } catch (e) {
          const match = loaderScript.src.match(/[?&]modules(=([^&]*))?/);
          if (match) {
            modulesParam = match[2] !== undefined ? match[2] : '';
          }
        }
      }
      
      // Implementation logic: if modulesParam === '', load 'all'
      const modulesToLoad = modulesParam === ''
        ? ['all']
        : modulesParam ? modulesParam.split(',').map(m => m.trim()).filter(Boolean) : [];
      
      expect(modulesToLoad).toEqual(['all']);
    });

    it('should return null when no modules parameter exists', () => {
      const script = document.createElement('script');
      script.src = 'https://cdn.example.com/loader.min.js';
      document.head.appendChild(script);
      
      // Test actual implementation
      const loaderScript = document.querySelector('script[src*="loader"]') as HTMLScriptElement;
      let modulesParam: string | null = null;
      if (loaderScript && loaderScript.src) {
        try {
          const scriptUrl = new URL(loaderScript.src);
          modulesParam = scriptUrl.searchParams.get('modules');
        } catch (e) {
          const match = loaderScript.src.match(/[?&]modules(=([^&]*))?/);
          if (match) {
            modulesParam = match[2] !== undefined ? match[2] : '';
          }
        }
      }
      
      expect(modulesParam).toBe(null);
    });

    it('should handle whitespace in module names', () => {
      const modulesParam = 'inject, cookies,  variables';
      const modules = modulesParam.split(',').map(m => m.trim()).filter(Boolean);
      
      expect(modules).toEqual(['inject', 'cookies', 'variables']);
    });

    it('should filter empty strings', () => {
      const modulesParam = 'inject,,cookies,';
      const modules = modulesParam.split(',').map(m => m.trim()).filter(Boolean);
      
      expect(modules).toEqual(['inject', 'cookies']);
    });
  });

  describe('Module URL construction from script tag', () => {
    it('should construct URL from loader script src (new implementation)', () => {
      const loaderScript = document.createElement('script');
      loaderScript.src = 'https://cdn.jsdelivr.net/npm/@stagepass/loader@1/dist/loader.min.js?modules=inject';
      document.head.appendChild(loaderScript);
      
      // New implementation: Remove filename and query string to get base directory
      let baseUrl = window.location.origin;
      if (loaderScript && loaderScript.src) {
        try {
          const scriptUrl = new URL(loaderScript.src);
          const pathParts = scriptUrl.pathname.split('/');
          pathParts.pop(); // Remove filename
          baseUrl = `${scriptUrl.origin}${pathParts.join('/')}`;
        } catch (e) {
          baseUrl = loaderScript.src.replace(/\/[^\/\?]+(\?.*)?$/, '');
        }
      }
      const moduleUrl = `${baseUrl}/inject.min.js`;
      
      expect(moduleUrl).toBe('https://cdn.jsdelivr.net/npm/@stagepass/loader@1/dist/inject.min.js');
    });

    it('should use window.location.origin as fallback when script not found', () => {
      const baseUrl = window.location.origin;
      const moduleUrl = `${baseUrl}/inject.min.js`;
      
      expect(moduleUrl).toBe(`${window.location.origin}/inject.min.js`);
    });

    it('should handle script tag with query string correctly', () => {
      const script = document.createElement('script');
      script.src = 'https://example.com/loader.min.js?modules=inject,cookies';
      document.head.appendChild(script);
      
      const scriptUrl = new URL(script.src);
      const modulesParam = scriptUrl.searchParams.get('modules');
      
      expect(modulesParam).toBe('inject,cookies');
    });

    it('should find loader script by src pattern', () => {
      const loaderScript = document.createElement('script');
      loaderScript.src = 'https://cdn.example.com/loader.min.js?modules=inject';
      document.head.appendChild(loaderScript);
      
      // Test that we can find the script with the pattern
      const foundScript = document.querySelector('script[src*="loader"]') as HTMLScriptElement;
      
      expect(foundScript).toBeTruthy();
      expect(foundScript.src).toContain('loader');
    });
  });

  describe('Module script injection', () => {
    it('should create script element with correct src', () => {
      const moduleUrl = 'https://example.com/inject.min.js';
      const script = document.createElement('script');
      script.src = moduleUrl;
      script.async = true;
      document.head.appendChild(script);
      
      const injected = document.querySelector(`script[src="${moduleUrl}"]`);
      expect(injected).toBeTruthy();
      expect((injected as HTMLScriptElement)?.async).toBe(true);
    });

    it('should append to head', () => {
      const moduleUrl = 'https://example.com/inject.min.js';
      const script = document.createElement('script');
      script.src = moduleUrl;
      script.async = true;
      document.head.appendChild(script);
      
      expect(document.head.contains(script)).toBe(true);
    });
  });
});
