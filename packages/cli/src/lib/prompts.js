import { confirm as defaultConfirm } from '@inquirer/prompts';

/**
 * Confirm prompt (defaults to `@inquirer/prompts` confirm).
 * Injectable for unit tests. Single choke point for every confirmation in
 * the CLI, so an abort here ends the process before any caller's own
 * try/catch can run: no stack trace, 130 for SIGINT, 1 for EOF/closed stdin.
 *
 * @param {string} message
 * @param {object} [options]
 * @param {boolean} [options.default]
 * @param {(opts: { message: string, default?: boolean }) => Promise<boolean>} [options.confirm]
 * @param {(code: number) => void} [options.exit]
 * @param {(msg: string) => void} [options.write]
 * @returns {Promise<boolean>}
 */
export async function confirm(message, options = {}) {
  const confirmFn = options.confirm || defaultConfirm;
  const exit = options.exit ?? ((code) => process.exit(code));
  const write = options.write ?? ((msg) => process.stderr.write(msg));
  // Byte 0x03 is a readline event, not a process signal (raw mode has ISIG
  // off). A real SIGINT is caught by signal-exit, which re-raises it and the
  // process dies before this await's catch runs. Handle that signal here,
  // synchronously, and only while a real prompt is on screen.
  const onSigInt = options.confirm
    ? null
    : () => {
        write('Aborted.\n');
        exit(130);
      };
  if (onSigInt) process.on('SIGINT', onSigInt);
  try {
    return await confirmFn({
      message: String(message || ''),
      default: options.default === true,
    });
  } catch (error) {
    if (error && error.name === 'ExitPromptError') {
      write('Aborted.\n');
      exit(/SIGINT/.test(String(error.message)) ? 130 : 1);
      return false;
    }
    throw error;
  } finally {
    if (onSigInt) process.off('SIGINT', onSigInt);
  }
}
