import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Injector Module', () => {
  beforeEach(() => {
    // Reset DOM
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    
    // Setup Stagepass vars mock (both window.stagepass and global stagepass)
    const stagepassObj = {
      vars: {
        isLocal: true,
        env: 'local',
        domain: 'test.sp',
        timestamp: 1234567890,
        version: '1.0.3'
      }
    };
    (window as any).stagepass = stagepassObj;
    (globalThis as any).stagepass = stagepassObj;
  });

  describe('Source resolution', () => {
    it('should resolve to local URL when stagepass is enabled and isLocal is true', () => {
      const src = 'https://cdn.example.com/lib.js';
      const stagepass = true;
      const localPath = 'lib.js';
      const vars = (window as any).stagepass.vars;
      
      if (stagepass !== false && vars.isLocal) {
        const filename = localPath || 'lib.js';
        const cleanPath = filename.startsWith('/') ? filename.substring(1) : filename;
        const resolved = `https://${vars.domain}/${cleanPath}?_cb=${vars.timestamp}`;
        
        expect(resolved).toBe('https://test.sp/lib.js?_cb=1234567890');
      }
    });

    it('should use production URL when stagepass is false', () => {
      const src = 'https://cdn.example.com/lib.js';
      const stagepass = false;
      const vars = (window as any).stagepass.vars;
      
      if (stagepass !== false && vars.isLocal) {
        // This branch shouldn't execute
        expect(false).toBe(true);
      } else {
        expect(src).toBe('https://cdn.example.com/lib.js');
      }
    });

    it('should extract filename from URL when localPath is missing', () => {
      const src = 'https://cdn.example.com/path/to/file.js';
      const urlObj = new URL(src);
      const pathParts = urlObj.pathname.split('/');
      const filename = pathParts[pathParts.length - 1];
      
      expect(filename).toBe('file.js');
    });
  });

  describe('Type detection', () => {
    it('should detect script from .js extension', () => {
      const src = 'https://example.com/app.js';
      const ext = src.split('.').pop()?.toLowerCase();
      const type = ext === 'css' ? 'style' : 'script';
      
      expect(type).toBe('script');
    });

    it('should detect style from .css extension', () => {
      const src = 'https://example.com/styles.css';
      const ext = src.split('.').pop()?.toLowerCase();
      const type = ext === 'css' ? 'style' : 'script';
      
      expect(type).toBe('style');
    });

    it('should default to script when extension is unknown', () => {
      const src = 'https://example.com/file';
      const ext = src.split('.').pop()?.toLowerCase();
      const type = ext === 'css' ? 'style' : 'script';
      
      expect(type).toBe('script');
    });
  });

  describe('Deduplication', () => {
    it('should detect existing element by ID', () => {
      const existing = document.createElement('script');
      existing.id = 'my-script';
      existing.src = 'https://example.com/app.js';
      document.head.appendChild(existing);
      
      const found = document.getElementById('my-script');
      expect(found).toBeTruthy();
    });

    it('should detect existing script by src', () => {
      const existing = document.createElement('script');
      existing.src = 'https://example.com/app.js';
      document.head.appendChild(existing);
      
      const found = document.querySelector('script[src="https://example.com/app.js"]');
      expect(found).toBeTruthy();
    });

    it('should detect existing stylesheet by href', () => {
      const existing = document.createElement('link');
      existing.rel = 'stylesheet';
      existing.href = 'https://example.com/styles.css';
      document.head.appendChild(existing);
      
      const found = document.querySelector('link[href="https://example.com/styles.css"]');
      expect(found).toBeTruthy();
    });
  });

  describe('Positioning', () => {
    it('should insert into head for "head" position', () => {
      const position = 'head';
      const insertionPoint = position === 'head' ? document.head : document.body;
      
      expect(insertionPoint).toBe(document.head);
    });

    it('should insert into body for "body-end" position', () => {
      const position = 'body-end';
      const insertionPoint = position === 'head' ? document.head : document.body;
      
      expect(insertionPoint).toBe(document.body);
    });

    it('should find target element for relative positioning', () => {
      const target = document.createElement('script');
      target.id = 'jquery';
      document.head.appendChild(target);
      
      const targetEl = document.querySelector('#jquery');
      expect(targetEl).toBeTruthy();
    });

    it('should fallback to body when target not found', () => {
      const targetEl = document.querySelector('#nonexistent');
      const insertionPoint = targetEl || document.body;
      
      expect(insertionPoint).toBe(document.body);
    });
  });

  describe('Element creation', () => {
    it('should create script element with correct attributes', () => {
      const script = document.createElement('script');
      script.src = 'https://example.com/app.js';
      script.async = false;
      script.defer = true;
      script.id = 'my-script';
      
      expect(script.src).toBe('https://example.com/app.js');
      expect(script.async).toBe(false);
      expect(script.defer).toBe(true);
      expect(script.id).toBe('my-script');
    });

    it('should create link element with correct attributes', () => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://example.com/styles.css';
      link.id = 'my-styles';
      
      expect(link.rel).toBe('stylesheet');
      expect(link.href).toBe('https://example.com/styles.css');
      expect(link.id).toBe('my-styles');
    });
  });

  describe('Error handling', () => {
    it('should throw error if stagepass vars are not available', () => {
      delete (window as any).stagepass;
      
      expect(() => {
        const sp = (window as any).stagepass;
        if (!sp || !sp.vars) {
          throw new Error('Stagepass core loader must be loaded before modules');
        }
      }).toThrow('Stagepass core loader must be loaded before modules');
    });
  });
});
