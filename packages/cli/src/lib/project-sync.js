/**
 * Sync generated project files with the declared Stagepass modules
 * (used by `stagepass upgrade` and `stagepass doctor`).
 *
 * Writes only:
 * - stagepass.json `modules` (and `origin` when passed via --site)
 * - AGENTS.md managed block (created when missing)
 * - .cursor/rules/stagepass.mdc (created when missing, managed block refreshed)
 * - tsconfig.json / jsconfig.json `compilerOptions.types` (plain JSON only)
 */

import path from 'node:path';
import fs from 'fs-extra';
import {
  BLOCK_BEGIN,
  CURSOR_RULE_PATH,
  buildCursorRule,
  buildManagedBlock,
  upsertManagedBlock,
} from './ai-guide.js';
import {
  formatModules,
  isStagepassModulesTypeEntry,
  normalizeModulesList,
  typesForModules,
} from './project-modules.js';
import { loadProjects } from './projects.js';
import { describeDetection, normalizeSiteUrl } from './site-detect.js';

/**
 * Read and parse stagepass.json (null when missing or invalid).
 * @param {string} cwd
 * @param {typeof fs} [fse]
 * @returns {Promise<{ exists: boolean, data: Record<string, unknown> | null, raw: string, error?: string }>}
 */
export async function readStagepassJson(cwd, fse = fs) {
  const file = path.join(cwd, 'stagepass.json');
  if (!(await fse.pathExists(file))) return { exists: false, data: null, raw: '' };
  const raw = await fse.readFile(file, 'utf8');
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { exists: true, data: null, raw, error: 'stagepass.json is not a JSON object.' };
    }
    return { exists: true, data, raw };
  } catch {
    return { exists: true, data: null, raw, error: 'stagepass.json is not valid JSON.' };
  }
}

/**
 * Declared modules from stagepass.json (`null` when missing or legacy boolean).
 * @param {Record<string, unknown> | null} data
 * @returns {string[] | null}
 */
export function declaredModules(data) {
  if (!data || !Array.isArray(data.modules)) return null;
  const result = normalizeModulesList(data.modules);
  return result.ok ? result.modules : null;
}

/** Warn when a stored origin is skipped; never echoes the raw value (F-6). */
function warnSkippedOrigin(log, source, error) {
  if (!log) return;
  log(
    /port/i.test(error)
      ? `Warning: ${source} was skipped: it contains a port, which is not allowed; use the host only, e.g. my-site.webflow.io.`
      : `Warning: ${source} was skipped: it is not a usable site host.`
  );
}

/**
 * Live origin for a project: stagepass.json `origin`, else the first concrete
 * (non-wildcard) origin stored by `stagepass link` for this project folder.
 *
 * @param {string} cwd
 * @param {Record<string, unknown> | null} data
 * @param {{ loadProjects?: typeof loadProjects, realpath?: (p: string) => Promise<string>, log?: (msg: string) => void }} [deps]
 * @returns {Promise<{ origin: string, source: 'stagepass.json' | 'stagepass link' } | null>}
 */
export async function resolveProjectOrigin(cwd, data, deps = {}) {
  if (data && typeof data.origin === 'string' && data.origin.trim() !== '') {
    const check = normalizeSiteUrl(data.origin);
    if (check.ok) return { origin: check.host, source: 'stagepass.json' };
    warnSkippedOrigin(deps.log, 'stagepass.json origin', check.error);
  }
  const load = deps.loadProjects || loadProjects;
  const realpath = deps.realpath || ((p) => fs.realpath(p));
  let doc;
  try {
    doc = await load();
  } catch {
    return null;
  }
  let here = path.resolve(cwd);
  try {
    here = await realpath(here);
  } catch {
    // keep resolved path
  }
  for (const entry of Object.values(doc.projects || {})) {
    if (!entry || typeof entry !== 'object' || typeof entry.root !== 'string') continue;
    let root = path.resolve(entry.root);
    try {
      root = await realpath(root);
    } catch {
      // keep
    }
    if (root !== here) continue;
    for (const origin of Array.isArray(entry.origins) ? entry.origins : []) {
      const check = normalizeSiteUrl(String(origin));
      if (check.ok) return { origin: check.host, source: 'stagepass link' };
      warnSkippedOrigin(deps.log, 'linked origin from stagepass link', check.error);
    }
  }
  return null;
}

/**
 * Decide the declared modules list for `upgrade`.
 * Order: --site-modules flag, live site detection, existing stagepass.json,
 * interactive prompt. The npm dependency is only mentioned as a hint.
 *
 * @param {object} input
 * @param {string} input.cwd
 * @param {Record<string, unknown> | null} input.data stagepass.json
 * @param {object} input.pkg package.json
 * @param {object} input.options { siteModules?, site?, skipSite?, yes? }
 * @param {object} deps
 * @param {(site: string) => Promise<any>} deps.detectSite
 * @param {(question: string, def: string) => Promise<string>} [deps.ask]
 * @param {(question: string, defYes: boolean) => Promise<boolean>} [deps.confirm]
 * @param {boolean} deps.interactive
 * @param {(msg: string) => void} deps.log
 * @param {typeof loadProjects} [deps.loadProjects]
 * @returns {Promise<{ ok: true, modules: string[], source: string, origin: string | null, detection: any } | { ok: false, error: string }>}
 */
export async function resolveUpgradeModules(input, deps) {
  const { cwd, data, pkg, options } = input;
  const log = deps.log;
  const existing = declaredModules(data);

  if (options.siteModules != null) {
    const parsed = normalizeModulesList(options.siteModules);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    let flagOrigin = null;
    if (options.site) {
      const check = normalizeSiteUrl(options.site);
      if (!check.ok) return { ok: false, error: check.error };
      flagOrigin = check.host;
    }
    return { ok: true, modules: parsed.modules, source: '--site-modules', origin: flagOrigin, detection: null };
  }

  /** @type {string | null} */
  let origin = null;
  if (options.site) {
    const check = normalizeSiteUrl(options.site);
    if (!check.ok) return { ok: false, error: check.error };
    origin = check.host;
  } else {
    const found = await resolveProjectOrigin(cwd, data, { loadProjects: deps.loadProjects, log });
    origin = found ? found.origin : null;
  }

  let detection = null;
  /** @type {string[] | null} */
  let candidate = null;
  let source = '';

  if (origin && options.skipSite !== true) {
    log(`Checking live site https://${origin}/ for Stagepass script tags...`);
    detection = await deps.detectSite(origin);
    log(`  ${describeDetection(detection)}`);
    if (detection.ok && detection.loader) {
      candidate = detection.list;
      source = `live site ${origin}`;
    } else if (detection.ok) {
      log('  The page does not load @stagepass/loader, so modules cannot be detected.');
    }
  } else if (!origin) {
    log('No live site known (add "origin" to stagepass.json, pass --site, or link with --origin).');
  }

  const hasModulesDep = Boolean(
    pkg?.dependencies?.['@stagepass/modules'] || pkg?.devDependencies?.['@stagepass/modules']
  );

  if (!candidate && existing) {
    candidate = existing;
    source = 'stagepass.json';
  }

  // Legacy `"modules": true` (CLI 2.0/2.1) meant "modules included", typed via
  // `@stagepass/modules` (all modules). Keep that as `["all"]` so an upgrade
  // without a live site result never removes types the project relied on.
  if (!candidate && data?.modules === true) {
    candidate = ['all'];
    source = 'legacy "modules": true in stagepass.json';
  }

  if (!deps.interactive) {
    if (candidate) {
      log(`Modules: ${formatModules(candidate)} (inferred from ${source}). Check it, or pass --site-modules.`);
      if (candidate.includes('all') && source.startsWith('legacy')) {
        log('Hint: narrow it to the module tags your site loads, e.g. stagepass upgrade --site-modules cookies.');
      }
      return { ok: true, modules: candidate, source, origin, detection };
    }
    if (hasModulesDep) {
      log('Hint: package.json has @stagepass/modules, but that does not show which module tags run on the site.');
    }
    log('Modules: none (no live site result and no list in stagepass.json). Pass --site-modules or run upgrade in a terminal.');
    return { ok: true, modules: [], source: 'default', origin, detection };
  }

  if (candidate && source.startsWith('live site')) {
    const yes = await deps.confirm(
      `Use modules detected on the live site: ${formatModules(candidate)}?`,
      true
    );
    if (yes) return { ok: true, modules: candidate, source, origin, detection };
  }

  if (hasModulesDep && !candidate) {
    log('Hint: package.json has @stagepass/modules; enter the modules whose script tags are on the site.');
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const answer = await deps.ask(
      'Modules your Webflow site loads (none | all | inject,cookies,maintenance)',
      candidate ? formatModules(candidate) : 'none'
    );
    const parsed = normalizeModulesList(answer);
    if (parsed.ok) {
      return { ok: true, modules: parsed.modules, source: 'confirmed', origin, detection };
    }
    log(parsed.error);
  }
  return { ok: false, error: 'No valid modules list entered.' };
}

/**
 * Update `compilerOptions.types` in a tsconfig/jsconfig source.
 *
 * @param {string} raw file contents
 * @param {string[]} modules
 * @param {{ modulesDependency: boolean, perModuleTypes?: boolean }} opts
 * @returns {{ status: 'updated' | 'unchanged' | 'skipped', content?: string, reason?: string, types?: string[] }}
 */
export function updateConfigTypes(raw, modules, opts) {
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    const hasComments = /(^|[^:"'])\/\/|\/\*/.test(raw);
    return {
      status: 'skipped',
      reason: hasComments
        ? 'contains comments (JSONC); edit compilerOptions.types by hand'
        : 'is not valid JSON; edit compilerOptions.types by hand',
    };
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { status: 'skipped', reason: 'is not a JSON object' };
  }
  const co = json.compilerOptions;
  if (!co || typeof co !== 'object' || !Array.isArray(co.types)) {
    return {
      status: 'skipped',
      reason:
        'has no compilerOptions.types array (adding one would hide other @types); add the entries by hand',
    };
  }
  const wanted = typesForModules(modules, opts);
  const kept = co.types.filter(
    (t) => typeof t !== 'string' || (t !== '@stagepass/loader' && !isStagepassModulesTypeEntry(t))
  );
  const nextTypes = [...wanted, ...kept];
  const same =
    nextTypes.length === co.types.length && nextTypes.every((t, i) => t === co.types[i]);
  if (same) return { status: 'unchanged', types: nextTypes };
  json.compilerOptions = { ...co, types: nextTypes };
  const trailing = raw.endsWith('\n') ? '\n' : '';
  return { status: 'updated', content: `${JSON.stringify(json, null, 2)}${trailing}`, types: nextTypes };
}

/**
 * Plan file changes for the declared modules (pure, no writes).
 *
 * @param {object} input
 * @param {string} input.cwd
 * @param {string[]} input.modules
 * @param {string | null} [input.origin] stored in stagepass.json when set
 * @param {object} input.pkg package.json
 * @param {boolean} [input.perModuleTypes] false when @stagepass/modules has no per-module types (umbrella entry)
 * @param {typeof fs} [fse]
 * @returns {Promise<{ writes: { file: string, content: string, action: string }[], notes: string[] }>}
 */
export async function planProjectSync(input, fse = fs) {
  const { cwd, modules, pkg } = input;
  /** @type {{ file: string, content: string, action: string }[]} */
  const writes = [];
  /** @type {string[]} */
  const notes = [];
  const modulesDependency = Boolean(
    pkg?.dependencies?.['@stagepass/modules'] || pkg?.devDependencies?.['@stagepass/modules']
  );
  const perModuleTypes = input.perModuleTypes;

  // stagepass.json
  const sp = await readStagepassJson(cwd, fse);
  if (sp.exists && !sp.data) {
    notes.push(`stagepass.json skipped: ${sp.error}`);
  } else {
    /** @type {Record<string, unknown>} */
    let data;
    if (sp.data) {
      data = { ...sp.data, modules };
    } else {
      data = typeof pkg?.name === 'string' ? { name: pkg.name, modules } : { modules };
    }
    const before = JSON.stringify(sp.data || {});
    if (input.origin) data.origin = input.origin;
    if (!sp.exists) data.version = 1;
    if (JSON.stringify(data) !== before || !sp.exists) {
      const content = `${JSON.stringify(data, null, 2)}\n`;
      writes.push({
        file: 'stagepass.json',
        content,
        action: sp.exists ? `modules: ${formatModules(modules)}` : 'created',
      });
    }
  }

  // AGENTS.md
  const block = buildManagedBlock(modules);
  const agentsPath = path.join(cwd, 'AGENTS.md');
  if (await fse.pathExists(agentsPath)) {
    const raw = await fse.readFile(agentsPath, 'utf8');
    const result = upsertManagedBlock(raw, block);
    if (result.action === 'invalid') {
      notes.push('AGENTS.md skipped: stagepass markers are incomplete; fix or remove them and rerun.');
    } else if (result.action !== 'unchanged') {
      writes.push({
        file: 'AGENTS.md',
        content: result.content,
        action: result.action === 'inserted' ? 'managed block added' : 'managed block refreshed',
      });
    }
  } else {
    const title = typeof pkg?.name === 'string' ? pkg.name : path.basename(cwd);
    writes.push({
      file: 'AGENTS.md',
      content: `# ${title} (Stagepass project)\n\n${block}\n`,
      action: 'created',
    });
  }

  // Cursor rule
  const rulePath = path.join(cwd, CURSOR_RULE_PATH);
  if (await fse.pathExists(rulePath)) {
    const raw = await fse.readFile(rulePath, 'utf8');
    if (raw.includes(BLOCK_BEGIN)) {
      const result = upsertManagedBlock(raw, block);
      if (result.action === 'invalid') {
        notes.push(`${CURSOR_RULE_PATH} skipped: stagepass markers are incomplete.`);
      } else if (result.action !== 'unchanged') {
        writes.push({ file: CURSOR_RULE_PATH, content: result.content, action: 'managed block refreshed' });
      }
    } else {
      notes.push(`${CURSOR_RULE_PATH} exists without stagepass markers; left unchanged.`);
    }
  } else {
    writes.push({ file: CURSOR_RULE_PATH, content: buildCursorRule(modules), action: 'created' });
  }

  // tsconfig / jsconfig
  let sawConfig = false;
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const file = path.join(cwd, name);
    if (!(await fse.pathExists(file))) continue;
    sawConfig = true;
    const raw = await fse.readFile(file, 'utf8');
    const result = updateConfigTypes(raw, modules, { modulesDependency, perModuleTypes });
    if (result.status === 'skipped') {
      const wanted = JSON.stringify(typesForModules(modules, { modulesDependency, perModuleTypes }));
      notes.push(`${name} ${result.reason}: "types": ${wanted}`);
    } else if (result.status === 'updated') {
      writes.push({ file: name, content: result.content, action: `types: ${result.types.join(', ')}` });
    }
  }
  if (!sawConfig) {
    notes.push('No tsconfig.json or jsconfig.json found; types not configured.');
  }
  if (!modulesDependency && modules.length > 0) {
    notes.push('Module types need @stagepass/modules in devDependencies (npm install -D @stagepass/modules).');
  }

  return { writes, notes };
}

/**
 * Write planned changes (skips when dryRun).
 * @param {string} cwd
 * @param {{ file: string, content: string }[]} writes
 * @param {typeof fs} [fse]
 */
export async function applyProjectSync(cwd, writes, fse = fs) {
  const root = path.resolve(cwd);
  for (const w of writes) {
    const abs = path.resolve(root, w.file);
    const rel = path.relative(root, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Refusing to write outside the project: ${w.file}`);
    }
    await fse.ensureDir(path.dirname(abs));
    await fse.writeFile(abs, w.content, 'utf8');
  }
}
