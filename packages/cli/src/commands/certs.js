import chalk from 'chalk';
import { confirm as defaultConfirmPrompt } from '../lib/prompts.js';
import { defaultExec } from '../lib/exec.js';
import { loadProjects } from '../lib/projects.js';
import { getProjectsPath, getCaddyfilePath } from '../lib/paths.js';
import {
  runCertsCheck,
  assertReadOnlyCertOps,
  assertDestructiveCertOpAllowed,
  domainsNeedingSiteCertRenewal,
  renewSiteCertificates,
  moveLocalCaAuthorityToBackup,
  deleteKeychainCertificateBySha1,
  normalizeSha1Fingerprint,
} from '../lib/certs.js';

/**
 * @param {object} [options]
 * @returns {(message: string, opts?: { default?: boolean }) => Promise<boolean>}
 */
function resolveConfirm(options = {}) {
  if (typeof options.confirm === 'function') return options.confirm;
  // Legacy injectable: options.prompt([{ type: 'confirm', name, message, default }])
  if (typeof options.prompt === 'function') {
    return async (message, opts = {}) => {
      const answers = await options.prompt([
        {
          type: 'confirm',
          name: 'ok',
          message,
          default: opts.default === true,
        },
      ]);
      return answers?.ok === true;
    };
  }
  return (message, opts = {}) =>
    defaultConfirmPrompt(message, { default: opts.default === true });
}

/**
 * Resolve Homebrew prefix the same way doctor does (`brew --prefix`, failure tolerated).
 * @param {import('../lib/exec.js').ExecFn} exec
 * @returns {Promise<string|null>}
 */
export async function resolveBrewPrefix(exec) {
  try {
    const { stdout } = await exec('brew', ['--prefix']);
    const prefix = String(stdout || '').trim();
    return prefix || null;
  } catch {
    return null;
  }
}

/**
 * Read-only certificate report.
 * @param {object} [options]
 * @param {boolean} [options.json]
 * @param {boolean} [options.verbose]
 * @param {boolean} [options.skipHandshake]
 * @returns {Promise<number>}
 */
export async function certsCheck(options = {}) {
  assertReadOnlyCertOps();

  const exec = options.exec || defaultExec;
  const projectsPath = getProjectsPath();
  const doc = await loadProjects(projectsPath);
  const domains = Object.keys(doc.projects || {});
  const brewPrefix =
    options.brewPrefix !== undefined
      ? options.brewPrefix
      : await resolveBrewPrefix(exec);

  const report = await runCertsCheck({
    exec,
    domains: options.skipHandshake ? [] : domains,
    skipHandshake: options.skipHandshake === true,
    brewPrefix,
  });

  let exitCode = 0;
  if (report.root.status === 'fail') exitCode = 1;
  if (report.trust && !report.trust.trusted) exitCode = 1;
  for (const hs of report.handshakes || []) {
    if (hs.status === 'fail') exitCode = 1;
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          ok: exitCode === 0,
          root: {
            status: report.root.status,
            path: report.root.path,
            reason: report.root.reason,
            fingerprint256: report.root.fingerprint256,
            daysRemaining: report.root.validity?.daysRemaining ?? null,
          },
          trust: {
            trusted: Boolean(report.trust?.trusted),
            error: report.trust?.error || null,
            orphans: report.orphans || [],
          },
          secondaryRoots: report.secondaryRoots || [],
          handshakes: report.handshakes || [],
        },
        null,
        2
      )
    );
    return exitCode;
  }

  console.log(chalk.bold('\nStagepass certs check\n'));

  const rootTag =
    report.root.status === 'ok'
      ? chalk.green('ok')
      : report.root.status === 'warn'
        ? chalk.yellow('warn')
        : chalk.red('fail');
  console.log(`[${rootTag}] Root CA: ${report.root.reason}`);
  console.log(chalk.dim(`       ${report.root.path}`));
  if (report.root.fingerprint256) {
    console.log(chalk.dim(`       SHA-256 ${report.root.fingerprint256}`));
  }

  if (report.trust?.trusted) {
    console.log(`[${chalk.green('ok')}] System keychain trusts this root`);
  } else {
    console.log(
      `[${chalk.red('fail')}] System keychain does not trust this root`
    );
    if (report.trust?.error) {
      console.log(chalk.dim(`       ${report.trust.error}`));
    }
    console.log(chalk.dim('       Fix: stagepass certs trust'));
  }

  if (report.orphans?.length) {
    console.log(
      `[${chalk.yellow('warn')}] Orphaned Caddy roots in keychain (list only; remove via certs renew --remove-orphans):`
    );
    for (const orphan of report.orphans) {
      console.log(
        chalk.dim(
          `       SHA-1 ${orphan.sha1 || 'unknown'}  SHA-256 ${orphan.sha256}`
        )
      );
    }
  } else {
    console.log(`[${chalk.green('ok')}] No orphaned Caddy roots reported`);
  }

  for (const secondary of report.secondaryRoots || []) {
    console.log(`[${chalk.yellow('warn')}] ${secondary.note}`);
    console.log(chalk.dim(`       ${secondary.path}`));
  }

  if ((report.handshakes || []).length === 0) {
    console.log(chalk.dim('TLS handshake: skipped (no linked domains or --skip-handshake)'));
  } else {
    for (const hs of report.handshakes) {
      const tag =
        hs.status === 'ok'
          ? chalk.green('ok')
          : hs.status === 'warn'
            ? chalk.yellow('warn')
            : hs.status === 'skip'
              ? chalk.dim('not checkable')
              : chalk.red('fail');
      console.log(`[${tag}] TLS ${hs.servername}: ${hs.reason}`);
    }
  }

  console.log(chalk.bold(`\nExit ${exitCode}`));
  return exitCode;
}

/**
 * Run `caddy trust` after explicit confirmation (or --yes).
 * @param {object} [options]
 * @param {boolean} [options.yes]
 * @param {boolean} [options.verbose]
 * @param {import('../lib/exec.js').ExecFn} [options.exec]
 * @param {(q: object[]) => Promise<object>} [options.prompt]
 * @param {(message: string, opts?: object) => Promise<boolean>} [options.confirm]
 * @returns {Promise<number>}
 */
export async function certsTrust(options = {}) {
  assertReadOnlyCertOps();
  const exec = options.exec || defaultExec;
  const confirm = resolveConfirm(options);

  let confirmed = options.yes === true;
  if (!confirmed) {
    const canPrompt =
      typeof options.confirm === 'function' ||
      typeof options.prompt === 'function' ||
      process.stdin.isTTY;
    if (!canPrompt) {
      console.log(
        chalk.red(
          'certs trust requires interactive confirmation or --yes (refusing non-TTY without --yes).'
        )
      );
      return 1;
    }
    confirmed = await confirm(
      'Install/trust the Caddy local root CA in the System keychain via `caddy trust`?',
      { default: false }
    );
  }

  if (!confirmed) {
    console.log(chalk.dim('Cancelled.'));
    return 1;
  }

  try {
    // caddy trust may prompt for an admin password; always inherit stdio.
    await exec('caddy', ['trust'], { stdio: 'inherit' });
    console.log(chalk.green('caddy trust completed.'));
    console.log(
      chalk.dim(
        'Re-check with: stagepass certs check (restart browsers if needed)'
      )
    );
    return 0;
  } catch (error) {
    console.log(chalk.red('caddy trust failed.'));
    console.log(
      chalk.dim(error instanceof Error ? error.message : String(error))
    );
    return 1;
  }
}

/**
 * Repair certificates: site dirs, optional root move, optional orphan SHA-1 deletes.
 *
 * @param {object} [options]
 * @param {boolean} [options.root]
 * @param {boolean} [options.removeOrphans]
 * @param {boolean} [options.yes]
 * @param {boolean} [options.iUnderstandRootRenewal]
 * @param {boolean} [options.verbose]
 * @param {import('../lib/exec.js').ExecFn} [options.exec]
 * @param {(message: string, opts?: object) => Promise<boolean>} [options.confirm]
 * @param {(q: object[]) => Promise<object>} [options.prompt]
 * @param {typeof runCertsCheck} [options.runCheck]
 * @returns {Promise<number>}
 */
export async function certsRenew(options = {}) {
  const exec = options.exec || defaultExec;
  const confirm = resolveConfirm(options);
  const runCheck = options.runCheck || runCertsCheck;
  const projectsPath = options.projectsPath || getProjectsPath();
  const doc = await (options.loadProjects || loadProjects)(projectsPath);
  const linkedDomains = Object.keys(doc.projects || {});

  const canPrompt =
    typeof options.confirm === 'function' ||
    typeof options.prompt === 'function' ||
    process.stdin.isTTY;

  // --- root renewal (move CA folder) ---
  if (options.root === true) {
    if (options.removeOrphans === true) {
      console.log(
        chalk.red(
          'certs renew --root cannot be combined with --remove-orphans. Run them as separate commands.'
        )
      );
      return 1;
    }

    assertDestructiveCertOpAllowed('renewRootMoveBackup');

    let confirmed = false;
    if (
      options.yes === true &&
      options.iUnderstandRootRenewal === true
    ) {
      confirmed = true;
    } else if (options.yes === true) {
      // AC-15: --yes alone always aborts (TTY or not); need the explicit flag too.
      console.log(
        chalk.red(
          'certs renew --root with --yes also requires --i-understand-root-renewal. Or omit --yes for two interactive confirmations.'
        )
      );
      return 1;
    } else if (!canPrompt) {
      console.log(
        chalk.red(
          'certs renew --root requires two interactive confirmations, or --yes --i-understand-root-renewal.'
        )
      );
      return 1;
    } else {
      const first = await confirm(
        'Move the Caddy local CA folder to a timestamped backup? Browsers will need `stagepass certs trust` afterwards.',
        { default: false }
      );
      if (!first) {
        console.log(chalk.dim('Cancelled.'));
        return 1;
      }
      const second = await confirm(
        'Confirm again: Stagepass will MOVE (not delete) pki/authorities/local. Continue?',
        { default: false }
      );
      confirmed = second === true;
    }

    if (!confirmed) {
      console.log(chalk.dim('Cancelled.'));
      return 1;
    }

    const moved = await (options.moveLocalCaAuthorityToBackup ||
      moveLocalCaAuthorityToBackup)({
      authorityDir: options.authorityDir,
      now: options.now,
      move: options.move,
      pathExists: options.pathExists,
      lstat: options.lstat,
    });

    if (!moved.ok) {
      console.log(chalk.red(`Root renew failed: ${moved.error}`));
      return 1;
    }

    console.log(chalk.green('Local CA folder moved to backup.'));
    console.log(chalk.dim(`   From: ${moved.authorityDir}`));
    console.log(chalk.dim(`   To:   ${moved.backupDir}`));
    console.log(
      chalk.yellow(
        'Next: start or reload Caddy so it regenerates a CA, then run `stagepass certs trust`.'
      )
    );
    return 0;
  }

  // --- orphan keychain removal by SHA-1 ---
  if (options.removeOrphans === true) {
    assertDestructiveCertOpAllowed('deleteKeychainItemBySha1');

    const brewPrefix =
      options.brewPrefix !== undefined
        ? options.brewPrefix
        : await resolveBrewPrefix(exec);

    const report = await runCheck({
      exec,
      domains: [],
      skipHandshake: true,
      rootPath: options.rootPath,
      keychainPath: options.keychainPath,
      pathExists: options.pathExists,
      readFile: options.readFile,
      brewPrefix,
    });
    const orphans = report.orphans || [];
    if (orphans.length === 0) {
      console.log(chalk.green('No orphaned Caddy roots to remove.'));
      return 0;
    }

    console.log(
      chalk.bold(
        `\nRemoving ${orphans.length} orphaned Caddy root(s) by SHA-1 (never by CN):\n`
      )
    );

    let removed = 0;
    for (const orphan of orphans) {
      const normalized = normalizeSha1Fingerprint(orphan.sha1 || '');
      if (!normalized.ok) {
        console.log(
          chalk.yellow(
            `Skipping orphan without valid SHA-1 (SHA-256 ${orphan.sha256 || '?'}).`
          )
        );
        continue;
      }

      let ok = options.yes === true;
      if (!ok) {
        if (!canPrompt) {
          console.log(
            chalk.red(
              'certs renew --remove-orphans requires interactive confirmation per certificate or --yes.'
            )
          );
          return 1;
        }
        ok = await confirm(
          `Delete keychain certificate SHA-1 ${normalized.sha1}?`,
          { default: false }
        );
      }
      if (!ok) {
        console.log(chalk.dim(`Skipped ${normalized.sha1}`));
        continue;
      }

      // System keychain deletes typically need sudo; warm only when acting.
      if (options.skipSudo !== true) {
        try {
          await exec('sudo', ['-v'], { stdio: 'inherit' });
        } catch {
          console.log(chalk.red('sudo required to delete System keychain items.'));
          return 1;
        }
      }

      const result = await (options.deleteKeychainCertificateBySha1 ||
        deleteKeychainCertificateBySha1)({
        sha1: normalized.sha1,
        exec,
        keychainPath: options.keychainPath,
      });
      if (!result.ok) {
        console.log(
          chalk.red(`Failed to delete ${normalized.sha1}: ${result.error}`)
        );
        return 1;
      }
      console.log(chalk.green(`Deleted SHA-1 ${normalized.sha1}`));
      console.log(chalk.dim(`   security ${result.args.join(' ')}`));
      removed += 1;
    }

    console.log(chalk.bold(`\nRemoved ${removed} orphan(s).`));
    return 0;
  }

  // --- default: site certificate repair for failing linked domains ---
  assertDestructiveCertOpAllowed('renewSiteCertDir');

  if (linkedDomains.length === 0) {
    console.log(chalk.yellow('No linked .sp domains; nothing to renew.'));
    return 0;
  }

  const report = await runCheck({
    exec,
    domains: linkedDomains,
    skipHandshake: false,
    rootPath: options.rootPath,
    keychainPath: options.keychainPath,
    pathExists: options.pathExists,
    readFile: options.readFile,
    connect: options.connect,
    handshakeHost: options.handshakeHost,
    handshakePort: options.handshakePort,
    handshakeTimeoutMs: options.handshakeTimeoutMs,
  });

  const needing = domainsNeedingSiteCertRenewal(report.handshakes || []);
  if (needing.length === 0) {
    console.log(
      chalk.green(
        'No failing site/intermediate certificates detected for linked domains.'
      )
    );
    if (report.root.status === 'fail') {
      console.log(
        chalk.dim(
          'Root CA looks broken; use `stagepass certs renew --root` (double confirmation).'
        )
      );
    }
    return 0;
  }

  console.log(
    chalk.yellow(
      `\nFailing TLS for: ${needing.join(', ')}\nScoped delete of certificates/local/<domain> then caddy reload.\n`
    )
  );

  let confirmed = options.yes === true;
  if (!confirmed) {
    if (!canPrompt) {
      console.log(
        chalk.red(
          'certs renew requires interactive confirmation or --yes (refusing non-TTY without --yes).'
        )
      );
      return 1;
    }
    confirmed = await confirm(
      `Delete on-disk site cert dirs for ${needing.join(', ')} and reload Caddy?`,
      { default: false }
    );
  }
  if (!confirmed) {
    console.log(chalk.dim('Cancelled.'));
    return 1;
  }

  const result = await (options.renewSiteCertificates || renewSiteCertificates)({
    domains: needing,
    linkedDomains,
    exec,
    certificatesLocalDir: options.certificatesLocalDir,
    caddyfilePath: options.caddyfilePath || getCaddyfilePath(),
    remove: options.remove,
    lstat: options.lstat,
    pathExists: options.pathExists,
  });

  for (const d of result.deleted) {
    console.log(chalk.green(`Removed ${d.dir}`));
  }
  for (const err of result.errors) {
    console.log(chalk.red(`${err.domain}: ${err.error}`));
  }
  if (result.deleted.length > 0) {
    if (result.reloaded) {
      console.log(chalk.green('caddy reload completed.'));
    } else if (result.reloadDeferred) {
      console.log(
        chalk.yellow('Caddy is not running; certs issue on next `stagepass start`.')
      );
    } else {
      console.log(
        chalk.red(`caddy reload failed: ${result.reloadError || 'unknown error'}`)
      );
      return 1;
    }
  }
  return result.errors.length > 0 && result.deleted.length === 0 ? 1 : 0;
}
