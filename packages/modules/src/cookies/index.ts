(function () {
  type SameSite = 'Lax' | 'Strict' | 'None';

  interface CookieWriteOptions {
    days?: number;
    maxAge?: number;
    path?: string;
    domain?: string;
    secure?: boolean;
    sameSite?: SameSite;
    encode?: boolean;
    json?: boolean;
    category?: string;
  }

  interface CookieReadOptions {
    decode?: boolean;
    json?: boolean;
  }

  interface CookieDeleteOptions {
    path?: string;
    domain?: string;
    secure?: boolean;
    sameSite?: SameSite;
  }

  type KnownCookie = {
    name: string;
    value: unknown;
    options: CookieWriteOptions;
    category?: string;
  };

  type ConsentFn = (category: string) => boolean;

  function getStagepassObject(): any | null {
    const sp =
      (window as any).stagepass ||
      (globalThis as any).stagepass ||
      (window as any).sp ||
      (globalThis as any).sp;
    if (!sp || !sp.vars) {
      try {
        console.warn(
          '[Stagepass] Core loader must be loaded before the cookies module. Skipping registration.'
        );
      } catch (_) {}
      return null;
    }
    return sp;
  }

  function isHttps(): boolean {
    return window.location.protocol === 'https:';
  }

  function safeDecode(value: string): string {
    try {
      return decodeURIComponent(value);
    } catch (_) {
      return value;
    }
  }

  function parseValue(raw: string, options: CookieReadOptions): any {
    const decode = options.decode !== false;
    const value = decode ? safeDecode(raw) : raw;
    if (!options.json) return value;
    try {
      return JSON.parse(value);
    } catch (_) {
      return value;
    }
  }

  function register(sp: any) {
    const known = new Map<string, KnownCookie>();
    const queue: KnownCookie[] = [];
    let consentFn: ConsentFn = () => true;

    function writeCookie(name: string, value: any, options: CookieWriteOptions = {}): void {
      if (!name || typeof name !== 'string' || name.includes(';')) {
        throw new Error('Invalid cookie name');
      }

      const encode = options.encode !== false;
      const sameSite: SameSite = options.sameSite || 'Lax';
      const secure = options.secure !== undefined ? options.secure : isHttps();
      const path = options.path || '/';

      let rawValue = options.json ? JSON.stringify(value) : String(value);
      const cookieName = encode ? encodeURIComponent(name) : name;
      rawValue = encode ? encodeURIComponent(rawValue) : rawValue;

      const parts = [`${cookieName}=${rawValue}`];
      if (typeof options.maxAge === 'number') parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
      if (typeof options.days === 'number') {
        const expires = new Date(Date.now() + options.days * 24 * 60 * 60 * 1e3);
        parts.push(`Expires=${expires.toUTCString()}`);
      }
      if (path) parts.push(`Path=${path}`);
      if (options.domain) parts.push(`Domain=${options.domain}`);
      parts.push(`SameSite=${sameSite}`);

      let mustSecure = secure;
      if (sameSite === 'None' && !mustSecure) {
        mustSecure = true;
        if (typeof sp.warn === 'function') {
          sp.warn('SameSite=None requires Secure=true. Enforcing Secure for cookie write.');
        }
      }
      if (mustSecure) parts.push('Secure');

      document.cookie = parts.join('; ');
    }

    /**
     * Write a cookie (`document.cookie`).
     * When `category` is set and consent rejects it, the write is queued.
     */
    function bake(name: string, value: any, options: CookieWriteOptions = {}): void {
      const category = options.category;
      const entry: KnownCookie = { name, value, options: { ...options }, category };

      if (category && !consentFn(category)) {
        // Replace any existing queued entry for the same name
        const idx = queue.findIndex((q) => q.name === name);
        if (idx >= 0) queue.splice(idx, 1);
        queue.push(entry);
        known.set(name, entry);
        return;
      }

      writeCookie(name, value, options);
      known.set(name, entry);
      // Drop from queue if previously pending
      const qIdx = queue.findIndex((q) => q.name === name);
      if (qIdx >= 0) queue.splice(qIdx, 1);
    }

    /**
     * Read a cookie by name.
     */
    function eat(name: string, options: CookieReadOptions = {}): any | null {
      if (!name || typeof name !== 'string') return null;
      const target = options.decode === false ? name : safeDecode(name);
      const cookies = document.cookie ? document.cookie.split('; ') : [];

      for (const row of cookies) {
        const idx = row.indexOf('=');
        if (idx < 0) continue;
        const key = row.substring(0, idx);
        const raw = row.substring(idx + 1);
        const decodedKey = safeDecode(key);
        if (key === target || decodedKey === target) {
          return parseValue(raw, options);
        }
      }
      return null;
    }

    function has(name: string): boolean {
      return eat(name) !== null;
    }

    function list(options: CookieReadOptions = {}): Record<string, any> {
      const cookies = document.cookie ? document.cookie.split('; ') : [];
      const out: Record<string, any> = {};
      for (const row of cookies) {
        const idx = row.indexOf('=');
        if (idx < 0) continue;
        const key = row.substring(0, idx);
        const raw = row.substring(idx + 1);
        const finalKey = options.decode === false ? key : safeDecode(key);
        out[finalKey] = parseValue(raw, options);
      }
      return out;
    }

    function throwCookie(name: string, options: CookieDeleteOptions = {}): void {
      writeCookie(name, '', {
        days: -1,
        maxAge: 0,
        path: options.path || '/',
        domain: options.domain,
        secure: options.secure,
        sameSite: options.sameSite,
      });
      known.delete(name);
      const qIdx = queue.findIndex((q) => q.name === name);
      if (qIdx >= 0) queue.splice(qIdx, 1);
    }

    /**
     * Delete all known cookies, optionally filtered by category.
     */
    function throwAll(options: { category?: string } = {}): void {
      const category = options.category;
      const names: string[] = [];
      known.forEach((entry, name) => {
        if (!category || entry.category === category) names.push(name);
      });
      for (const name of names) {
        const entry = known.get(name);
        throwCookie(name, {
          path: entry?.options.path,
          domain: entry?.options.domain,
          secure: entry?.options.secure,
          sameSite: entry?.options.sameSite,
        });
      }
    }

    /**
     * Shallow copy of cookies known to this helper (includes queued).
     */
    function jar(): Record<string, unknown> {
      const out: Record<string, unknown> = {};
      known.forEach((entry, name) => {
        out[name] = entry.value;
      });
      return out;
    }

    /**
     * Known cookie names that start with `prefix`.
     */
    function crumbs(prefix: string): string[] {
      const p = prefix == null ? '' : String(prefix);
      const names: string[] = [];
      known.forEach((_entry, name) => {
        if (name.startsWith(p)) names.push(name);
      });
      return names;
    }

    const cookiesApi = {
      bake,
      eat,
      throw: throwCookie,
      has,
      list,
      throwAll,
      jar,
      crumbs,
    };

    const consentApi = {
      allows(category: string): boolean {
        try {
          return consentFn(category) === true;
        } catch (_) {
          return false;
        }
      },
      set(fn: ConsentFn): void {
        if (typeof fn === 'function') consentFn = fn;
      },
      /**
       * Re-check queued cookies against the current consent function and flush allowed ones.
       */
      update(): void {
        const pending = queue.splice(0, queue.length);
        for (const entry of pending) {
          if (!entry.category || consentFn(entry.category)) {
            bake(entry.name, entry.value, entry.options);
          } else {
            queue.push(entry);
          }
        }
      },
    };

    sp.cookies = cookiesApi;
    sp.cookie = cookiesApi; // singular alias
    sp.consent = consentApi;
  }

  const sp = getStagepassObject();
  if (!sp) return;

  const MODULE_VERSION = '2.0.0';
  if (typeof sp.use === 'function') {
    sp.use('cookies', MODULE_VERSION, register);
  } else {
    register(sp);
  }

  (globalThis as any).stagepass = sp;
  (window as any).sp = sp;
  (globalThis as any).sp = sp;
})();
