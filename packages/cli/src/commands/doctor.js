import chalk from 'chalk';
import { runDoctor } from '../lib/doctor.js';

/**
 * @param {object} [options]
 * @param {boolean} [options.json]
 * @param {boolean} [options.verbose]
 * @returns {Promise<number>} exit code
 */
export async function doctor(options = {}) {
  const result = await runDoctor({
    skipHandshake: options.skipHandshake === true,
    skipSite: options.skipSite === true,
  });

  if (options.json) {
    const payload = {
      ok: result.exitCode === 0,
      summary: result.summary,
      checks: result.checks,
      hints: result.hints,
    };
    console.log(JSON.stringify(payload, null, 2));
    return result.exitCode;
  }

  console.log(chalk.bold('\nStagepass doctor\n'));

  for (const item of result.checks) {
    const tag =
      item.status === 'ok'
        ? chalk.green('ok')
        : item.status === 'warn'
          ? chalk.yellow('warn')
          : item.status === 'fail'
            ? chalk.red('fail')
            : chalk.cyan(item.status);
    console.log(`[${tag}] ${item.message}`);
    if (item.detail && (options.verbose || item.status !== 'ok')) {
      console.log(chalk.dim(`       ${item.detail}`));
    }
  }

  console.log('');
  for (const hint of result.hints) {
    console.log(chalk.cyan(`hint: ${hint}`));
  }

  const { ok, warn, fail } = result.summary;
  console.log(
    chalk.bold(
      `\nSummary: ${ok} ok, ${warn} warn, ${fail} fail (exit ${result.exitCode})`
    )
  );

  return result.exitCode;
}
