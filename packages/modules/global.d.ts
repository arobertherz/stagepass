/**
 * Options for `stagepass.inject` / `sp.inject`.
 */
export interface StagepassInjectOptions {
  src: string;
  type?: 'script' | 'style';
  stagepass?: boolean;
  localPath?: string;
  path?: string;
  id?: string;
  async?: boolean;
  defer?: boolean;
  /** @deprecated No longer appends per-view timestamps in production. Use `version`. */
  cacheBust?: boolean;
  /** Production version token appended as `?v=`. */
  version?: string;
  attributes?: Record<string, string>;
  position?:
    | 'head'
    | 'body-start'
    | 'body-end'
    | { target: string; action: 'before' | 'after' };
  /** Subresource Integrity hash. */
  integrity?: string;
  /** CORS mode (`anonymous` / `use-credentials`). */
  crossorigin?: string;
  /** CSP nonce. */
  nonce?: string;
  /** Reject src hosts outside this list (warn + skip). */
  allowedHosts?: string[];
}

export interface StagepassInjectBatchOptions {
  scripts?: StagepassInjectOptions[];
  styles?: StagepassInjectOptions[];
}

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

export interface StagepassMaintenanceAPI {
  enable: (opts?: { title?: string; text?: string }) => void;
  disable: () => void;
  isActive: () => boolean;
}

export type StagepassInjectAPI = (
  options:
    | StagepassInjectOptions
    | StagepassInjectOptions[]
    | StagepassInjectBatchOptions
) => Promise<void>;

/** Declaration merging: extend loader StagepassAPI with modules. */
declare module '@stagepass/loader' {
  interface StagepassAPI {
    /** Programmatic asset injector (from `@stagepass/modules`). */
    inject?: StagepassInjectAPI;
    /** Cookie helpers (from `@stagepass/modules`). */
    cookies?: StagepassCookiesAPI;
    /** Singular alias of `cookies`. */
    cookie?: StagepassCookiesAPI;
    /**
     * Consent hook for categorized cookies.
     * Documented as a tool, not legal compliance.
     */
    consent?: StagepassConsentAPI;
    /** Client-side maintenance overlay (not access protection). */
    maintenance?: StagepassMaintenanceAPI;
  }
}

export {};
