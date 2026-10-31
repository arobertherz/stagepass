/**
 * DNS label: 1–63 chars, [a-z0-9], hyphens only in the middle.
 */
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Characters that must never appear in a domain written into the Caddyfile. */
const UNSAFE_DOMAIN_RE = /[\s#"'{}$\\;()[\],=<>]/;

/**
 * Convert a folder name into a DNS-safe slug.
 * @param {string} name
 * @returns {string}
 */
export function slugifyFolderName(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

/**
 * Validate DNS labels for a hostname (without trailing .sp).
 * @param {string} host
 * @returns {boolean}
 */
export function isValidHostnameLabels(host) {
  if (!host || host.length > 243) return false;
  if (host.includes('..')) return false;
  const labels = host.split('.');
  if (labels.length === 0) return false;
  return labels.every((label) => LABEL_RE.test(label));
}

/**
 * Normalize and validate a Stagepass domain.
 * Accepts "foo", "foo.sp", "Foo.SP"; returns "foo.sp".
 *
 * @param {string} input
 * @returns {{ ok: true, domain: string } | { ok: false, error: string }}
 */
export function validateDomain(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    return { ok: false, error: 'Domain is empty.' };
  }

  let raw = input.trim().toLowerCase();

  // Strip accidental URL wrappers
  raw = raw.replace(/^https?:\/\//, '').replace(/\/+$/, '');

  if (UNSAFE_DOMAIN_RE.test(raw) || /[\x00-\x1f\x7f]/.test(raw)) {
    return {
      ok: false,
      error: 'Domain contains invalid characters (spaces, quotes, braces, #, etc.).',
    };
  }

  if (raw.endsWith('.sp')) {
    raw = raw.slice(0, -3);
  }

  if (!raw) {
    return { ok: false, error: 'Domain is empty after removing .sp suffix.' };
  }

  if (!isValidHostnameLabels(raw)) {
    return {
      ok: false,
      error:
        'Domain must use DNS-safe labels ([a-z0-9], inner hyphens, 1–63 chars per label).',
    };
  }

  const domain = `${raw}.sp`;
  if (domain.length > 253) {
    return { ok: false, error: 'Domain is too long.' };
  }

  return { ok: true, domain };
}

/**
 * Resolve the target .sp domain from an explicit argument or the folder name.
 * When derived from a folder and invalid, attempts to slugify.
 *
 * @param {string|undefined} domainArg
 * @param {string} folderName
 * @returns {{ ok: true, domain: string, slugged?: boolean, fromFolder?: boolean } | { ok: false, error: string }}
 */
export function resolveLinkDomain(domainArg, folderName) {
  if (domainArg !== undefined && domainArg !== null && String(domainArg).trim() !== '') {
    const result = validateDomain(String(domainArg));
    if (!result.ok) return result;
    return { ok: true, domain: result.domain, fromFolder: false };
  }

  const rawFolder = String(folderName || '');
  const direct = validateDomain(rawFolder);
  if (direct.ok) {
    return { ok: true, domain: direct.domain, fromFolder: true, slugged: false };
  }

  const slug = slugifyFolderName(rawFolder);
  if (!slug) {
    return {
      ok: false,
      error: `Folder name "${rawFolder}" cannot be converted to a valid .sp domain. Pass an explicit domain.`,
    };
  }

  const slugged = validateDomain(slug);
  if (!slugged.ok) {
    return {
      ok: false,
      error: `Could not derive a valid domain from folder "${rawFolder}".`,
    };
  }

  return { ok: true, domain: slugged.domain, fromFolder: true, slugged: true };
}

export function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
