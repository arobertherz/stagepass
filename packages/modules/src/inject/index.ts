(function () {
  // Type definitions
  type InjectPosition =
    | 'head'
    | 'body-start'
    | 'body-end'
    | { target: string; action: 'before' | 'after' };

  interface InjectOptions {
    src: string;
    type?: 'script' | 'style';
    stagepass?: boolean;
    localPath?: string;
    path?: string; // Alias for localPath
    id?: string;
    async?: boolean;
    defer?: boolean;
    /** In production, append ?_cb=timestamp to force fresh load */
    cacheBust?: boolean;
    attributes?: Record<string, string>;
    position?: InjectPosition;
  }

  interface InjectBatchOptions {
    scripts?: InjectOptions[];
    styles?: InjectOptions[];
  }

  // Get Stagepass vars (must be available from core loader)
  function getVars() {
    // Support window.stagepass, global stagepass, and sp alias
    const sp = (window as any).stagepass || (globalThis as any).stagepass || (window as any).sp || (globalThis as any).sp;
    if (!sp || !sp.vars) {
      throw new Error('Stagepass core loader must be loaded before modules');
    }
    return sp.vars;
  }

  // Logging helper
  function log(message: string) {
    const vars = getVars();
    if (vars.env === 'local' || vars.env === 'staging') {
      console.log(`[Stagepass] ${message}`);
    }
  }

  // Extract filename from URL
  function extractFilename(url: string | undefined): string {
    if (!url || typeof url !== 'string') return 'file';
    try {
      const urlObj = new URL(url);
      // pathname is always a string (empty string if no path)
      const pathname = urlObj.pathname || '';
      if (!pathname || pathname.length === 0) {
        // Fallback to regex extraction if pathname is empty
        const match = url.match(/\/([^\/\?#]+)(?:\?|#|$)/);
        return match ? match[1] : 'file';
      }
      const pathParts = pathname.split('/');
      return pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2] || 'file';
    } catch (e) {
      // If URL parsing fails, try regex fallback
      try {
        const match = url.match(/\/([^\/\?#]+)(?:\?|#|$)/);
        return match ? match[1] : 'file';
      } catch (e2) {
        return 'file';
      }
    }
  }

  // Auto-detect type from extension
  function detectType(src: string | undefined, explicitType?: 'script' | 'style'): 'script' | 'style' {
    if (explicitType) return explicitType;
    if (!src || typeof src !== 'string') return 'script'; // Default if src is missing or invalid
    try {
      const ext = src.split('.').pop()?.toLowerCase();
      if (ext === 'css') return 'style';
    } catch (e) {
      // If split fails, default to script
    }
    return 'script'; // Default to script
  }

  // Resolve source URL (local vs production)
  function resolveSource(options: InjectOptions): string {
    const vars = getVars();
    const { src, stagepass, localPath, path, cacheBust } = options;

    // Ensure src is valid
    if (!src || typeof src !== 'string') {
      throw new Error('Invalid src: must be a non-empty string');
    }

    // If stagepass is enabled and we're in local mode, use loader's resolver when available
    if (stagepass !== false && vars.isLocal) {
      const filename = localPath || path || extractFilename(src);
      if (!filename || typeof filename !== 'string') return src;
      const cleanPath = filename.startsWith('/') ? filename.substring(1) : filename;
      const sp = (window as any).stagepass || (globalThis as any).stagepass || (window as any).sp || (globalThis as any).sp;
      if (sp && typeof sp.resolveLocalUrl === 'function') {
        const localUrl = sp.resolveLocalUrl(cleanPath);
        if (localUrl) return localUrl;
      }
      return `https://${vars.domain}/${cleanPath}?_cb=${vars.timestamp}`;
    }

    // Production: optional cache busting
    if (cacheBust) {
      return src + (src.includes('?') ? '&' : '?') + '_cb=' + Date.now();
    }
    return src;
  }

  // Check if element already exists (deduplication)
  function isAlreadyInjected(options: InjectOptions, resolvedSrc: string): boolean {
    const { id, type } = options;
    const detectedType = detectType(options.src, type);

    // Check by ID first (most reliable)
    if (id) {
      const existing = document.getElementById(id);
      if (existing) {
        log(`Skipping injection: Element with id "${id}" already exists`);
        return true;
      }
    }

    // Check by src/href
    const selector = detectedType === 'script' 
      ? `script[src="${resolvedSrc}"]`
      : `link[href="${resolvedSrc}"]`;
    
    const existing = document.querySelector(selector);
    if (existing) {
      log(`Skipping injection: Resource "${resolvedSrc}" already loaded`);
      return true;
    }

    return false;
  }

  // Get insertion point based on position
  function getInsertionPoint(position: InjectPosition = 'body-end'): Node | null {
    if (typeof position === 'string') {
      switch (position) {
        case 'head':
          return document.head;
        case 'body-start':
          return document.body?.firstChild || document.body;
        case 'body-end':
          return document.body;
        default:
          return document.body;
      }
    }

    // Relative positioning
    const { target, action } = position;
    const targetEl = document.querySelector(target);
    
    if (!targetEl) {
      log(`Warning: Target selector "${target}" not found, falling back to body-end`);
      return document.body;
    }

    return action === 'before' ? targetEl : targetEl.nextSibling || targetEl.parentNode;
  }

  // Inject a single resource
  function injectSingle(options: InjectOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      // Validate required fields
      if (!options.src) {
        const vars = getVars();
        const error = new Error('InjectOptions must have a "src" property');
        if (vars.env !== 'production') {
          console.error('[Stagepass]', error);
        }
        reject(error);
        return;
      }
      
      const vars = getVars();
      const detectedType = detectType(options.src, options.type);
      const resolvedSrc = resolveSource(options);

      // Deduplication check
      if (isAlreadyInjected(options, resolvedSrc)) {
        resolve();
        return;
      }

      // Create element
      const element = detectedType === 'script'
        ? document.createElement('script')
        : document.createElement('link');

      if (detectedType === 'script') {
        const script = element as HTMLScriptElement;
        script.src = resolvedSrc;
        
        // Set async/defer
        if (options.async) {
          script.async = true;
        } else if (options.defer !== false) {
          script.defer = true; // Default to defer
        }

        // Set ID if provided
        if (options.id) {
          script.id = options.id;
        }

        // Add custom attributes
        if (options.attributes) {
          Object.entries(options.attributes).forEach(([key, value]) => {
            script.setAttribute(key, value);
          });
        }

        // Handle load/error
        script.onload = () => {
          log(`Injected: ${resolvedSrc}`);
          resolve();
        };
        script.onerror = () => {
          const error = new Error(`Failed to load script: ${resolvedSrc}`);
          if (vars.env !== 'production') {
            console.error('[Stagepass]', error);
          }
          reject(error);
        };
      } else {
        const link = element as HTMLLinkElement;
        link.rel = 'stylesheet';
        link.href = resolvedSrc;

        if (options.id) {
          link.id = options.id;
        }

        if (options.attributes) {
          Object.entries(options.attributes).forEach(([key, value]) => {
            link.setAttribute(key, value);
          });
        }

        // Stylesheets don't have onload in all browsers, use a workaround
        const checkLoad = setInterval(() => {
          const sheet = link.sheet || (link as any).styleSheet;
          if (sheet) {
            clearInterval(checkLoad);
            log(`Injected: ${resolvedSrc}`);
            resolve();
          }
        }, 10);

        // Timeout after 5 seconds
        setTimeout(() => {
          clearInterval(checkLoad);
          const sheet = link.sheet || (link as any).styleSheet;
          if (!sheet) {
            const error = new Error(`Failed to load stylesheet: ${resolvedSrc}`);
            if (vars.env !== 'production') {
              console.error('[Stagepass]', error);
            }
            reject(error);
          }
        }, 5000);
      }

      // Insert element
      const insertionPoint = getInsertionPoint(options.position);
      if (!insertionPoint) {
        reject(new Error('Could not find insertion point'));
        return;
      }

      if (insertionPoint === document.head || insertionPoint === document.body) {
        insertionPoint.appendChild(element);
      } else {
        // Relative positioning
        const parent = insertionPoint.parentNode;
        if (parent) {
          if (typeof options.position === 'object' && options.position.action === 'before') {
            parent.insertBefore(element, insertionPoint);
          } else {
            parent.insertBefore(element, insertionPoint.nextSibling);
          }
        }
      }
    });
  }

  // Main inject function (handles single, array, or batch object)
  async function inject(options: InjectOptions | InjectOptions[] | InjectBatchOptions): Promise<void> {
    let items: InjectOptions[] = [];
    
    // Handle batch object: { scripts: [...], styles: [...] }
    if (!Array.isArray(options) && typeof options === 'object' && ('scripts' in options || 'styles' in options)) {
      const batch = options as InjectBatchOptions;
      if (batch.scripts) {
        // Filter out invalid items (must have src as non-empty string)
        items.push(...batch.scripts
          .filter((item): item is InjectOptions => {
            return item && typeof item === 'object' && 'src' in item && typeof item.src === 'string' && item.src.trim().length > 0;
          })
          .map(item => ({ ...item, type: 'script' as const })));
      }
      if (batch.styles) {
        // Filter out invalid items (must have src as non-empty string)
        items.push(...batch.styles
          .filter((item): item is InjectOptions => {
            return item && typeof item === 'object' && 'src' in item && typeof item.src === 'string' && item.src.trim().length > 0;
          })
          .map(item => ({ ...item, type: 'style' as const })));
      }
    } else {
      // Handle single object or array
      // Type guard: ensure options is InjectOptions (not InjectBatchOptions)
      if (Array.isArray(options)) {
        items = options.filter((item): item is InjectOptions => 
          item && typeof item === 'object' && 'src' in item && typeof item.src === 'string' && item.src.trim().length > 0
        );
      } else if (options && typeof options === 'object' && 'src' in options && typeof (options as any).src === 'string' && (options as any).src.trim().length > 0) {
        items = [options as InjectOptions];
      }
    }
    
    for (const item of items) {
      try {
        await injectSingle(item);
      } catch (error) {
        // Continue with other items even if one fails
        const vars = getVars();
        if (vars.env !== 'production') {
          console.error('[Stagepass] Injection error:', error);
        }
      }
    }
  }

  // Expose API
  const sp = (window as any).stagepass = (window as any).stagepass || {};
  sp.inject = inject;
  // Also expose as global variable (without window prefix)
  (globalThis as any).stagepass = sp;
  (window as any).sp = sp;
  (globalThis as any).sp = sp;
})();
