import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canCapability,
  getClientInfo,
  getThemeInfo,
  hasServiceWorker,
  hasStorage,
  type StagepassClientInfo,
} from '../client.js';

/**
 * Exact client probes. `vitest related` only runs tests that import this module,
 * so each observable branch is asserted by value (mutation gate #155).
 */

type Caps = StagepassClientInfo['capabilities'];

function caps(partial: Partial<Caps> = {}): StagepassClientInfo {
  return {
    theme: { preferred: 'no-preference', current: 'unknown' },
    browser: { family: 'unknown', major: null, userAgent: '' },
    os: { family: 'unknown' },
    device: { type: 'desktop', touch: false },
    viewport: { width: 0, height: 0, dpr: 1 },
    locale: { language: 'en', timezone: null },
    capabilities: {
      cookiesEnabled: false,
      localStorage: false,
      sessionStorage: false,
      ...partial,
    },
  };
}

function setUA(ua: string) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
}

function setTouch(ontouch: boolean, points: number) {
  if (ontouch) (window as unknown as { ontouchstart?: boolean }).ontouchstart = true;
  else delete (window as unknown as { ontouchstart?: boolean }).ontouchstart;
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: points });
}

function setViewport(width: number, height: number, dpr: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: dpr });
}

function clearStorageCache() {
  const cache = hasStorage as unknown as { localStorage?: boolean; sessionStorage?: boolean };
  delete cache.localStorage;
  delete cache.sessionStorage;
}

describe('client probes', () => {
  beforeEach(() => {
    clearStorageCache();
  });

  afterEach(() => {
    delete (window as unknown as { ontouchstart?: boolean }).ontouchstart;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clearStorageCache();
  });

  describe('browser', () => {
    it.each([
      ['Mozilla/5.0 Chrome/121.0.0.0 Safari/537.36 Edg/120.0.1000', 'edge', 120],
      ['Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36 OPR/105.0.0.0', 'opera', 105],
      ['Mozilla/5.0 (X11; Linux x86_64; rv:115.0) Gecko/20100101 Firefox/115.0', 'firefox', 115],
      ['Mozilla/5.0 Chrome/121.0.0.0 Safari/537.36', 'chrome', 121],
      [
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.2 Safari/605.1.15',
        'safari',
        17,
      ],
    ] as const)('parses %s as %s %s', (ua, family, major) => {
      setUA(ua);
      expect(getClientInfo().browser).toEqual({ family, major, userAgent: ua });
    });

    it('reports an unknown browser and keeps the raw user agent', () => {
      setUA('StagepassTest/1.0');
      expect(getClientInfo().browser).toEqual({
        family: 'unknown',
        major: null,
        userAgent: 'StagepassTest/1.0',
      });
    });

    it('uses an empty user agent when navigator.userAgent is empty', () => {
      setUA('');
      const browser = getClientInfo().browser;
      expect(browser.userAgent).toBe('');
      expect(browser.family).toBe('unknown');
    });
  });

  describe('os', () => {
    it.each([
      ['Mozilla/5.0 (Linux; Android 13; Pixel) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36', 'android'],
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Version/17.0 Mobile Safari/604.1', 'ios'],
      ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit Version/17.0 Mobile/15E148 Safari/604.1', 'ios'],
      ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 'macos'],
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'windows'],
      ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36', 'linux'],
      ['StagepassTest/1.0', 'unknown'],
    ] as const)('maps %s to %s', (ua, family) => {
      setUA(ua);
      expect(getClientInfo().os).toEqual({ family });
    });
  });

  describe('device', () => {
    it('classifies phones, tablets and desktops', () => {
      setTouch(false, 0);
      setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
      expect(getClientInfo().device).toEqual({ type: 'mobile', touch: false });

      setUA('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Tablet');
      expect(getClientInfo().device).toEqual({ type: 'tablet', touch: false });

      setUA('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36');
      expect(getClientInfo().device).toEqual({ type: 'mobile', touch: false });

      setUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/121.0.0.0');
      expect(getClientInfo().device).toEqual({ type: 'desktop', touch: false });
    });

    it('treats a touch Android device without Mobile as a tablet, and a non-touch one as a desktop', () => {
      const ua = 'Mozilla/5.0 (Linux; Android 13; K) AppleWebKit/537.36';
      setUA(ua);
      setTouch(false, 0);
      expect(getClientInfo().device).toEqual({ type: 'desktop', touch: false });
      setTouch(true, 0);
      expect(getClientInfo().device).toEqual({ type: 'tablet', touch: true });
    });

    it('is touch when ontouchstart is set or maxTouchPoints is positive', () => {
      setUA('Mozilla/5.0 (Windows NT 10.0)');
      setTouch(true, 0);
      expect(getClientInfo().device.touch).toBe(true);
      setTouch(false, 2);
      expect(getClientInfo().device.touch).toBe(true);
      setTouch(false, 0);
      expect(getClientInfo().device.touch).toBe(false);
    });
  });

  describe('theme', () => {
    function match(preferred: 'dark' | 'light' | 'none') {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query.includes('dark')
          ? preferred === 'dark'
          : query.includes('light')
            ? preferred === 'light'
            : false,
        media: query,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
      }));
    }

    it('reports dark, light, and no preference', () => {
      match('dark');
      expect(getThemeInfo()).toEqual({ preferred: 'dark', current: 'dark' });
      match('light');
      expect(getThemeInfo()).toEqual({ preferred: 'light', current: 'light' });
      match('none');
      expect(getThemeInfo()).toEqual({ preferred: 'no-preference', current: 'unknown' });
    });

    it('falls back when matchMedia throws', () => {
      vi.stubGlobal('matchMedia', () => {
        throw new Error('no matchMedia');
      });
      expect(getThemeInfo()).toEqual({ preferred: 'no-preference', current: 'unknown' });
    });
  });

  describe('viewport, locale, cookies', () => {
    it('reads width, height and devicePixelRatio, and falls back when they are missing', () => {
      setViewport(800, 600, 2);
      expect(getClientInfo().viewport).toEqual({ width: 800, height: 600, dpr: 2 });
      setViewport(0, 0, 0);
      expect(getClientInfo().viewport).toEqual({ width: 0, height: 0, dpr: 1 });
    });

    it('reads the language and timezone, and falls back when they are empty', () => {
      vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
        timeZone: 'Europe/Berlin',
      } as Intl.ResolvedDateTimeFormatOptions);
      vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-DE');
      expect(getClientInfo().locale).toEqual({ language: 'de-DE', timezone: 'Europe/Berlin' });

      vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
        timeZone: '',
      } as Intl.ResolvedDateTimeFormatOptions);
      vi.spyOn(navigator, 'language', 'get').mockReturnValue('');
      expect(getClientInfo().locale).toEqual({ language: 'unknown', timezone: null });
    });

    it('leaves timezone null when Intl throws', () => {
      vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(() => {
        throw new Error('no intl');
      });
      expect(getClientInfo().locale.timezone).toBeNull();
    });

    it('treats cookieEnabled as strict true', () => {
      vi.spyOn(navigator, 'cookieEnabled', 'get').mockReturnValue(true);
      expect(getClientInfo().capabilities.cookiesEnabled).toBe(true);
      vi.spyOn(navigator, 'cookieEnabled', 'get').mockReturnValue(false);
      expect(getClientInfo().capabilities.cookiesEnabled).toBe(false);
    });
  });

  describe('hasStorage', () => {
    it('returns true and caches a successful probe', () => {
      expect(hasStorage('localStorage')).toBe(true);
      expect(hasStorage('localStorage')).toBe(true);
      expect(hasStorage('sessionStorage')).toBe(true);
      expect(getClientInfo().capabilities.localStorage).toBe(true);
      expect(getClientInfo().capabilities.sessionStorage).toBe(true);
    });

    it('returns false and caches when storage throws', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('denied');
      });
      expect(hasStorage('localStorage')).toBe(false);
      expect(hasStorage('localStorage')).toBe(false);
      expect(hasStorage('sessionStorage')).toBe(false);
      expect(getClientInfo().capabilities.localStorage).toBe(false);
      expect(getClientInfo().capabilities.sessionStorage).toBe(false);
    });
  });

  describe('hasServiceWorker', () => {
    it('is true only when the API is present on navigator', () => {
      vi.stubGlobal('navigator', { userAgent: 'x', language: 'en', maxTouchPoints: 0 });
      expect(hasServiceWorker()).toBe(false);
      vi.stubGlobal('navigator', { serviceWorker: {} });
      expect(hasServiceWorker()).toBe(true);
    });

    it('returns false when the presence check throws', () => {
      vi.stubGlobal(
        'navigator',
        new Proxy(
          {},
          {
            has() {
              throw new Error('blocked');
            },
          }
        )
      );
      expect(hasServiceWorker()).toBe(false);
    });
  });

  describe('canCapability', () => {
    it('maps each flag exactly and rejects unknown names', () => {
      expect(canCapability(caps({ localStorage: true }), 'localStorage')).toBe(true);
      expect(canCapability(caps({ localStorage: false }), 'localStorage')).toBe(false);
      expect(canCapability(caps({ sessionStorage: true }), 'sessionStorage')).toBe(true);
      expect(canCapability(caps({ sessionStorage: false }), 'sessionStorage')).toBe(false);
      expect(canCapability(caps({ cookiesEnabled: true }), 'cookies')).toBe(true);
      expect(canCapability(caps({ cookiesEnabled: false }), 'cookies')).toBe(false);
      expect(canCapability(caps({ localStorage: true }), 'nope')).toBe(false);
    });

    it('asks the service worker probe instead of a client flag', () => {
      vi.stubGlobal('navigator', { serviceWorker: {} });
      expect(canCapability(caps(), 'serviceWorker')).toBe(true);
      vi.stubGlobal('navigator', {});
      expect(canCapability(caps(), 'serviceWorker')).toBe(false);
    });
  });
});
