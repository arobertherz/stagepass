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

type BrowserFamily = StagepassClientInfo['browser']['family'];
type OsFamily = StagepassClientInfo['os']['family'];

// Order matters: Edge/Opera UAs also contain "Chrome", Chrome UAs contain "Safari".
const BROWSERS: [BrowserFamily, RegExp][] = [
  ['edge', /Edg\/(\d+)/],
  ['opera', /OPR\/(\d+)/],
  ['firefox', /Firefox\/(\d+)/],
  ['chrome', /Chrome\/(\d+)/],
  ['safari', /Version\/(\d+).+Safari\//],
];

const OSES: [OsFamily, RegExp][] = [
  ['android', /Android/i],
  ['ios', /iPhone|iPad|iPod/i],
  ['macos', /Mac OS X|Macintosh/i],
  ['windows', /Windows NT/i],
  ['linux', /Linux/i],
];

function getBrowserInfo(ua: string): StagepassClientInfo['browser'] {
  for (const [family, re] of BROWSERS) {
    const m = ua.match(re);
    if (m) return { family, major: Number(m[1]), userAgent: ua };
  }
  return { family: 'unknown', major: null, userAgent: ua };
}

function getOsInfo(ua: string): StagepassClientInfo['os'] {
  const hit = OSES.find(([, re]) => re.test(ua));
  return { family: hit ? hit[0] : 'unknown' };
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
  let v: 'light' | 'dark' | null = null;
  try {
    const mq = (scheme: string) => matchMedia(`(prefers-color-scheme: ${scheme})`).matches;
    v = mq('dark') ? 'dark' : mq('light') ? 'light' : null;
  } catch (_) {}
  return { preferred: v || 'no-preference', current: v || 'unknown' };
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
