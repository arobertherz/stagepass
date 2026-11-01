/** Env var that skips the macOS-only guard (tests/CI only). */
export const SKIP_PLATFORM_CHECK_ENV = 'STAGEPASS_SKIP_PLATFORM_CHECK';

/**
 * @param {string} [platform=process.platform]
 * @returns {boolean}
 */
export function isMacOS(platform = process.platform) {
  return platform === 'darwin';
}

/**
 * Build the user-facing unsupported-platform message.
 * @param {string} platform
 * @returns {string}
 */
export function unsupportedPlatformMessage(platform) {
  return `Stagepass CLI supports macOS only (detected: ${platform}).`;
}

/**
 * Exit with a clear error when running system commands off macOS.
 * No-op when `STAGEPASS_SKIP_PLATFORM_CHECK=1` (tests/CI only) or on darwin.
 *
 * @param {object} [options]
 * @param {string} [options.platform]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {(code: number) => void} [options.exit]
 * @param {(msg: string) => void} [options.write]
 */
export function assertSupportedPlatform(options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const exit = options.exit ?? ((code) => process.exit(code));
  const write = options.write ?? ((msg) => console.error(msg));

  if (env[SKIP_PLATFORM_CHECK_ENV] === '1') {
    return;
  }

  if (isMacOS(platform)) {
    return;
  }

  write(unsupportedPlatformMessage(platform));
  exit(1);
}
