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
    /**
     * @deprecated In v2 production no longer appends a per-view timestamp.
     * Prefer `version` (appends `?v=<version>`). Ignored for timestamp behaviour.
     */
    cacheBust?: boolean;
    /** Production version token appended as `?v=` (URL-encoded). */
    version?: string;
    attributes?: Record<string, string>;
    position?: InjectPosition;
    /** Subresource Integrity hash (scripts/styles). */
    integrity?: string;
    /** CORS mode for the element. */
    crossorigin?: string;
    /** CSP nonce. */
    nonce?: string;
    /** When set, reject src hosts outside this list (warning + skip). */
    allowedHosts?: string[];
  }

  interface InjectBatchOptions {
    scripts?: InjectOptions[];
    styles?: InjectOptions[];
  }

  function getStagepassObject(): any | null {
    const sp =
      (window as any).stagepass ||
      (globalThis as any).stagepass ||
      (window as any).sp ||
      (globalThis as any).sp;
    if (!sp) return null;
    return sp;
  }

  function warnMissingLoader(): void {
    try {
      console.warn(
        '[Stagepass] Core loader should be loaded before the inject module.'
      );
    } catch (_) {}
  }

  // Get Stagepass vars (must be available from core loader)
  function getVars() {
    const sp = getStagepassObject();
    if (!sp || !sp.vars) {
      throw new Error('Stagepass core loader must be loaded before modules');
    }
    return sp.vars;
  }

  /** Attribute names that must not be overridden via `attributes` (allowlist / SRI safety). */
  const RESERVED_ATTRS = new Set([
    'src',
    'href',
    'rel',
    'integrity',
    'crossorigin',
    'nonce',
  ]);

  // Logging helper
  function log(message: string) {
    try {
      const vars = getVars();
      if (vars.env === 'local' || vars.env === 'staging') {
        console.log(`[Stagepass] ${message}`);
      }
    } catch (_) {}
  }

  function warn(message: string) {
    try {
      const sp = getStagepassObject();
      if (sp && typeof sp.warn === 'function') {
        sp.warn(message);
        return;
      }
    } catch (_) {}
    try {
      console.warn(`[Stagepass] ${message}`);
    } catch (_) {}
  }

  // Extract filename from URL
  function extractFilename(url: string | undefined): string {
    if (!url || typeof url !== 'string') return 'file';
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname || '';
      if (!pathname || pathname.length === 0) {
        const match = url.match(/\/([^\/\?#]+)(?:\?|#|$)/);
        return match ? match[1] : 'file';
      }
      const pathParts = pathname.split('/');
      return pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2] || 'file';
    } catch (e) {
      try {
        const match = url.match(/\/([^\/\?#]+)(?:\?|#|$)/);
        return match ? match[1] : 'file';
      } catch (e2) {
        return 'file';
      }
    }
  }

  function detectType(src: string | undefined, explicitType?: 'script' | 'style'): 'script' | 'style' {
    if (explicitType) return explicitType;
    if (!src || typeof src !== 'string') return 'script';
    try {
      const ext = src.split('.').pop()?.toLowerCase();
      if (ext === 'css') return 'style';
    } catch (e) {}
    return 'script';
  }

  function appendQueryParam(url: string, key: string, value: string): string {
    const encoded = encodeURIComponent(value);
    const hashIdx = url.indexOf('#');
    const hash = hashIdx >= 0 ? url.slice(hashIdx) : '';
    const base = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}${encodeURIComponent(key)}=${encoded}${hash}`;
  }

  function hostAllowed(src: string, allowedHosts?: string[]): boolean {
    if (!allowedHosts || allowedHosts.length === 0) return true;
    try {
      const host = new URL(src, window.location.href).hostname.toLowerCase();
      const list = allowedHosts.map((h) => String(h).toLowerCase());
      return list.includes(host);
    } catch (_) {
      return false;
    }
  }

  function resolveSource(options: InjectOptions): string {
    const vars = getVars();
    const { src, stagepass, localPath, path, version } = options;

    if (!src || typeof src !== 'string') {
      throw new Error('Invalid src: must be a non-empty string');
    }

    if (stagepass !== false && vars.isLocal) {
      const filename = localPath || path || extractFilename(src);
      if (!filename || typeof filename !== 'string') return src;
      const cleanPath = filename.startsWith('/') ? filename.substring(1) : filename;
      const sp = getStagepassObject();
      if (sp && typeof sp.resolveLocalUrl === 'function') {
        const localUrl = sp.resolveLocalUrl(cleanPath);
        if (localUrl) return localUrl;
      }
    }

    if (version) {
      return appendQueryParam(src, 'v', version);
    }
    return src;
  }

  function isAlreadyInjected(options: InjectOptions, resolvedSrc: string): boolean {
    const { id, type } = options;
    const detectedType = detectType(options.src, type);

    if (id) {
      const existing = document.getElementById(id);
      if (existing) {
        log(`Skipping injection: Element with id "${id}" already exists`);
        return true;
      }
    }

    // Compare via DOM properties (avoid CSS selector injection from src)
    if (detectedType === 'script') {
      const scripts = document.getElementsByTagName('script');
      for (let i = 0; i < scripts.length; i++) {
        if (scripts[i].getAttribute('src') === resolvedSrc) {
          log(`Skipping injection: Resource "${resolvedSrc}" already loaded`);
          return true;
        }
      }
    } else {
      const links = document.getElementsByTagName('link');
      for (let i = 0; i < links.length; i++) {
        if (links[i].getAttribute('href') === resolvedSrc) {
          log(`Skipping injection: Resource "${resolvedSrc}" already loaded`);
          return true;
        }
      }
    }

    return false;
  }

  function getInsertionPoint(position: InjectPosition = 'body-end'): Node | null {
    if (typeof position === 'string') {
      switch (position) {
        case 'head':
          return document.head;
        default:
          return document.body;
      }
    }

    const { target, action } = position;
    const targetEl = document.querySelector(target);

    if (!targetEl) {
      log(`Warning: Target selector "${target}" not found, falling back to body-end`);
      return document.body;
    }

    return action === 'before' ? targetEl : targetEl.nextSibling || targetEl.parentNode;
  }

  function applyPassThrough(
    element: HTMLScriptElement | HTMLLinkElement,
    options: InjectOptions
  ) {
    if (options.integrity) {
      element.setAttribute('integrity', options.integrity);
    }
    if (options.crossorigin) {
      element.setAttribute('crossorigin', options.crossorigin);
    }
    if (options.nonce) {
      element.setAttribute('nonce', options.nonce);
    }
  }

  function injectSingle(options: InjectOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!options.src) {
        const vars = getVars();
        const error = new Error('InjectOptions must have a "src" property');
        if (vars.env !== 'production') {
          console.error('[Stagepass]', error);
        }
        reject(error);
        return;
      }

      if (!hostAllowed(options.src, options.allowedHosts)) {
        warn(
          `inject: host not allowed for "${options.src}". Check allowedHosts.`
        );
        resolve();
        return;
      }

      const vars = getVars();
      const detectedType = detectType(options.src, options.type);
      const resolvedSrc = resolveSource(options);

      if (isAlreadyInjected(options, resolvedSrc)) {
        resolve();
        return;
      }

      const element =
        detectedType === 'script'
          ? document.createElement('script')
          : document.createElement('link');

      if (detectedType === 'script') {
        const script = element as HTMLScriptElement;

        if (options.async) {
          script.async = true;
        } else {
          script.async = false;
          if (options.defer !== false) {
            script.defer = true;
          }
        }

        if (options.id) {
          script.id = options.id;
        }

        if (options.attributes) {
          Object.entries(options.attributes).forEach(([key, value]) => {
            if (RESERVED_ATTRS.has(String(key).toLowerCase())) return;
            script.setAttribute(key, value);
          });
        }

        // Controlled props win over attributes (allowlist / SRI)
        script.src = resolvedSrc;
        applyPassThrough(script, options);

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

        if (options.id) {
          link.id = options.id;
        }

        if (options.attributes) {
          Object.entries(options.attributes).forEach(([key, value]) => {
            if (RESERVED_ATTRS.has(String(key).toLowerCase())) return;
            link.setAttribute(key, value);
          });
        }

        link.rel = 'stylesheet';
        link.href = resolvedSrc;
        applyPassThrough(link, options);

        const checkLoad = setInterval(() => {
          const sheet = link.sheet || (link as any).styleSheet;
          if (sheet) {
            clearInterval(checkLoad);
            log(`Injected: ${resolvedSrc}`);
            resolve();
          }
        }, 10);

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

      const insertionPoint = getInsertionPoint(options.position);
      if (!insertionPoint) {
        reject(new Error('Could not find insertion point'));
        return;
      }

      if (insertionPoint === document.head || insertionPoint === document.body) {
        if (options.position === 'body-start') insertionPoint.prepend(element);
        else insertionPoint.appendChild(element);
      } else {
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

  /**
   * Inject one or more scripts/styles into the document.
   */
  async function inject(
    options: InjectOptions | InjectOptions[] | InjectBatchOptions
  ): Promise<void> {
    let items: InjectOptions[] = [];

    if (
      !Array.isArray(options) &&
      typeof options === 'object' &&
      ('scripts' in options || 'styles' in options)
    ) {
      const batch = options as InjectBatchOptions;
      if (batch.scripts) {
        items.push(
          ...batch.scripts
            .filter((item): item is InjectOptions => {
              return (
                item &&
                typeof item === 'object' &&
                'src' in item &&
                typeof item.src === 'string' &&
                item.src.trim().length > 0
              );
            })
            .map((item) => ({ ...item, type: 'script' as const }))
        );
      }
      if (batch.styles) {
        items.push(
          ...batch.styles
            .filter((item): item is InjectOptions => {
              return (
                item &&
                typeof item === 'object' &&
                'src' in item &&
                typeof item.src === 'string' &&
                item.src.trim().length > 0
              );
            })
            .map((item) => ({ ...item, type: 'style' as const }))
        );
      }
    } else {
      if (Array.isArray(options)) {
        items = options.filter(
          (item): item is InjectOptions =>
            item &&
            typeof item === 'object' &&
            'src' in item &&
            typeof item.src === 'string' &&
            item.src.trim().length > 0
        );
      } else if (
        options &&
        typeof options === 'object' &&
        'src' in options &&
        typeof (options as any).src === 'string' &&
        (options as any).src.trim().length > 0
      ) {
        items = [options as InjectOptions];
      }
    }

    for (const item of items) {
      try {
        await injectSingle(item);
      } catch (error) {
        try {
          const vars = getVars();
          if (vars.env !== 'production') {
            console.error('[Stagepass] Injection error:', error);
          }
        } catch (_) {}
      }
    }
  }

  function register(api: any) {
    api.inject = inject;
  }

  // 2.0.0 behaviour: always attach inject (even without loader vars)
  const sp = getStagepassObject() || {};
  if (!sp.vars) {
    warnMissingLoader();
  }

  const MODULE_VERSION = '2.0.0';
  if (sp.vars && typeof sp.use === 'function') {
    sp.use('inject', MODULE_VERSION, register);
  } else {
    register(sp);
  }

  (window as any).stagepass = sp;
  (globalThis as any).stagepass = sp;
  (window as any).sp = sp;
  (globalThis as any).sp = sp;
})();
