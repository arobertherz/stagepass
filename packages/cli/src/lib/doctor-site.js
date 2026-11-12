/**
 * Doctor checks for the current project folder: declared modules in
 * stagepass.json vs. the Stagepass scripts the live Webflow site loads,
 * plus a PHP check when the project opts into PHP.
 * Read-only: one public GET of the live page, parsed and never executed.
 */

import path from 'node:path';
import fs from 'fs-extra';
import { detectSite, describeDetection } from './site-detect.js';
import { formatModules, sameModules } from './project-modules.js';
import {
  declaredModules,
  phpFromStagepassConfig,
  readStagepassJson,
  resolveProjectOrigin,
} from './project-sync.js';
import { resolveCommand } from './exec.js';
import { checkPhpRuntime } from './php-runtime.js';

/**
 * @param {object} [opts]
 * @param {string} [opts.cwd]
 * @param {boolean} [opts.skipSite]
 * @param {(site: string) => Promise<any>} [opts.detectSite]
 * @param {Function} [opts.loadProjects]
 * @param {typeof resolveCommand} [opts.resolveCommand]
 * @param {Function} [opts.exec]
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

  const php = phpFromStagepassConfig(sp.data);
  if (php === false) {
    checks.push({
      id: 'project.php',
      status: 'info',
      message: 'PHP is off for this project (no php_fastcgi on link)',
    });
  } else if (php === true) {
    const runtime = await checkPhpRuntime({
      exec: opts.exec,
      resolveCommand: opts.resolveCommand || resolveCommand,
      pathExists: opts.pathExists,
      platform: opts.platform,
      brewPrefix: opts.brewPrefix,
    });
    const apiOk = await fs.pathExists(path.join(cwd, 'api'));
    if (!runtime.ok) {
      checks.push({
        id: 'project.php',
        status: runtime.status,
        message: `Project enables PHP but ${runtime.message}`,
        detail: runtime.detail || 'Install PHP (stagepass setup) or set "php": false in stagepass.json',
      });
    } else if (!apiOk) {
      checks.push({
        id: 'project.php',
        status: 'warn',
        message: `PHP ${runtime.version.label} is installed but api/ is missing`,
        detail: 'Create api/ for handlers served via php_fastcgi',
      });
    } else {
      checks.push({
        id: 'project.php',
        status: 'ok',
        message: `PHP ${runtime.version.label} enabled for this project (php=${runtime.phpPath}, api/ present)`,
      });
    }
  }

  if (opts.skipSite) return checks;
  const found = await resolveProjectOrigin(cwd, sp.data, { loadProjects: opts.loadProjects });
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
  let siteMsg =
    det.loader.cdn === 'self'
      ? `Live site ${found.origin} loads a self-hosted @stagepass/loader`
      : `Live site ${found.origin} loads @stagepass/loader@${det.loader.version}`;
  if (
    det.loader.cdn === 'self' &&
    det.loader.version &&
    det.loader.version !== 'latest'
  ) {
    siteMsg += ` (version ${det.loader.version})`;
  }
  checks.push({
    id: 'project.site',
    status: 'ok',
    message: siteMsg,
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
