/**
 * Types for the Stagepass `cookies` module (`@stagepass/modules/dist/cookies.min.js`).
 *
 * Enable per project in tsconfig/jsconfig: `"types": ["@stagepass/loader", "@stagepass/modules/cookies"]`.
 * Only list modules whose script tag is actually on the Webflow site.
 */
import '@stagepass/loader';

export interface StagepassCookieWriteOptions {
  days?: number;
  maxAge?: number;
  path?: string;
  domain?: string;
  secure?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
  encode?: boolean;
  json?: boolean;
  /** Optional category for consent gating / throwAll filtering. */
  category?: string;
}

/** Payload for `sp.cookies.on('bake' | 'throw', fn)`. */
export interface StagepassCookieEventPayload {
  name: string;
  category?: string;
}

export type StagepassCookieEventName = 'bake' | 'throw';

export interface StagepassCookiesAPI {
  /** Write a cookie. */
  bake: (name: string, value: unknown, options?: StagepassCookieWriteOptions) => void;
  /** Read a cookie. */
  eat: (name: string, options?: Record<string, unknown>) => unknown;
  /** Delete a cookie. */
  throw: (name: string, options?: Record<string, unknown>) => void;
  /** Whether a cookie exists. */
  has: (name: string) => boolean;
  /** List cookies as a name → value map. */
  list: (options?: Record<string, unknown>) => Record<string, unknown>;
  /** Delete known cookies, optionally by category. */
  throwAll: (options?: { category?: string }) => void;
  /** Shallow copy of cookies known to this helper. */
  jar: () => Record<string, unknown>;
  /** Known cookie names starting with `prefix`. */
  crumbs: (prefix: string) => string[];
  /**
   * Subscribe to successful bake/throw (including queued bakes flushed by consent, and each cookie in throwAll).
   * Returns an unsubscribe function. Listener errors do not break the cookie operation.
   */
  on: (
    event: StagepassCookieEventName,
    fn: (payload: StagepassCookieEventPayload) => void
  ) => () => void;
}

/**
 * Tiny consent hook used by categorized `bake`.
 * Tooling helper only: not a legal compliance solution.
 */
export interface StagepassConsentAPI {
  allows: (category: string) => boolean;
  set: (fn: (category: string) => boolean) => void;
  /** Flush queued cookies against the current consent function. */
  update: () => void;
}

declare module '@stagepass/loader' {
  interface StagepassAPI {
    /**
     * Cookie helpers (`cookies` module).
     * @example
     * if (sp.cookies) sp.cookies.bake('visited', '1', { days: 30 });
     */
    cookies?: StagepassCookiesAPI;
    /** Singular alias of `cookies` (`cookies` module). */
    cookie?: StagepassCookiesAPI;
    /**
     * Consent hook for categorized cookies (`cookies` module).
     * Documented as a tool, not legal compliance.
     * @example
     * if (sp.consent) { sp.consent.set((c) => c === 'necessary'); sp.consent.update(); }
     */
    consent?: StagepassConsentAPI;
  }
}
