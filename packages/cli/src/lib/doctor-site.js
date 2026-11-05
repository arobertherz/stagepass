/**
 * Doctor checks: declared modules vs Stagepass scripts on the live site.
 * Read-only public GET; HTML parsed, never executed.
 */

import path from 'node:path';
import fs from 'fs-extra';
import { detectSite, describeDetection } from './site-detect.js';
import { formatModules, sameModules } from './project-modules.js';
import { declaredModules, readStagepassJson, resolveProjectOrigin } from './project-sync.js';

/**
 * @param {object} [opts]
 * @param {string} [opts.cwd]
 * @param {boolean} [opts.skipSite]
 * @param {(site: string) => Promise<any>} [opts.detectSite]
 * @param {Function} [opts.loadProjects]
 * @returns {Promise<{ id: string, status: 'ok'|'warn'|'fail'|'info', message: string, detail?: string }[]>}
 */
export async function runProjectSiteChecks(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  if (!(await fs.pathExists(path.join(cwd, 'stagepass.json')))) return [];

  const checks = [];
  const sp = await readStagepassJson(cwd);
  if (!sp.data) {
    checks.push({ id: 'project.config', status: 'warn', message: sp.error || 'stagepass.json unreadable' });
    return checks;
  }
  const declared = declaredModules(sp.data);
  if (!declared) {
    checks.push({
      id: 'project.modules',
      status: 'warn',
      message: 'stagepass.json has no modules list (["cookies"], ["all"] or [])',
      detail: 'Run: stagepass upgrade',
    });
  } else {
    checks.push({ id: 'project.modules', status: 'ok', message: `Declared modules: ${formatModules(declared)}` });
  }

  if (opts.skipSite) return checks;
  const found = await resolveProjectOrigin(cwd, sp.data, { loadProjects: opts.loadProjects, log: opts.log });
  if (!found) {
    checks.push({
      id: 'project.site',
      status: 'info',
      message: 'No live site known for this project',
      detail: 'Add "origin" to stagepass.json or run stagepass link <name> --origin <host>',
    });
    return checks;
  }

  const det = await (opts.detectSite || detectSite)(found.origin);
  if (!det.ok) {
    checks.push({
      id: 'project.site',
      status: 'warn',
      message: `Live site ${found.origin} could not be checked`,
      detail: det.error,
    });
    return checks;
  }
  if (!det.loader) {
    checks.push({
      id: 'project.site',
      status: 'warn',
      message: `Live site ${found.origin} does not load @stagepass/loader`,
      detail: describeDetection(det),
    });
    return checks;
  }
  checks.push({
    id: 'project.site',
    status: 'ok',
    message: `Live site ${found.origin} loads @stagepass/loader@${det.loader.version}`,
    detail: describeDetection(det),
  });
  if (declared && !sameModules(declared, det.list)) {
    checks.push({
      id: 'project.site.modules',
      status: 'warn',
      message: `Modules differ: stagepass.json ${formatModules(declared)}, live site ${formatModules(det.list)}`,
      detail: 'Run stagepass upgrade to sync, or change the Webflow script tags.',
    });
  }
  return checks;
}
