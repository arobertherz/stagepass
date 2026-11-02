/**
 * Types for the Stagepass `inject` module (`@stagepass/modules/dist/inject.min.js`).
 *
 * Enable per project in tsconfig/jsconfig: `"types": ["@stagepass/loader", "@stagepass/modules/inject"]`.
 * Only list modules whose script tag is actually on the Webflow site.
 */
import '@stagepass/loader';

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

export type StagepassInjectAPI = (
  options:
    | StagepassInjectOptions
    | StagepassInjectOptions[]
    | StagepassInjectBatchOptions
) => Promise<void>;

declare module '@stagepass/loader' {
  interface StagepassAPI {
    /**
     * Programmatic asset injector (`inject` module).
     * @example
     * if (sp.inject) await sp.inject({ src: 'https://cdn.example.com/lib.js', defer: true });
     */
    inject?: StagepassInjectAPI;
  }
}
