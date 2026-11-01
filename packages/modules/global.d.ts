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
}

export interface StagepassInjectBatchOptions {
  scripts?: StagepassInjectOptions[];
  styles?: StagepassInjectOptions[];
}

export interface StagepassCookiesAPI {
  /** Write a cookie. */
  bake: (name: string, value: unknown, options?: Record<string, unknown>) => void;
  /** Read a cookie. */
  eat: (name: string, options?: Record<string, unknown>) => unknown;
  /** Delete a cookie. */
  throw: (name: string, options?: Record<string, unknown>) => void;
  /** Whether a cookie exists. */
  has: (name: string) => boolean;
  /** List cookie names. */
  list: () => string[];
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
  }
}

export {};
