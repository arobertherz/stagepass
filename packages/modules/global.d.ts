/**
 * Types for all Stagepass modules (`@stagepass/modules`, `dist/all.min.js`).
 *
 * Backward compatible entry: re-exports every module type and augments
 * `StagepassAPI` with `inject`, `cookies`, `cookie`, `consent`, `maintenance`.
 * For projects that load only some modules, use the per-module entries
 * instead: `@stagepass/modules/inject`, `@stagepass/modules/cookies`,
 * `@stagepass/modules/maintenance`.
 */
export * from './inject';
export * from './cookies';
export * from './maintenance';
