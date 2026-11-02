/**
 * Runtime client theme preference.
 */
export interface StagepassClientTheme {
  preferred: 'light' | 'dark' | 'no-preference';
  current: 'light' | 'dark' | 'unknown';
}

/**
 * Best-effort browser / device info exposed on `stagepass.vars.client`.
 */
export interface StagepassClientInfo {
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
}

/**
 * Read-only runtime variables set by the Stagepass loader.
 */
export interface StagepassVars {
  /** True when a local session is active or the page is on localhost. */
  isLocal: boolean;
  env: 'local' | 'staging' | 'production';
  /** Active .sp domain, or the page hostname when no session. */
  domain: string;
  /** Session start timestamp (ms) when swapping; otherwise 0. */
  timestamp: number;
  /** Package version injected at build time. */
  version: string;
  /** Client runtime info (theme listeners and viewport updates from boot). */
  client: StagepassClientInfo;
}

export type StagepassEnvName = 'local' | 'staging' | 'production';

export type StagepassCapabilityName =
  | 'localStorage'
  | 'sessionStorage'
  | 'cookies'
  | 'serviceWorker'
  | (string & {});

export type StagepassEventName = 'theme' | 'session' | (string & {});

/** Payload of `sp.on('session', fn)` (emitted once at boot). */
export interface StagepassSessionEvent {
  /** True while a Stagepass session (or debug mode) is active. */
  active: boolean;
  /** Raw session value (`.sp` domain or `debug`), or null. */
  domain: string | null;
  /** True when assets are swapped to a local `.sp` domain. */
  swap: boolean;
  /** True in debug mode (`?stagepass=debug`). */
  debug: boolean;
}

/** Subscribe helper with typed payloads for known events. */
export interface StagepassOn {
  /**
   * Color scheme changes. Payload equals `vars.client.theme`.
   * @example
   * const off = sp.on('theme', ({ current }) => { document.documentElement.dataset.theme = current; });
   */
  (event: 'theme', fn: (payload: StagepassClientTheme) => void): () => void;
  /**
   * Session state, emitted once at boot after globals are set.
   * @example
   * sp.on('session', ({ active, swap }) => { if (active && swap) sp.log('local assets'); });
   */
  (event: 'session', fn: (payload: StagepassSessionEvent) => void): () => void;
  /** Unknown events are accepted and never fire. */
  (event: StagepassEventName, fn: (payload: unknown) => void): () => void;
}

export type StagepassModuleFactory = (api: StagepassAPI) => void;

/**
 * Core Stagepass runtime API (loader). Modules extend this via declaration merging.
 */
export interface StagepassAPI {
  /**
   * Frozen runtime variables.
   * @example
   * if (sp.vars.isLocal) sp.log('local session on', sp.vars.domain);
   */
  vars: StagepassVars;
  /**
   * Structured log (only when a session is active). A first argument of
   * `'warn'` or `'error'` selects the level.
   * @example
   * sp.log('menu ready');
   */
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  /**
   * Build a local HTTPS asset URL when a session is active.
   * @param relativePath - Path under the linked project root
   * @returns Local URL, or empty string when no session
   */
  resolveLocalUrl: (relativePath: string) => string;

  /**
   * Flat env helper. `local` means an active swap session to a `.sp` domain.
   * Staging: hostname ends with `.webflow.io` or matches `data-stagepass-staging-hosts`.
   */
  env: () => StagepassEnvName;
  /**
   * `true` when `env()` equals `name`.
   * @example
   * if (sp.is('production')) initAnalytics();
   */
  is: (name: StagepassEnvName | string) => boolean;
  /**
   * Capability probe. Known: `localStorage`, `sessionStorage`, `cookies`, `serviceWorker`.
   * Any other name returns `false`.
   * @example
   * if (sp.can('localStorage')) localStorage.setItem('seen', '1');
   */
  can: (capability: StagepassCapabilityName) => boolean;
  /** Read a key from `vars.client`, or the whole client object when omitted. */
  client: (key?: keyof StagepassClientInfo | string) => unknown;
  /**
   * Subscribe to runtime events. Returns an unsubscribe function.
   * Supported: `theme` (prefers-color-scheme), `session` (boot).
   */
  on: StagepassOn;
  /**
   * Register a module after a major-version check against the loader.
   * @returns whether registration succeeded
   */
  use: (name: string, version: string, factory: StagepassModuleFactory) => boolean;
}

declare global {
  interface Window {
    stagepass: StagepassAPI;
    sp: StagepassAPI;
    /** Optional folder for flag.min.js / flag-card.min.js when the loader is inlined or bundled (2.3.1+). http(s) or relative only. */
    stagepassFlagBase?: string;
  }

  // Global aliases (same object as window.stagepass)
  // eslint-disable-next-line no-var
  var stagepass: StagepassAPI;
  // eslint-disable-next-line no-var
  var sp: StagepassAPI;
}

export {};
