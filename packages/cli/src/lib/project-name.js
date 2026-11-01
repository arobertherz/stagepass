/**
 * DNS-safe project name: lowercase a-z0-9 and hyphen, 1 to 63 chars,
 * no leading or trailing hyphen.
 */
const NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * @param {unknown} name
 * @returns {{ ok: true, name: string } | { ok: false, error: string }}
 */
export function validateProjectName(name) {
  if (typeof name !== 'string' || name.trim() === '') {
    return { ok: false, error: 'Project name is required.' };
  }

  const trimmed = name.trim();
  if (trimmed !== trimmed.toLowerCase()) {
    return {
      ok: false,
      error: 'Project name must be lowercase (a-z, 0-9, hyphen).',
    };
  }

  if (trimmed.length < 1 || trimmed.length > 63) {
    return {
      ok: false,
      error: 'Project name must be 1 to 63 characters.',
    };
  }

  if (trimmed.startsWith('-') || trimmed.endsWith('-')) {
    return {
      ok: false,
      error: 'Project name must not start or end with a hyphen.',
    };
  }

  if (!NAME_RE.test(trimmed)) {
    return {
      ok: false,
      error:
        'Project name must be DNS-safe: lowercase a-z, 0-9, and hyphens only.',
    };
  }

  return { ok: true, name: trimmed };
}
