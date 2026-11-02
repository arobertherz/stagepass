import fs from 'fs-extra';
import path from 'path';
import { getProjectsPath } from './paths.js';
import { validateOriginList } from './origins.js';
import { isPidAlive, isValidDevPort, normalizeDevPort } from './dev-port.js';

/**
 * Per-project CORS / PHP / live-reload settings stored in ~/.stagepass/projects.json
 *
 * Shape:
 * {
 *   "version": 1,
 *   "projects": {
 *     "my-app.sp": {
 *       "root": "/absolute/path",
 *       "origins": ["example.com", "*.example.org"],
 *       "allowAllOrigins": false,
 *       "php": true,
 *       "devPort": 34567,
 *       "devPid": 12345
 *     }
 *   }
 * }
 *
 * `php` is optional: missing means PHP on (legacy linked projects keep php_fastcgi).
 * `devPort` / `devPid` are set only while `stagepass dev` is running for that project.
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
 * @returns {Promise<{ root?: string, origins: string[], allowAllOrigins: boolean, php?: boolean, devPort?: number, devPid?: number }|null>}
 */
export async function getProject(domain, filePath = getProjectsPath()) {
  const doc = await loadProjects(filePath);
  const entry = doc.projects[domain];
  if (!entry) return null;
  return normalizeProjectEntry(entry);
}

/**
 * Find a linked project whose root matches cwd (realpath when possible).
 * @param {string} cwd
 * @param {string} [filePath]
 * @returns {Promise<{ domain: string, project: ReturnType<typeof normalizeProjectEntry> }|null>}
 */
export async function findProjectByRoot(cwd, filePath = getProjectsPath()) {
  const doc = await loadProjects(filePath);
  let target;
  try {
    target = fs.realpathSync(path.resolve(cwd));
  } catch {
    target = path.resolve(cwd);
  }
  for (const [domain, raw] of Object.entries(doc.projects || {})) {
    if (!raw || typeof raw.root !== 'string') continue;
    let root;
    try {
      root = fs.realpathSync(path.resolve(raw.root));
    } catch {
      root = path.resolve(raw.root);
    }
    if (root === target) {
      return { domain, project: normalizeProjectEntry(raw) };
    }
  }
  return null;
}

/**
 * Persist live-reload port/pid for a domain (or clear when port is null).
 * @param {string} domain
 * @param {{ port: number|null, pid?: number|null }} update
 * @param {string} [filePath]
 */
export async function setProjectDevPort(domain, update, filePath = getProjectsPath()) {
  const doc = await loadProjects(filePath);
  const existing = doc.projects[domain];
  if (!existing) {
    throw new Error(`No projects.json entry for ${domain}. Run stagepass link first.`);
  }
  const next = { ...existing };
  if (update.port == null) {
    delete next.devPort;
    delete next.devPid;
  } else {
    if (!isValidDevPort(update.port)) {
      throw new Error(`Invalid devPort ${String(update.port)} (must be an integer 1024..65535).`);
    }
    next.devPort = update.port;
    if (typeof update.pid === 'number' && Number.isInteger(update.pid) && update.pid > 0) {
      next.devPid = update.pid;
    } else {
      delete next.devPid;
    }
  }
  doc.projects[domain] = next;
  await saveProjects(doc, filePath);
  return normalizeProjectEntry(next);
}

/**
 * Drop stale devPort/devPid when the recorded PID is dead.
 * @param {string} [filePath]
 * @returns {Promise<string[]>} domains that were cleaned
 */
export async function clearStaleDevPorts(filePath = getProjectsPath()) {
  const doc = await loadProjects(filePath);
  const cleaned = [];
  let changed = false;
  for (const [domain, raw] of Object.entries(doc.projects || {})) {
    if (!raw || (raw.devPort == null && raw.devPid == null)) continue;
    const port = normalizeDevPort(raw.devPort);
    const pid = raw.devPid;
    const alive = isPidAlive(pid);
    if (!port || !alive) {
      delete raw.devPort;
      delete raw.devPid;
      cleaned.push(domain);
      changed = true;
    }
  }
  if (changed) await saveProjects(doc, filePath);
  return cleaned;
}

/**
 * Merge and persist project settings.
 *
 * Flag semantics for link:
 * - originsFromFlags: when non-empty, merge into existing (deduped)
 * - originsToRemove: when non-empty, remove matching stored origins (after merge)
 * - allowAllOriginsFlag: true | false | undefined (undefined = keep existing / seed / default)
 * - phpFlag: true | false | undefined (undefined = keep existing / seed / omit)
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
 * @param {boolean|undefined} [update.phpFlag]
 * @param {{ origins?: string[], allowAllOrigins?: boolean, php?: boolean }|null} [update.seed]
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

  let php = existing.php;
  if (update.phpFlag === true) php = true;
  if (update.phpFlag === false) php = false;

  /** @type {Record<string, unknown>} */
  const next = {
    root: update.root,
    origins,
    allowAllOrigins,
  };
  if (php === true || php === false) {
    next.php = php;
  }
  // Preserve live-reload fields across link/upsert unless explicitly cleared elsewhere.
  const prevDevPort = normalizeDevPort(existing.devPort);
  if (prevDevPort) next.devPort = prevDevPort;
  if (
    typeof existing.devPid === 'number' &&
    Number.isInteger(existing.devPid) &&
    existing.devPid > 0
  ) {
    next.devPid = existing.devPid;
  }

  doc.projects[domain] = next;

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
  /** @type {{ root?: string, origins: string[], allowAllOrigins: boolean, php?: boolean, devPort?: number, devPid?: number }} */
  const out = {
    root: entry.root,
    origins: originsResult.ok ? originsResult.origins : [],
    allowAllOrigins: entry.allowAllOrigins === true,
  };
  if (entry.php === true) out.php = true;
  if (entry.php === false) out.php = false;
  const devPort = normalizeDevPort(entry.devPort);
  if (devPort) out.devPort = devPort;
  if (
    typeof entry.devPid === 'number' &&
    Number.isInteger(entry.devPid) &&
    entry.devPid > 0
  ) {
    out.devPid = entry.devPid;
  }
  return out;
}
