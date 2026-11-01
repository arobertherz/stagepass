import fs from 'fs-extra';
import path from 'path';
import { getProjectsPath } from './paths.js';
import { validateOriginList } from './origins.js';

/**
 * Per-project CORS settings stored in ~/.stagepass/projects.json
 *
 * Shape:
 * {
 *   "version": 1,
 *   "projects": {
 *     "my-app.sp": {
 *       "root": "/absolute/path",
 *       "origins": ["example.com", "*.example.org"],
 *       "allowAllOrigins": false
 *     }
 *   }
 * }
 */

const DEFAULT_DOC = { version: 1, projects: {} };

/**
 * @returns {Promise<{ version: number, projects: Record<string, object> }>}
 */
export async function loadProjects(filePath = getProjectsPath()) {
  if (!(await fs.pathExists(filePath))) {
    return structuredClone(DEFAULT_DOC);
  }
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || typeof data.projects !== 'object') {
      return structuredClone(DEFAULT_DOC);
    }
    return {
      version: 1,
      projects: data.projects || {},
    };
  } catch {
    return structuredClone(DEFAULT_DOC);
  }
}

/**
 * @param {{ version: number, projects: Record<string, object> }} doc
 */
export async function saveProjects(doc, filePath = getProjectsPath()) {
  await fs.ensureDir(path.dirname(filePath));
  const payload = {
    version: 1,
    projects: doc.projects || {},
  };
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

/**
 * @param {string} domain
 * @returns {Promise<{ root?: string, origins: string[], allowAllOrigins: boolean }|null>}
 */
export async function getProject(domain, filePath = getProjectsPath()) {
  const doc = await loadProjects(filePath);
  const entry = doc.projects[domain];
  if (!entry) return null;
  return normalizeProjectEntry(entry);
}

/**
 * Merge and persist project settings.
 *
 * Flag semantics for link:
 * - originsFromFlags: when non-empty, merge into existing (deduped)
 * - originsToRemove: when non-empty, remove matching stored origins (after merge)
 * - allowAllOriginsFlag: true | false | undefined (undefined = keep existing / seed / default)
 * - seed: when no projects.json entry exists, start from these values (e.g. Caddyfile marker)
 * - isNew: when true and allowAllOriginsFlag is undefined, default allowAllOrigins to false
 * - forceAllowAllOrigins: migration helper; force true once
 *
 * @param {string} domain
 * @param {object} update
 * @param {string} update.root
 * @param {string[]} [update.originsFromFlags]
 * @param {string[]} [update.originsToRemove]
 * @param {boolean|undefined} [update.allowAllOriginsFlag]
 * @param {{ origins?: string[], allowAllOrigins?: boolean }|null} [update.seed]
 * @param {boolean} [update.isNew]
 * @param {boolean} [update.forceAllowAllOrigins]
 */
export async function upsertProject(domain, update, filePath = getProjectsPath()) {
  const doc = await loadProjects(filePath);
  const existing = doc.projects[domain]
    ? normalizeProjectEntry(doc.projects[domain])
    : update.seed
      ? normalizeProjectEntry(update.seed)
      : { origins: [], allowAllOrigins: false };

  let origins = existing.origins;
  if (Array.isArray(update.originsFromFlags) && update.originsFromFlags.length > 0) {
    const merged = validateOriginList([...existing.origins, ...update.originsFromFlags]);
    if (!merged.ok) {
      throw new Error(merged.error);
    }
    origins = merged.origins;
  }

  if (Array.isArray(update.originsToRemove) && update.originsToRemove.length > 0) {
    const toRemove = validateOriginList(update.originsToRemove);
    if (!toRemove.ok) {
      throw new Error(toRemove.error);
    }
    const removeSet = new Set(toRemove.origins);
    origins = origins.filter((o) => !removeSet.has(o));
  }

  let allowAllOrigins = existing.allowAllOrigins;
  if (update.isNew && update.allowAllOriginsFlag === undefined) {
    allowAllOrigins = false;
  }
  if (update.allowAllOriginsFlag === true) allowAllOrigins = true;
  if (update.allowAllOriginsFlag === false) allowAllOrigins = false;

  if (update.forceAllowAllOrigins === true) {
    allowAllOrigins = true;
  }

  doc.projects[domain] = {
    root: update.root,
    origins,
    allowAllOrigins,
  };

  await saveProjects(doc, filePath);
  return normalizeProjectEntry(doc.projects[domain]);
}

/**
 * Ensure a projects.json entry exists after migrating a legacy Caddy block.
 *
 * Semantics:
 * - Existing entry: leave unchanged (never drop stored origins; never force
 *   allowAllOrigins — the user may already have tightened CORS).
 * - New entry from legacy migration: allowAllOrigins=true for compatibility,
 *   origins=[] until the user adds --origin.
 *
 * A migrated legacy project therefore keeps allowAllOrigins=true until the user
 * turns it off; existing stored origins are never dropped by migration.
 */
export async function ensureMigratedProject(domain, root, filePath = getProjectsPath()) {
  const doc = await loadProjects(filePath);
  const existing = doc.projects[domain];
  if (existing) {
    return normalizeProjectEntry(existing);
  }
  doc.projects[domain] = {
    root,
    origins: [],
    allowAllOrigins: true,
  };
  await saveProjects(doc, filePath);
  return normalizeProjectEntry(doc.projects[domain]);
}

export async function removeProject(domain, filePath = getProjectsPath()) {
  const doc = await loadProjects(filePath);
  if (doc.projects[domain]) {
    delete doc.projects[domain];
    await saveProjects(doc, filePath);
    return true;
  }
  return false;
}

function normalizeProjectEntry(entry) {
  const originsResult = validateOriginList(entry.origins || []);
  return {
    root: entry.root,
    origins: originsResult.ok ? originsResult.origins : [],
    allowAllOrigins: entry.allowAllOrigins === true,
  };
}
