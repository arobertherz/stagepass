/**
 * Extract major version number from a semver-like string.
 *
 * @param version - e.g. `2.1.0`
 */
export function majorFromVersion(version: string): number | null {
  if (!version || typeof version !== 'string') return null;
  const m = version.trim().match(/^(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export type ModuleFactory = (api: Record<string, unknown>) => void;

/**
 * Create a module registry bound to a loader major version.
 *
 * @param loaderVersion - Loader package version
 * @param warn - Warning logger
 */
export function createModuleRegistry(
  loaderVersion: string,
  warn: (...args: unknown[]) => void
) {
  const loaderMajor = majorFromVersion(loaderVersion);
  const registered = new Map<string, string>();

  /**
   * Register a module factory after a major-version check.
   *
   * @param name - Module id (e.g. `cookies`)
   * @param version - Module package version
   * @param factory - Attaches APIs onto the runtime object
   * @param api - Stagepass runtime object
   */
  function use(
    name: string,
    version: string,
    factory: ModuleFactory,
    api: Record<string, unknown>
  ): boolean {
    if (!name || typeof name !== 'string') {
      warn('stagepass.use: invalid module name');
      return false;
    }
    const modMajor = majorFromVersion(version);
    if (loaderMajor == null || modMajor == null) {
      warn(`stagepass.use: cannot parse version for module "${name}"`);
      return false;
    }
    if (modMajor !== loaderMajor) {
      warn(
        `Module "${name}" major ${modMajor} does not match loader major ${loaderMajor}. Skipping.`
      );
      return false;
    }
    try {
      factory(api);
      registered.set(name, version);
      return true;
    } catch (err) {
      warn(`Module "${name}" failed to register:`, err);
      return false;
    }
  }

  return { use, registered };
}
