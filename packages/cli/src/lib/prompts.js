import { confirm as defaultConfirm } from '@inquirer/prompts';

/**
 * Confirm prompt (defaults to `@inquirer/prompts` confirm).
 * Injectable for unit tests.
 *
 * @param {string} message
 * @param {object} [options]
 * @param {boolean} [options.default]
 * @param {(opts: { message: string, default?: boolean }) => Promise<boolean>} [options.confirm]
 * @returns {Promise<boolean>}
 */
export async function confirm(message, options = {}) {
  const confirmFn = options.confirm || defaultConfirm;
  return confirmFn({
    message: String(message || ''),
    default: options.default === true,
  });
}
