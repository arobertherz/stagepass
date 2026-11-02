import { defaultExec } from './exec.js';

const DEFAULT_TITLE = 'Stagepass';
const MAX_TITLE = 80;
const MAX_BODY = 200;

/**
 * Truncate notification text for display.
 * @param {unknown} value
 * @param {number} max
 */
export function truncateNotifyText(value, max) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Build `osascript` argv so title/body are passed via AppleScript `argv`
 * (never interpolated into the script source).
 *
 * @param {string} title
 * @param {string} body
 * @returns {string[]}
 */
export function buildOsascriptNotificationArgs(title, body) {
  const safeTitle = truncateNotifyText(title || DEFAULT_TITLE, MAX_TITLE) || DEFAULT_TITLE;
  const safeBody = truncateNotifyText(body || '', MAX_BODY) || 'Stagepass reported a problem.';
  // argv items after -- are positional; script never embeds caller text.
  const script = [
    'on run argv',
    '  set theTitle to item 1 of argv',
    '  set theMessage to item 2 of argv',
    '  display notification theMessage with title theTitle',
    'end run',
  ].join('\n');
  return ['-e', script, '--', safeTitle, safeBody];
}

/**
 * Fire-and-forget macOS notification. Never throws; never blocks callers long.
 *
 * @param {object} opts
 * @param {string} [opts.title]
 * @param {string} opts.body
 * @param {import('./exec.js').ExecFn} [opts.exec]
 * @param {(ms: number) => Promise<void>} [opts.sleep]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<boolean>} true if the process exited 0
 */
export async function notifyMac(opts) {
  const exec = opts.exec || defaultExec;
  const timeoutMs = opts.timeoutMs ?? 3000;
  const args = buildOsascriptNotificationArgs(opts.title || DEFAULT_TITLE, opts.body);
  try {
    const run = exec('osascript', args, { timeout: timeoutMs });
    await run;
    return true;
  } catch {
    return false;
  }
}
