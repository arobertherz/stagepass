import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { execa } from 'execa';
import ora from 'ora';
import { resolveLinkDomain } from '../lib/domain.js';
import { renderSiteBlock, upsertBlock, parseBlocks } from '../lib/caddyfile.js';
import {
  validateRoot,
  getCaddyfilePath,
  getStagepassDir,
  getProjectsPath,
} from '../lib/paths.js';
import { upsertProject, getProject } from '../lib/projects.js';
import { validateOriginList } from '../lib/origins.js';
import { ensureCaddyfileMigrated } from '../lib/migrate.js';

/**
 * @param {string|undefined} domain
 * @param {object} options
 * @param {boolean} [options.verbose]
 * @param {string[]} [options.origin]
 * @param {string[]} [options.removeOrigin]
 * @param {boolean} [options.allowAllOrigins]
 */
export async function link(domain, options = {}) {
  const currentDir = process.cwd();
  const folderName = path.basename(currentDir);

  const resolved = resolveLinkDomain(domain, folderName);
  if (!resolved.ok) {
    console.log(chalk.red(`❌ ${resolved.error}`));
    return;
  }

  const targetDomain = resolved.domain;
  const rootCheck = validateRoot(currentDir);
  if (!rootCheck.ok) {
    console.log(chalk.red(`❌ ${rootCheck.error}`));
    return;
  }

  const originsFromFlags = options.origin || [];
  if (originsFromFlags.length > 0) {
    const check = validateOriginList(originsFromFlags);
    if (!check.ok) {
      console.log(chalk.red(`❌ Invalid --origin: ${check.error}`));
      return;
    }
  }

  const originsToRemove = options.removeOrigin || [];
  if (originsToRemove.length > 0) {
    const check = validateOriginList(originsToRemove);
    if (!check.ok) {
      console.log(chalk.red(`❌ Invalid --remove-origin: ${check.error}`));
      return;
    }
  }

  let allowAllOriginsFlag;
  if (options.allowAllOrigins === true) allowAllOriginsFlag = true;
  else if (options.allowAllOrigins === false) allowAllOriginsFlag = false;
  else allowAllOriginsFlag = undefined;

  const caddyDir = getStagepassDir();
  const caddyFilePath = getCaddyfilePath();
  const projectsPath = getProjectsPath();

  if (resolved.slugged) {
    console.log(
      chalk.dim(
        `Folder name was not a valid domain; using ${chalk.bold(targetDomain)}`
      )
    );
  }

  const spinner = ora(`Linking ${chalk.bold(targetDomain)}...`).start();

  try {
    await fs.ensureDir(caddyDir);

    spinner.stop();
    await ensureCaddyfileMigrated({ caddyfilePath: caddyFilePath, projectsPath });
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
      };
    }

    const project = await upsertProject(
      targetDomain,
      {
        root: rootCheck.path,
        originsFromFlags,
        originsToRemove,
        allowAllOriginsFlag,
        isNew,
        seed,
      },
      projectsPath
    );

    const newBlock = renderSiteBlock(targetDomain, rootCheck.path, {
      allowAllOrigins: project.allowAllOrigins,
      origins: project.origins,
    });

    content = upsertBlock(content, targetDomain, newBlock);
    await fs.writeFile(caddyFilePath, `${content.trim()}\n`, 'utf-8');

    if (project.allowAllOrigins) {
      spinner.stop();
      console.log(
        chalk.yellow(
          '   Warning: allow-all-origins is enabled (Access-Control-Allow-Origin: *). Prefer --origin <live-domain> then --no-allow-all-origins.'
        )
      );
      spinner.start(`Linking ${chalk.bold(targetDomain)}...`);
    }
  } catch (e) {
    spinner.fail('Failed to write config.');
    if (options.verbose) console.error(e);
    else if (e && e.message) console.log(chalk.dim(`   ${e.message}`));
    return;
  }

  try {
    const stdioMode = options.verbose ? 'inherit' : 'ignore';
    await execa('caddy', ['reload', '--config', caddyFilePath], { stdio: stdioMode });
    spinner.succeed(`Linked: https://${targetDomain} -> ${rootCheck.path}`);
  } catch (error) {
    spinner.warn('Config written, but Caddy reload failed.');
    console.log(chalk.dim('   Is Stagepass running? Try: stagepass start'));
    if (options.verbose) console.error(error);
  }
}
