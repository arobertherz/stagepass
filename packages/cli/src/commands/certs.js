import chalk from 'chalk';
import inquirer from 'inquirer';
import { defaultExec } from '../lib/exec.js';
import { loadProjects } from '../lib/projects.js';
import { getProjectsPath } from '../lib/paths.js';
import { runCertsCheck, assertNoDestructiveCertOps } from '../lib/certs.js';

/**
 * Read-only certificate report.
 * @param {object} [options]
 * @param {boolean} [options.json]
 * @param {boolean} [options.verbose]
 * @param {boolean} [options.skipHandshake]
 * @returns {Promise<number>}
 */
export async function certsCheck(options = {}) {
  assertNoDestructiveCertOps();

  const projectsPath = getProjectsPath();
  const doc = await loadProjects(projectsPath);
  const domains = Object.keys(doc.projects || {});

  const report = await runCertsCheck({
    domains: options.skipHandshake ? [] : domains,
    skipHandshake: options.skipHandshake === true,
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
      `[${chalk.yellow('warn')}] Orphaned Caddy roots in keychain (report only; never deleted):`
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
 * @returns {Promise<number>}
 */
export async function certsTrust(options = {}) {
  assertNoDestructiveCertOps();
  const exec = options.exec || defaultExec;
  const prompt = options.prompt || ((questions) => inquirer.prompt(questions));

  let confirmed = options.yes === true;
  if (!confirmed) {
    const canPrompt = typeof options.prompt === 'function' || process.stdin.isTTY;
    if (!canPrompt) {
      console.log(
        chalk.red(
          'certs trust requires interactive confirmation or --yes (refusing non-TTY without --yes).'
        )
      );
      return 1;
    }
    const answers = await prompt([
      {
        type: 'confirm',
        name: 'ok',
        message:
          'Install/trust the Caddy local root CA in the System keychain via `caddy trust`?',
        default: false,
      },
    ]);
    confirmed = answers.ok === true;
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
