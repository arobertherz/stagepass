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
    id?: string;
    async?: boolean;
    defer?: boolean;
    attributes?: Record<string, string>;
    position?: InjectPosition;
  }

  // Get Stagepass vars (must be available from core loader)
  function getVars() {
    // Support both window.stagepass and stagepass (global variable)
    const sp = (window as any).stagepass || (globalThis as any).stagepass;
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
  function extractFilename(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');
      return pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2] || 'file';
    } catch (e) {
      const match = url.match(/\/([^\/\?#]+)(?:\?|#|$)/);
      return match ? match[1] : 'file';
    }
  }

  // Auto-detect type from extension
  function detectType(src: string, explicitType?: 'script' | 'style'): 'script' | 'style' {
    if (explicitType) return explicitType;
    const ext = src.split('.').pop()?.toLowerCase();
    if (ext === 'css') return 'style';
    return 'script'; // Default to script
  }

  // Resolve source URL (local vs production)
  function resolveSource(options: InjectOptions): string {
    const vars = getVars();
    const { src, stagepass, localPath } = options;

    // If stagepass is enabled and we're in local mode
    if (stagepass !== false && vars.isLocal) {
      const filename = localPath || extractFilename(src);
      const cleanPath = filename.startsWith('/') ? filename.substring(1) : filename;
      return `https://${vars.domain}/${cleanPath}?_cb=${vars.timestamp}`;
    }

    // Production URL
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

  // Main inject function (handles single or array)
  async function inject(options: InjectOptions | InjectOptions[]): Promise<void> {
    const items = Array.isArray(options) ? options : [options];
    
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
})();
