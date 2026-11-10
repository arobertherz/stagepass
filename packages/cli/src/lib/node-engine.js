/**
 * Early Node engine gate for the CLI bin.
 * Kept free of heavy deps so it can run before importing commander/inquirer.
 */

export const MIN_NODE_MAJOR = 20;
export const MIN_NODE_MINOR = 17;

/**
 * @param {string} [version] process.version-style (e.g. v20.10.0)
 * @returns {{ major: number, minor: number, patch: number } | null}
 */
export function parseNodeVersion(version = process.version) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(version || ''));
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/**
 * @param {string} [version]
 * @returns {boolean}
 */
export function meetsNodeEngine(version = process.version) {
  const parsed = parseNodeVersion(version);
  if (!parsed) return false;
  if (parsed.major > MIN_NODE_MAJOR) return true;
  if (parsed.major < MIN_NODE_MAJOR) return false;
  return parsed.minor >= MIN_NODE_MINOR;
}

/**
 * @param {string} [version]
 * @returns {string}
 */
export function unsupportedNodeMessage(version = process.version) {
  return (
    `@stagepass/cli requires Node.js >=${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}.0 ` +
    `(current: ${version}). Upgrade Node, or pin @stagepass/cli@2.2.7 on Node 18.`
  );
}

/**
 * @param {object} [opts]
 * @param {string} [opts.version]
 * @param {(msg: string) => void} [opts.write]
 * @param {(code: number) => void} [opts.exit]
 */
export function assertNodeEngine(opts = {}) {
  const version = opts.version || process.version;
  if (meetsNodeEngine(version)) return;
  const write = opts.write || ((msg) => console.error(msg));
  const exit = opts.exit || ((code) => process.exit(code));
  write(unsupportedNodeMessage(version));
  exit(1);
}
