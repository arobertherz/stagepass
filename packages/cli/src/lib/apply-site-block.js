/**
 * Rewrite one Stagepass site block in the Caddyfile from a projects.json entry.
 */

import fs from 'fs-extra';
import { renderSiteBlock, upsertBlock, isPhpEnabled } from './caddyfile.js';
import { validateRoot, getCaddyfilePath } from './paths.js';
import { normalizeDevPort } from './dev-port.js';

/**
 * @param {string} domain
 * @param {{ root?: string, origins?: string[], allowAllOrigins?: boolean, php?: boolean, devPort?: number }} project
 * @param {object} [opts]
 * @param {string} [opts.caddyfilePath]
 * @param {typeof fs} [opts.fs]
 * @returns {Promise<{ ok: true, path: string } | { ok: false, error: string }>}
 */
export async function applySiteBlock(domain, project, opts = {}) {
  const fse = opts.fs || fs;
  const caddyfilePath = opts.caddyfilePath || getCaddyfilePath();
  if (!project || typeof project.root !== 'string') {
    return { ok: false, error: 'Project root is missing.' };
  }
  const rootCheck = validateRoot(project.root);
  if (!rootCheck.ok) {
    return { ok: false, error: rootCheck.error };
  }
  const devPort = normalizeDevPort(project.devPort);
  let block;
  try {
    block = renderSiteBlock(domain, rootCheck.path, {
      allowAllOrigins: project.allowAllOrigins === true,
      origins: project.origins || [],
      php: isPhpEnabled(project.php),
      devPort: devPort || undefined,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  let content = '';
  if (await fse.pathExists(caddyfilePath)) {
    content = await fse.readFile(caddyfilePath, 'utf-8');
  }
  content = upsertBlock(content, domain, block);
  await fse.writeFile(caddyfilePath, `${content.trim()}\n`, 'utf-8');
  return { ok: true, path: caddyfilePath };
}
