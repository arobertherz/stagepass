/**
 * Types for all Stagepass modules (`@stagepass/modules`, `dist/all.min.js`).
 *
 * Backward compatible entry: re-exports every module type and augments
 * `StagepassAPI` with `inject`, `cookies`, `cookie`, `consent`, `maintenance`.
 * For projects that load only some modules, use the per-module entries
 * instead: `@stagepass/modules/inject`, `@stagepass/modules/cookies`,
 * `@stagepass/modules/maintenance`.
 */
export * from './inject.js';
export * from './cookies.js';
export * from './maintenance.js';
