export type StagepassEnvName = 'local' | 'staging' | 'production';

/**
 * Parse `data-stagepass-staging-hosts` (comma-separated hostnames).
 *
 * @param value - Attribute value
 */
export function parseStagingHosts(value: string | null | undefined): string[] {
  if (!value || typeof value !== 'string') return [];
  return value
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Runtime environment for flat helpers (`env()` / `is()`).
 * Independent of `vars.env` (which also treats localhost as local).
 *
 * - local: active swap session to a `.sp` domain
 * - staging: hostname ends with `.webflow.io` or matches stagingHosts
 * - production: otherwise
 *
 * @param hostname - Page hostname
 * @param swapDomain - Active swap domain, or null when not swapping
 * @param stagingHosts - Optional extra staging hostnames
 */
export function detectRuntimeEnv(
  hostname: string,
  swapDomain: string | null,
  stagingHosts: string[] = []
): StagepassEnvName {
  if (swapDomain && swapDomain.endsWith('.sp')) return 'local';
  const host = (hostname || '').toLowerCase();
  if (host.endsWith('.webflow.io')) return 'staging';
  if (stagingHosts.some((h) => h === host)) return 'staging';
  return 'production';
}
