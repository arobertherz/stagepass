/**
 * Declared Stagepass modules for a project (`stagepass.json` → `modules`).
 *
 * Modules are separate script tags in Webflow Custom Code, so the npm
 * dependency alone does not prove which ones run on the site. The declared
 * list is the source of truth for AI guidance and TypeScript types.
 */

/** Individual module ids (each has `modules/dist/<id>.min.js`). */
export const MODULE_IDS = Object.freeze(['inject', 'cookies', 'maintenance']);

/** Accepted values in the declared list (`all` = every module). */
export const MODULE_CHOICES = Object.freeze([...MODULE_IDS, 'all']);

/**
 * Normalize a declared modules value.
 * Accepts an array, a comma/space separated string, `none`, or `all`.
 * Returns a sorted, deduped list; `all` is exclusive (`['all']`).
 *
 * @param {unknown} value
 * @returns {{ ok: true, modules: string[] } | { ok: false, error: string }}
 */
export function normalizeModulesList(value) {
  /** @type {unknown[]} */
  let items;
  if (Array.isArray(value)) {
    items = value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === '' || trimmed === 'none' || trimmed === '[]') {
      return { ok: true, modules: [] };
    }
    items = trimmed.split(/[\s,]+/).filter(Boolean);
  } else {
    return {
      ok: false,
      error: 'modules must be a list such as ["cookies"], ["all"] or [].',
    };
  }

  const out = new Set();
  for (const raw of items) {
    const id = String(raw).trim().toLowerCase();
    if (!MODULE_CHOICES.includes(id)) {
      return {
        ok: false,
        error: `Unknown module "${String(raw)}". Use ${MODULE_CHOICES.join(', ')} or none.`,
      };
    }
    out.add(id);
  }
  if (out.has('all')) return { ok: true, modules: ['all'] };
  return { ok: true, modules: MODULE_IDS.filter((id) => out.has(id)) };
}

/**
 * Expand `all` into the individual module ids.
 * @param {string[]} modules normalized list
 * @returns {string[]}
 */
export function expandModules(modules) {
  if (modules.includes('all')) return [...MODULE_IDS];
  return MODULE_IDS.filter((id) => modules.includes(id));
}

/** Whether a module type entry belongs to Stagepass modules. */
export function isStagepassModulesTypeEntry(entry) {
  return entry === '@stagepass/modules' || String(entry).startsWith('@stagepass/modules/');
}

/**
 * `compilerOptions.types` entries for a declared list.
 * @param {string[]} modules normalized list
 * Single modules use `@stagepass/modules/<id>` (modules >= 2.2.0). When the
 * installed or resolvable @stagepass/modules has no per-module types
 * (`perModuleTypes: false`, e.g. only 2.0.0 published), the umbrella
 * `@stagepass/modules` is used so the project still type-checks.
 *
 * @param {string[]} modules normalized list
 * @param {{ modulesDependency?: boolean, perModuleTypes?: boolean }} [opts] module types need the npm dep
 * @returns {string[]}
 */
export function typesForModules(modules, opts = {}) {
  const types = ['@stagepass/loader'];
  if (opts.modulesDependency === false) return types;
  if (modules.length > 0 && opts.perModuleTypes === false) {
    types.push('@stagepass/modules');
    return types;
  }
  if (modules.includes('all')) {
    types.push('@stagepass/modules');
  } else {
    for (const id of expandModules(modules)) types.push(`@stagepass/modules/${id}`);
  }
  return types;
}

/** Human-readable list (`none` when empty). */
export function formatModules(modules) {
  return modules.length === 0 ? 'none' : modules.join(', ');
}

/** Same list (order-insensitive). */
export function sameModules(a, b) {
  const x = [...a].sort().join(',');
  const y = [...b].sort().join(',');
  return x === y;
}
