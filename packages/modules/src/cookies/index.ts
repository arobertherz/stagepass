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

  function getStagepassObject() {
    const sp = (window as any).stagepass || (globalThis as any).stagepass || (window as any).sp || (globalThis as any).sp;
    if (!sp || !sp.vars) {
      throw new Error('Stagepass core loader must be loaded before modules');
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

  function bake(name: string, value: any, options: CookieWriteOptions = {}): void {
    const sp = getStagepassObject();
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
    bake(name, '', {
      days: -1,
      maxAge: 0,
      path: options.path || '/',
      domain: options.domain,
      secure: options.secure,
      sameSite: options.sameSite,
    });
  }

  const sp = (window as any).stagepass = (window as any).stagepass || {};
  sp.cookies = {
    bake,
    eat,
    throw: throwCookie,
    has,
    list,
  };

  (globalThis as any).stagepass = sp;
  (window as any).sp = sp;
  (globalThis as any).sp = sp;
})();
