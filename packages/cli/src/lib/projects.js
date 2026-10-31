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
 * - allowAllOriginsFlag: true | false | undefined (undefined = keep existing / default)
 *
 * @param {string} domain
 * @param {object} update
 * @param {string} update.root
 * @param {string[]} [update.originsFromFlags]
 * @param {boolean|undefined} [update.allowAllOriginsFlag]
 * @param {boolean} [update.isNew]
 */
export async function upsertProject(domain, update, filePath = getProjectsPath()) {
  const doc = await loadProjects(filePath);
  const existing = doc.projects[domain]
    ? normalizeProjectEntry(doc.projects[domain])
    : { origins: [], allowAllOrigins: false };

  let origins = existing.origins;
  if (Array.isArray(update.originsFromFlags) && update.originsFromFlags.length > 0) {
    const merged = validateOriginList([...existing.origins, ...update.originsFromFlags]);
    if (!merged.ok) {
      throw new Error(merged.error);
    }
    origins = merged.origins;
  }

  let allowAllOrigins = existing.allowAllOrigins;
  if (update.isNew && update.allowAllOriginsFlag === undefined) {
    allowAllOrigins = false;
  }
  if (update.allowAllOriginsFlag === true) allowAllOrigins = true;
  if (update.allowAllOriginsFlag === false) allowAllOrigins = false;

  // Migration helper: force allowAllOrigins
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
 * Ensure a migrated legacy project exists with allowAllOrigins true.
 */
export async function ensureMigratedProject(domain, root, filePath = getProjectsPath()) {
  const doc = await loadProjects(filePath);
  const existing = doc.projects[domain];
  if (existing) {
    // Keep stored origins; ensure allowAllOrigins stays true for migration pass only if not set?
    // Migration should set allowAllOrigins true once; if user already configured, don't overwrite
    // except when creating from legacy Caddyfile with no projects.json entry.
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
