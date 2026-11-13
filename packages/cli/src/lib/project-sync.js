/**
 * Sync generated project files with the declared Stagepass modules
 * (used by `stagepass upgrade` and `stagepass doctor`).
 *
 * Writes only:
 * - stagepass.json `modules` (and `origin` when passed via --site)
 * - AGENTS.md managed block (created when missing)
 * - .cursor/rules/stagepass.mdc (created when missing, managed block refreshed)
 * - tsconfig.json / jsconfig.json `compilerOptions.types` (plain JSON with a types array)
 * - stagepass.d.ts triple-slash references when that array cannot be edited
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
import { validateOriginEntry, validateOriginList } from './origins.js';
import { describeDetection, normalizeSiteUrl, SITE_PORT_ERROR } from './site-detect.js';

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

/**
 * CORS origins declared in stagepass.json for `stagepass link` with no --origin flags.
 * Reads `origin` (staging) and optional `production`. Invalid entries are skipped.
 *
 * @param {Record<string, unknown> | null} data
 * @returns {string[]}
 */
export function originsFromStagepassConfig(data) {
  if (!data || typeof data !== 'object') return [];
  const raw = [];
  for (const key of ['origin', 'production']) {
    const value = data[key];
    if (typeof value !== 'string' || value.trim() === '') continue;
    // Stored config may have incidental spaces; CLI flags are validated raw (AC-10).
    const check = validateOriginEntry(value.trim());
    if (check.ok) raw.push(check.value);
  }
  const validated = validateOriginList(raw);
  return validated.ok ? validated.origins : [];
}

/**
 * PHP toggle from stagepass.json (`undefined` when unset).
 * @param {Record<string, unknown> | null} data
 * @returns {boolean|undefined}
 */
export function phpFromStagepassConfig(data) {
  if (!data || typeof data !== 'object') return undefined;
  if (data.php === true) return true;
  if (data.php === false) return false;
  return undefined;
}

/**
 * Validate a staging/production hostname for `stagepass new` (origins.js rules).
 * @param {string} input
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function validateProjectOriginHost(input) {
  return validateOriginEntry(input);
}

function warnPortSkip(log, source) {
  if (log) log(`Skipped ${source}: it contains a port. Use the host only, e.g. my-site.webflow.io.`);
}

/**
 * Live origin for a project: stagepass.json `origin`, else the first concrete
 * (non-wildcard) origin stored by `stagepass link` for this project folder.
 *
 * @param {string} cwd
 * @param {Record<string, unknown> | null} data
 * @param {{ loadProjects?: typeof loadProjects, realpath?: (p: string) => Promise<string> }} [deps]
 * @returns {Promise<{ origin: string, source: 'stagepass.json' | 'stagepass link' } | null>}
 */
export async function resolveProjectOrigin(cwd, data, deps = {}) {
  if (data && typeof data.origin === 'string' && data.origin.trim() !== '') {
    const check = normalizeSiteUrl(data.origin);
    if (check.ok) return { origin: check.host, source: 'stagepass.json' };
    if (check.error === SITE_PORT_ERROR) warnPortSkip(deps.log, 'stagepass.json origin');
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
      if (check.error === SITE_PORT_ERROR) warnPortSkip(deps.log, 'linked origin from stagepass link');
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
    const found = await resolveProjectOrigin(cwd, data, { loadProjects: deps.loadProjects });
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

/** First-line marker. Upgrade rewrites the file only when this is present. */
export const STAGEPASS_TYPES_MARKER = '@stagepass-types';

export function renderStagepassTypesFile(types) {
  const refs = types.map((entry) => `/// <reference types="${entry}" />`);
  return `// ${STAGEPASS_TYPES_MARKER}\n${refs.join('\n')}\n`;
}

/** True when `dtsRel` is a root file. A directory include (`src`) expands to everything under it. */
export function configCoversTypesFile(json, dtsRel) {
  const rel = normalizeConfigRel(dtsRel);
  if (!rel || !json || typeof json !== 'object') return false;
  const files = Array.isArray(json.files) ? json.files : [];
  for (const entry of files) {
    if (normalizeConfigRel(entry) === rel) return true;
  }
  const include = Array.isArray(json.include) ? json.include : [];
  if (files.length === 0 && include.length === 0) return !isConfigExcluded(rel, json);
  if (include.some((pattern) => includePatternMatches(rel, pattern)) && !isConfigExcluded(rel, json)) {
    return true;
  }
  return false;
}

function normalizeConfigRel(value) {
  let rel = String(value ?? '').trim().replace(/\\/g, '/');
  if (rel.startsWith('./')) rel = rel.slice(2);
  if (!rel || rel.startsWith('/') || rel.split('/').includes('..')) return '';
  return rel.replace(/\/+/g, '/');
}

function expandIncludePattern(pattern) {
  const rel = normalizeConfigRel(pattern);
  if (!rel) return '';
  const last = rel.split('/').pop() || '';
  if (!/[?*]/.test(last) && !last.includes('.')) return `${rel}/**/*`;
  return rel;
}

function includePatternMatches(rel, pattern) {
  const expanded = expandIncludePattern(pattern);
  if (!expanded) return false;
  return globToRegExp(expanded).test(rel);
}

function includeDirPrefix(pattern) {
  const expanded = expandIncludePattern(pattern);
  if (!expanded) return null;
  const idx = expanded.search(/[*?]/);
  if (idx === -1) return null;
  const head = expanded.slice(0, idx).replace(/\/$/, '');
  if (/[*?]/.test(head)) return null;
  return head;
}

function globToRegExp(pattern) {
  let re = '';
  let i = 0;
  while (i < pattern.length) {
    if (pattern.startsWith('**/', i)) {
      re += '(?:.*/)?';
      i += 3;
      continue;
    }
    if (pattern.startsWith('**', i)) {
      re += '.*';
      i += 2;
      continue;
    }
    const ch = pattern[i];
    if (ch === '*') {
      re += '[^/]*';
      i += 1;
      continue;
    }
    if (ch === '?') {
      re += '[^/]';
      i += 1;
      continue;
    }
    re += /[\\^$+()|[\]{}.]/.test(ch) ? `\\${ch}` : ch;
    i += 1;
  }
  return new RegExp(`^${re}$`);
}

function isConfigExcluded(rel, json) {
  /** @type {unknown[]} */
  const patterns = ['node_modules', 'bower_components', 'jspm_packages'];
  const outDir = /** @type {{ outDir?: unknown }} */ (json.compilerOptions || {}).outDir;
  if (typeof outDir === 'string' && normalizeConfigRel(outDir)) patterns.push(normalizeConfigRel(outDir));
  if (Array.isArray(json.exclude)) patterns.push(...json.exclude);
  for (const pattern of patterns) {
    const normalized = normalizeConfigRel(pattern);
    if (!normalized) continue;
    if (rel === normalized || rel.startsWith(`${normalized}/`)) return true;
    if (/[*?]/.test(normalized) && globToRegExp(normalized).test(rel)) return true;
  }
  return false;
}

function parseConfigSource(raw) {
  const asObject = (/** @type {unknown} */ value, kind) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { kind: 'invalid', json: null };
    return { kind, json: /** @type {Record<string, unknown>} */ (value) };
  };
  try {
    return asObject(JSON.parse(raw), 'json');
  } catch {
    try {
      return asObject(JSON.parse(stripJsonComments(raw)), 'jsonc');
    } catch {
      return { kind: 'invalid', json: null };
    }
  }
}

function stripJsonComments(raw) {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < raw.length) {
    const ch = raw[i];
    const next = raw[i + 1];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += next || '';
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < raw.length && raw[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < raw.length && !(raw[i] === '*' && raw[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out.replace(/,\s*([}\]])/g, '$1');
}

function hasTypesArray(json) {
  const co = json && /** @type {{ types?: unknown }} */ (json.compilerOptions);
  return !!(co && typeof co === 'object' && Array.isArray(co.types));
}

function hasTypesMarker(raw) {
  return String(raw)
    .split(/\r?\n/)
    .slice(0, 8)
    .some((line) => line.includes(STAGEPASS_TYPES_MARKER));
}

async function planEditorTypes(input) {
  const { cwd, modules, modulesDependency, perModuleTypes, skipSymlink, fse } = input;
  /** @type {{ file: string, content: string, action: string }[]} */
  const writes = [];
  /** @type {string[]} */
  const notes = [];
  const wanted = typesForModules(modules, { modulesDependency, perModuleTypes });
  const content = renderStagepassTypesFile(wanted);

  /** @type {{ name: string, symlink?: boolean, needsDts?: boolean, kind?: string, json?: Record<string, unknown> | null }[]} */
  const configs = [];
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const file = path.join(cwd, name);
    if (!(await fse.pathExists(file))) continue;
    if (await skipSymlink(name)) {
      configs.push({ name, symlink: true });
      continue;
    }
    const raw = await fse.readFile(file, 'utf8');
    const parsed = parseConfigSource(raw);
    if (parsed.kind === 'json' && hasTypesArray(parsed.json)) {
      const result = updateConfigTypes(raw, modules, { modulesDependency, perModuleTypes });
      if (result.status === 'updated' && result.content) {
        writes.push({ file: name, content: result.content, action: `types: ${(result.types || []).join(', ')}` });
      }
      configs.push({ name, needsDts: false, json: parsed.json });
      continue;
    }
    configs.push({ name, needsDts: true, kind: parsed.kind, json: parsed.json });
  }

  /**
   * @param {string} rel
   * @returns {Promise<'placed' | 'current' | 'blocked'>}
   */
  const writeTypesFile = async (rel) => {
    if (writes.some((item) => item.file === rel)) return 'placed';
    if (await skipSymlink(rel)) return 'blocked';
    const abs = path.join(cwd, rel);
    if (await fse.pathExists(abs)) {
      const previous = await fse.readFile(abs, 'utf8');
      if (!hasTypesMarker(previous)) {
        notes.push(`${rel} has no ${STAGEPASS_TYPES_MARKER} marker; left unchanged.`);
        return 'blocked';
      }
      if (previous === content) return 'current';
    }
    writes.push({ file: rel, content, action: `references ${wanted.join(', ')}` });
    return 'placed';
  };

  if (configs.length === 0) {
    await writeTypesFile('stagepass.d.ts');
    return { writes, notes };
  }

  const needing = configs.filter((config) => config.needsDts);
  if (needing.length === 0) {
    const rels = new Set(['stagepass.d.ts']);
    for (const config of configs) {
      const include = config.json && Array.isArray(config.json.include) ? config.json.include : [];
      for (const pattern of include) {
        const dir = includeDirPrefix(pattern);
        if (dir == null) continue;
        rels.add(dir === '' ? 'stagepass.d.ts' : `${dir}/stagepass.d.ts`);
      }
    }
    for (const rel of rels) {
      const abs = path.join(cwd, rel);
      let previous = '';
      try {
        const st = await fse.lstat(abs);
        if (!st.isFile()) continue;
        previous = await fse.readFile(abs, 'utf8');
      } catch {
        continue;
      }
      if (hasTypesMarker(previous)) await writeTypesFile(rel);
    }
    return { writes, notes };
  }

  /** @type {{ rel: string, score: number }[]} */
  const ranked = [];
  /** @type {string[]} */
  const candidates = ['stagepass.d.ts'];
  for (const config of needing) {
    const include = config.json && Array.isArray(config.json.include) ? config.json.include : [];
    for (const pattern of include) {
      const dir = includeDirPrefix(pattern);
      if (dir == null) continue;
      const rel = dir === '' ? 'stagepass.d.ts' : `${dir}/stagepass.d.ts`;
      if (!candidates.includes(rel)) candidates.push(rel);
    }
  }
  for (const rel of candidates) {
    const score = needing.filter((config) => coversTypesPath(config, rel)).length;
    if (score > 0) ranked.push({ rel, score });
  }
  ranked.sort((a, b) => b.score - a.score || candidates.indexOf(a.rel) - candidates.indexOf(b.rel));

  /** @type {string | null} */
  let placedRel = null;
  for (const item of ranked) {
    const status = await writeTypesFile(item.rel);
    if (status === 'placed' || status === 'current') {
      placedRel = item.rel;
      break;
    }
  }

  for (const config of needing) {
    notes.push(typesConfigNote(config, placedRel));
    const ownInclude = Array.isArray(config.json?.include) && config.json.include.length > 0;
    const ownFiles = Array.isArray(config.json?.files) && config.json.files.length > 0;
    if (placedRel && config.json && config.json.extends && !ownInclude && !ownFiles) {
      notes.push(
        `${config.name} extends another config and does not set include or files. Confirm ${placedRel} is part of that project.`
      );
    }
  }
  return { writes, notes };
}

function coversTypesPath(config, rel) {
  if (config.kind === 'invalid') return rel === 'stagepass.d.ts';
  if (!config.json) return false;
  return configCoversTypesFile(config.json, rel);
}

function typesConfigNote(config, placedRel) {
  if (config.kind === 'jsonc') {
    const base = `${config.name} contains comments and was left unchanged.`;
    if (placedRel && coversTypesPath(config, placedRel)) return `${base} Types: ${placedRel}.`;
    return `${base} Its include/files does not cover stagepass.d.ts.`;
  }
  if (config.kind === 'invalid') {
    const base = `${config.name} is not valid JSON and was left unchanged.`;
    return placedRel
      ? `${base} Types: ${placedRel} (include coverage was not checked).`
      : base;
  }
  const base = `${config.name} has no compilerOptions.types array and was left unchanged.`;
  if (placedRel && coversTypesPath(config, placedRel)) return `${base} Types: ${placedRel}.`;
  return `${config.name} include/files does not cover stagepass.d.ts. The config was left unchanged.`;
}

/** @param {string} abs @param {typeof fs} fse */
async function isSymlink(abs, fse) {
  try {
    return (await fse.lstat(abs)).isSymbolicLink();
  } catch {
    return false;
  }
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
  /** Skip target when it (or a path ancestor under cwd) is a symlink. */
  const skipSymlink = async (rel) => {
    const abs = path.join(cwd, rel);
    const root = path.resolve(cwd);
    let cur = abs;
    for (;;) {
      if (await isSymlink(cur, fse)) {
        notes.push(`${rel} is a symlink; left unchanged`);
        return true;
      }
      const parent = path.dirname(cur);
      if (parent === cur || path.resolve(parent) === root) break;
      if (!path.resolve(parent).startsWith(root + path.sep) && path.resolve(parent) !== root) break;
      cur = parent;
    }
    return false;
  };

  // stagepass.json
  const sp = await readStagepassJson(cwd, fse);
  if (sp.exists && !sp.data) {
    notes.push(`stagepass.json skipped: ${sp.error}`);
  } else if (!(await skipSymlink('stagepass.json'))) {
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
  if (await skipSymlink('AGENTS.md')) {
    // note already added
  } else if (await fse.pathExists(agentsPath)) {
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
  if (await skipSymlink(CURSOR_RULE_PATH)) {
    // note already added
  } else if (await fse.pathExists(rulePath)) {
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

  const typesPlan = await planEditorTypes({
    cwd,
    modules,
    modulesDependency,
    perModuleTypes,
    skipSymlink,
    fse,
  });
  writes.push(...typesPlan.writes);
  notes.push(...typesPlan.notes);
  if (!modulesDependency && modules.length > 0) {
    notes.push('Module types need @stagepass/modules in devDependencies (npm install -D @stagepass/modules).');
  }

  return { writes, notes };
}

/**
 * Write planned changes. On failure restores prior file contents (INV-4).
 * @param {string} cwd
 * @param {{ file: string, content: string }[]} writes
 * @param {typeof fs} [fse]
 */
export async function applyProjectSync(cwd, writes, fse = fs) {
  const root = path.resolve(cwd);
  const rootReal = await fse.realpath(root);
  /** @type {{ abs: string, previous: string | null, createdDir: string | null }[]} */
  const journal = [];
  try {
    for (const w of writes) {
      const abs = path.resolve(root, w.file);
      const rel = path.relative(root, abs);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`Refusing to write outside the project: ${w.file}`);
      }
      if (await isSymlink(abs, fse)) {
        throw new Error(`Refusing to write through symlink: ${w.file}`);
      }
      const parent = path.dirname(abs);
      let parentProbe = parent;
      for (;;) {
        try {
          const parentReal = await fse.realpath(parentProbe);
          if (parentReal !== rootReal && !parentReal.startsWith(rootReal + path.sep)) {
            throw new Error(`Refusing to write outside the project: ${w.file}`);
          }
          break;
        } catch (err) {
          if (err instanceof Error && err.message.startsWith('Refusing')) throw err;
          const up = path.dirname(parentProbe);
          if (up === parentProbe) throw err;
          parentProbe = up;
        }
      }
      let previous = null;
      try {
        previous = await fse.readFile(abs, 'utf8');
      } catch (err) {
        if (!(err && /** @type {{ code?: string }} */ (err).code === 'ENOENT')) throw err;
      }
      let createdDir = null;
      if (!(await fse.pathExists(parent))) {
        await fse.ensureDir(parent);
        createdDir = parent;
      } else {
        await fse.ensureDir(parent);
      }
      await fse.writeFile(abs, w.content, 'utf8');
      journal.push({ abs, previous, createdDir });
    }
  } catch (err) {
    for (const entry of [...journal].reverse()) {
      try {
        if (entry.previous == null) await fse.remove(entry.abs);
        else await fse.writeFile(entry.abs, entry.previous, 'utf8');
        if (entry.createdDir) await fse.remove(entry.createdDir);
      } catch {
        /* best effort */
      }
    }
    throw err;
  }
}
