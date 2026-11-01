export type LnaState = 'granted' | 'prompt' | 'denied' | 'unknown';

/**
 * Query Chrome Local Network Access / loopback permission when available.
 * Tries `loopback-network` then `local-network-access`. Unknown names must not throw.
 * Missing API (Safari/Firefox) returns `unknown`.
 *
 * Note: do not rely on `local-network-access` on very old Chrome builds that may
 * crash the renderer; each query is wrapped in try/catch and failures are ignored.
 *
 * @returns Permission state or `unknown` when unsupported
 */
export async function queryLoopbackPermission(): Promise<LnaState> {
  const perms = typeof navigator !== 'undefined' ? navigator.permissions : undefined;
  if (!perms || typeof perms.query !== 'function') {
    return 'unknown';
  }

  const names = ['loopback-network', 'local-network-access'] as const;
  for (const name of names) {
    try {
      // Cast: PermissionName union may not include these yet in lib.dom
      const status = await perms.query({ name: name as PermissionName });
      const state = status && status.state;
      if (state === 'granted' || state === 'prompt' || state === 'denied') {
        return state;
      }
    } catch {
      // Unknown permission name or unsupported — try next
    }
  }
  return 'unknown';
}

/**
 * Human-readable hint for badge / console when LNA is not granted.
 *
 * @param state - Permission state
 */
export function lnaHintMessage(state: LnaState): string | null {
  if (state === 'prompt') {
    return 'Local network access is required. Allow local/loopback network access when Chrome prompts, then reload.';
  }
  if (state === 'denied') {
    return 'Local network access is blocked. Enable loopback/local network access for this site in Chrome settings, then reload.';
  }
  return null;
}
