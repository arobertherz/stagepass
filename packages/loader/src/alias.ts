/**
 * Whether `name` is a valid JavaScript identifier (including `$` / `_`).
 *
 * @param name - Candidate global name
 */
export function isValidJsIdentifier(name: string): boolean {
  if (!name || typeof name !== 'string') return false;
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

/**
 * Whether a global property is free to assign (undefined on target).
 *
 * @param target - Global object (window / globalThis)
 * @param name - Property name
 */
export function isGlobalFree(target: object, name: string): boolean {
  try {
    return typeof (target as Record<string, unknown>)[name] === 'undefined';
  } catch (_) {
    return false;
  }
}
