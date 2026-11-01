export type StagepassClientTheme = {
  preferred: 'light' | 'dark' | 'no-preference';
  current: 'light' | 'dark' | 'unknown';
};

export type StagepassClientInfo = {
  theme: StagepassClientTheme;
  browser: {
    family: 'chrome' | 'safari' | 'firefox' | 'edge' | 'opera' | 'unknown';
    major: number | null;
    userAgent: string;
  };
  os: {
    family: 'macos' | 'windows' | 'ios' | 'android' | 'linux' | 'unknown';
  };
  device: {
    type: 'mobile' | 'tablet' | 'desktop' | 'unknown';
    touch: boolean;
  };
  viewport: {
    width: number;
    height: number;
    dpr: number;
  };
  locale: {
    language: string;
    timezone: string | null;
  };
  capabilities: {
    cookiesEnabled: boolean;
    localStorage: boolean;
    sessionStorage: boolean;
  };
};

function getBrowserInfo(ua: string): StagepassClientInfo['browser'] {
  let family: StagepassClientInfo['browser']['family'] = 'unknown';
  let major: number | null = null;
  let m: RegExpMatchArray | null = null;

  if (/Edg\/(\d+)/.test(ua)) {
    family = 'edge';
    m = ua.match(/Edg\/(\d+)/);
  } else if (/OPR\/(\d+)/.test(ua)) {
    family = 'opera';
    m = ua.match(/OPR\/(\d+)/);
  } else if (/Firefox\/(\d+)/.test(ua)) {
    family = 'firefox';
    m = ua.match(/Firefox\/(\d+)/);
  } else if (/Chrome\/(\d+)/.test(ua)) {
    family = 'chrome';
    m = ua.match(/Chrome\/(\d+)/);
  } else if (/Version\/(\d+).+Safari\//.test(ua)) {
    family = 'safari';
    m = ua.match(/Version\/(\d+)/);
  }

  if (m && m[1]) major = Number(m[1]);
  return { family, major: Number.isFinite(major) ? major : null, userAgent: ua };
}

function getOsInfo(ua: string): StagepassClientInfo['os'] {
  if (/Android/i.test(ua)) return { family: 'android' };
  if (/iPhone|iPad|iPod/i.test(ua)) return { family: 'ios' };
  if (/Mac OS X|Macintosh/i.test(ua)) return { family: 'macos' };
  if (/Windows NT/i.test(ua)) return { family: 'windows' };
  if (/Linux/i.test(ua)) return { family: 'linux' };
  return { family: 'unknown' };
}

function getDeviceInfo(ua: string): StagepassClientInfo['device'] {
  const touch = 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
  let type: StagepassClientInfo['device']['type'] = 'desktop';
  if (/iPad|Tablet/i.test(ua)) type = 'tablet';
  else if (/Mobi|Android.+Mobile|iPhone/i.test(ua)) type = 'mobile';
  else if (/Android/i.test(ua) && touch) type = 'tablet';
  return { type, touch };
}

/**
 * Read prefers-color-scheme.
 */
export function getThemeInfo(): StagepassClientTheme {
  let preferred: StagepassClientTheme['preferred'] = 'no-preference';
  let current: StagepassClientTheme['current'] = 'unknown';
  try {
    if (window.matchMedia) {
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        preferred = 'dark';
        current = 'dark';
      } else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
        preferred = 'light';
        current = 'light';
      }
    }
  } catch (_) {}
  return { preferred, current };
}

/**
 * Probe storage availability.
 *
 * @param type - Storage kind
 */
export function hasStorage(type: 'localStorage' | 'sessionStorage'): boolean {
  try {
    const storage = window[type];
    const key = '__stagepass_test__';
    storage.setItem(key, '1');
    storage.removeItem(key);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Whether the Service Worker API is present.
 */
export function hasServiceWorker(): boolean {
  try {
    return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  } catch (_) {
    return false;
  }
}

/**
 * Best-effort client/runtime snapshot.
 */
export function getClientInfo(): StagepassClientInfo {
  const ua = navigator.userAgent || '';
  let timezone: string | null = null;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch (_) {}
  return {
    theme: getThemeInfo(),
    browser: getBrowserInfo(ua),
    os: getOsInfo(ua),
    device: getDeviceInfo(ua),
    viewport: {
      width: window.innerWidth || 0,
      height: window.innerHeight || 0,
      dpr: window.devicePixelRatio || 1,
    },
    locale: {
      language: navigator.language || 'unknown',
      timezone,
    },
    capabilities: {
      cookiesEnabled: navigator.cookieEnabled === true,
      localStorage: hasStorage('localStorage'),
      sessionStorage: hasStorage('sessionStorage'),
    },
  };
}

/**
 * Map `can(capability)` names to client capability flags.
 *
 * @param client - Client info
 * @param capability - Capability name
 */
export function canCapability(
  client: StagepassClientInfo,
  capability: string
): boolean {
  const caps = client.capabilities;
  switch (capability) {
    case 'localStorage':
      return caps.localStorage === true;
    case 'sessionStorage':
      return caps.sessionStorage === true;
    case 'cookies':
      return caps.cookiesEnabled === true;
    case 'serviceWorker':
      return hasServiceWorker();
    default:
      return false;
  }
}
