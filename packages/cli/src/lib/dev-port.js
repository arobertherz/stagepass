/**
 * Validate and normalize the Stagepass live-reload event-server port.
 * Only integers in 1024..65535 may be written into a Caddyfile.
 */

/**
 * @param {unknown} port
 * @returns {port is number}
 */
export function isValidDevPort(port) {
  return (
    typeof port === 'number' &&
    Number.isInteger(port) &&
    port >= 1024 &&
    port <= 65535
  );
}

/**
 * Coerce a stored/unknown value to a valid port, or null.
 * @param {unknown} value
 * @returns {number|null}
 */
export function normalizeDevPort(value) {
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    value = Number(value);
  }
  return isValidDevPort(value) ? value : null;
}

/**
 * Whether a PID looks alive (best-effort; signal 0).
 * @param {unknown} pid
 * @returns {boolean}
 */
export function isPidAlive(pid) {
  const n = typeof pid === 'string' && /^\d+$/.test(pid) ? Number(pid) : pid;
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch {
    return false;
  }
}
