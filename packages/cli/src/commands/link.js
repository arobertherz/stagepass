import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { execa } from 'execa';
import { createSpinner } from '../lib/spinner.js';
import { resolveLinkDomain } from '../lib/domain.js';
import { renderSiteBlock, upsertBlock, parseBlocks } from '../lib/caddyfile.js';
import {
  validateRoot,
  getCaddyfilePath,
  getStagepassDir,
  getProjectsPath,
} from '../lib/paths.js';
import { upsertProject, getProject, clearStaleDevPorts } from '../lib/projects.js';
import {
  validateOriginList,
  isBroadWebflowWildcard,
} from '../lib/origins.js';
import { ensureCaddyfileMigrated } from '../lib/migrate.js';
import { CADDY_UPGRADE_HINT, readCaddyVersion } from '../lib/caddy-version.js';
import {
  originsFromStagepassConfig,
  phpFromStagepassConfig,
  readStagepassJson,
} from '../lib/project-sync.js';
import { isPhpEnabled } from '../lib/caddyfile.js';

/**
 * @param {string|undefined} domain
 * @param {object} options
 * @param {boolean} [options.verbose]
 * @param {string[]} [options.origin]
 * @param {string[]} [options.removeOrigin]
 * @param {boolean} [options.allowAllOrigins]
 * @param {string} [options.cwd]
 * @param {object} [deps]
 * @param {string} [deps.cwd]
 * @param {(msg?: string) => void} [deps.log]
 * @param {(msg?: string) => void} [deps.error]
 * @param {import('../lib/exec.js').ExecFn} [deps.exec]
 */
export async function link(domain, options = {}, deps = {}) {
  const log = deps.log || console.log;
  const error = deps.error || console.error;
  const currentDir = deps.cwd || options.cwd || process.cwd();
  const folderName = path.basename(currentDir);

  const resolved = resolveLinkDomain(domain, folderName);
  if (!resolved.ok) {
    log(chalk.red(`❌ ${resolved.error}`));
    return 1;
  }

  const targetDomain = resolved.domain;
  const rootCheck = validateRoot(currentDir);
  if (!rootCheck.ok) {
    log(chalk.red(`❌ ${rootCheck.error}`));
    return 1;
  }

  let originsFromFlags = options.origin || [];
  const originsToRemove = options.removeOrigin || [];
  const stagepass = await readStagepassJson(currentDir);
  const configOrigins = originsFromStagepassConfig(stagepass.data);
  const configPhp = phpFromStagepassConfig(stagepass.data);

  // No origin flags: use staging/production from stagepass.json when present.
  if (
    originsFromFlags.length === 0 &&
    originsToRemove.length === 0 &&
    configOrigins.length > 0
  ) {
    originsFromFlags = configOrigins;
    log(
      chalk.dim(
        `   Using origins from stagepass.json: ${configOrigins.join(', ')}`
      )
    );
  }

  if (originsFromFlags.length > 0) {
    const check = validateOriginList(originsFromFlags);
    if (!check.ok) {
      log(chalk.red(`❌ Invalid --origin: ${check.error}`));
      return 1;
    }
    originsFromFlags = check.origins;
    for (const entry of check.origins) {
      if (isBroadWebflowWildcard(entry)) {
        log(
          chalk.yellow(
            `   Warning: ${entry} allows any Webflow user's site to make cross-origin requests to this .sp domain.`
          )
        );
      }
    }
  }

  if (originsToRemove.length > 0) {
    const check = validateOriginList(originsToRemove);
    if (!check.ok) {
      log(chalk.red(`❌ Invalid --remove-origin: ${check.error}`));
      return 1;
    }
  }

  let allowAllOriginsFlag;
  if (options.allowAllOrigins === true) allowAllOriginsFlag = true;
  else if (options.allowAllOrigins === false) allowAllOriginsFlag = false;
  else allowAllOriginsFlag = undefined;

  const phpFlag = configPhp;

  const caddyDir = getStagepassDir();
  const caddyFilePath = getCaddyfilePath();
  const projectsPath = getProjectsPath();

  if (resolved.slugged) {
    log(
      chalk.dim(
        `Folder name was not a valid domain; using ${chalk.bold(targetDomain)}`
      )
    );
  }

  const spinner = createSpinner(`Linking ${chalk.bold(targetDomain)}...`).start();

  try {
    await fs.ensureDir(caddyDir);

    spinner.stop();
    const caddy = await readCaddyVersion(deps.exec);
    await ensureCaddyfileMigrated({ caddyfilePath: caddyFilePath, projectsPath, caddy });
    if (caddy.known && !caddy.ok) {
      log(
        chalk.yellow(
          `   This site block is v3 and needs Caddy 2.9 or newer for CORS on success responses. ${CADDY_UPGRADE_HINT}`
        )
      );
    }
    await clearStaleDevPorts(projectsPath);
    spinner.start(`Linking ${chalk.bold(targetDomain)}...`);

    let content = '';
    if (await fs.pathExists(caddyFilePath)) {
      content = await fs.readFile(caddyFilePath, 'utf-8');
    }

    const existingBlocks = parseBlocks(content);
    const existingBlock = existingBlocks.find((b) => b.domain === targetDomain);
    const alreadyLinked = Boolean(existingBlock);
    const existingProject = await getProject(targetDomain, projectsPath);
    const isNew = !alreadyLinked && !existingProject;

    // When projects.json is missing the domain but a v2 block exists, seed from
    // the block marker so re-link does not silently reset CORS settings.
    let seed = null;
    if (!existingProject && existingBlock && !existingBlock.isLegacy) {
      seed = {
        origins: existingBlock.options.origins || [],
        allowAllOrigins: existingBlock.options.allowAllOrigins === true,
        php: existingBlock.options.php,
      };
    }

    const project = await upsertProject(
      targetDomain,
      {
        root: rootCheck.path,
        originsFromFlags,
        originsToRemove,
        allowAllOriginsFlag,
        phpFlag,
        isNew,
        seed,
      },
      projectsPath
    );

    const newBlock = renderSiteBlock(targetDomain, rootCheck.path, {
      allowAllOrigins: project.allowAllOrigins,
      origins: project.origins,
      php: isPhpEnabled(project.php),
      devPort: project.devPort,
    });

    content = upsertBlock(content, targetDomain, newBlock);
    await fs.writeFile(caddyFilePath, `${content.trim()}\n`, 'utf-8');

    if (project.allowAllOrigins) {
      spinner.stop();
      log(
        chalk.yellow(
          '   Warning: allow-all-origins is enabled (Access-Control-Allow-Origin: *). Prefer --origin <live-domain> then --no-allow-all-origins.'
        )
      );
      spinner.start(`Linking ${chalk.bold(targetDomain)}...`);
    } else if (
      !project.origins.some(
        (o) => o.endsWith('.webflow.io') || o.endsWith('.webflow.com') || isBroadWebflowWildcard(o)
      )
    ) {
      spinner.stop();
      log(
        chalk.dim(
          '   Tip: Webflow is not in the default CORS allowlist. Add staging/live with `stagepass link --origin my-project.webflow.io` (or an explicit `*.webflow.io` with caution).'
        )
      );
      spinner.start(`Linking ${chalk.bold(targetDomain)}...`);
    }
  } catch (e) {
    spinner.fail('Failed to write config.');
    if (options.verbose) error(e);
    else if (e && e.message) log(chalk.dim(`   ${e.message}`));
    return 1;
  }

  try {
    const stdioMode = options.verbose ? 'inherit' : 'ignore';
    await execa('caddy', ['reload', '--config', caddyFilePath], { stdio: stdioMode });
    spinner.succeed(`Linked: https://${targetDomain} -> ${rootCheck.path}`);
    return 0;
  } catch (err) {
    spinner.warn('Config written, but Caddy reload failed.');
    log(chalk.dim('   Is Stagepass running? Try: stagepass start'));
    if (options.verbose) error(err);
    return 0;
  }
}
