import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import {
  BLOCK_VERSION,
  formatBackupStamp,
  migrateLegacyContent,
  parseBlocks,
} from './caddyfile.js';
import { CADDY_UPGRADE_HINT, readCaddyVersion } from './caddy-version.js';
import { ensureMigratedProject } from './projects.js';
import { getCaddyfilePath, getProjectsPath } from './paths.js';

/**
 * Detect legacy blocks, backup once, rewrite, sync projects.json.
 * Idempotent: second run changes nothing and creates no backup.
 *
 * @param {object} [options]
 * @param {string} [options.caddyfilePath]
 * @param {string} [options.projectsPath]
 * @param {boolean} [options.silent]
 * @param {import('./exec.js').ExecFn} [options.exec]
 * @param {Awaited<ReturnType<typeof readCaddyVersion>>} [options.caddy]
 * @returns {Promise<{ changed: boolean, migrated: Array, skipped: Array, backupPath: string|null }>}
 */
export async function ensureCaddyfileMigrated(options = {}) {
  const caddyfilePath = options.caddyfilePath || getCaddyfilePath();
  const projectsPath = options.projectsPath || getProjectsPath();
  const silent = options.silent === true;

  if (!(await fs.pathExists(caddyfilePath))) {
    return { changed: false, migrated: [], upgraded: [], skipped: [], backupPath: null };
  }

  const original = await fs.readFile(caddyfilePath, 'utf-8');
  const caddy = options.caddy || (await readCaddyVersion(options.exec));
  const current = new RegExp(`# stagepass-block:\\s*${BLOCK_VERSION}\\b`);
  const stale = parseBlocks(original).some((block) => !current.test(block.full));
  if (caddy.known && !caddy.ok && stale) {
    if (!silent) {
      console.log(
        chalk.yellow(
          `   Caddy ${caddy.version} is older than 2.9, so existing site blocks were left unchanged. ${CADDY_UPGRADE_HINT}`
        )
      );
    }
    return { changed: false, migrated: [], upgraded: [], skipped: [], backupPath: null };
  }

  const result = migrateLegacyContent(original, {
    warn: silent
      ? () => {}
      : (msg) => console.log(chalk.yellow(`   ${msg}`)),
  });

  if (!result.changed) {
    return {
      changed: false,
      migrated: [],
      upgraded: [],
      skipped: result.skipped,
      backupPath: null,
    };
  }

  const backupPath = `${caddyfilePath}.bak-${formatBackupStamp()}`;
  await fs.copy(caddyfilePath, backupPath);
  await fs.writeFile(caddyfilePath, result.content, 'utf-8');

  for (const item of result.migrated) {
    await ensureMigratedProject(item.domain, item.root, projectsPath);
  }

  if (!silent && result.migrated.length > 0) {
    console.log(
      chalk.yellow(
        `   Migrated ${result.migrated.length} legacy Caddy block(s). Backup: ${path.basename(backupPath)}`
      )
    );
    for (const item of result.migrated) {
      console.log(chalk.dim(`   → ${item.domain} (allow-all-origins enabled for compatibility)`));
    }
    console.log(
      chalk.yellow(
        '   Tip: add your live domain with `stagepass link --origin example.com`, then `stagepass link --no-allow-all-origins`.'
      )
    );
  }
  if (!silent && result.upgraded.length > 0) {
    console.log(
      chalk.dim(
        `   Updated ${result.upgraded.length} Caddy block(s) to stagepass-block ${BLOCK_VERSION}.`
      )
    );
  }

  return {
    changed: true,
    migrated: result.migrated,
    upgraded: result.upgraded,
    skipped: result.skipped,
    backupPath,
  };
}

/**
 * Print a one-line security warning when any linked project uses allowAllOrigins.
 */
export async function warnIfAllowAllOriginsActive(options = {}) {
  const caddyfilePath = options.caddyfilePath || getCaddyfilePath();
  if (!(await fs.pathExists(caddyfilePath))) return;

  const content = await fs.readFile(caddyfilePath, 'utf-8');
  const blocks = parseBlocks(content);
  const open = blocks.filter((b) => !b.isLegacy && b.options.allowAllOrigins);
  if (open.length === 0) return;

  console.log(
    chalk.yellow(
      `   Warning: allow-all-origins is active for: ${open.map((b) => b.domain).join(', ')}`
    )
  );
}
