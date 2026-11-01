/**
 * Reject git remotes that embed credentials (user:pass@, tokens as userinfo).
 * SSH remotes like git@github.com:org/repo.git are allowed.
 *
 * @param {unknown} remote
 * @returns {{ ok: true, remote: string } | { ok: false, error: string }}
 */
export function validateGitRemote(remote) {
  if (remote === undefined || remote === null || remote === '') {
    return { ok: true, remote: '' };
  }

  if (typeof remote !== 'string') {
    return { ok: false, error: 'Git remote must be a string URL.' };
  }

  const value = remote.trim();
  if (!value) {
    return { ok: true, remote: '' };
  }

  // HTTPS/HTTP/git+http(s) with userinfo
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      if (parsed.username || parsed.password) {
        return {
          ok: false,
          error:
            'Git remote must not contain credentials (user:pass@ or tokens in the URL). Use SSH or a credential helper instead.',
        };
      }
    } catch {
      return { ok: false, error: 'Git remote URL is invalid.' };
    }

    // Belt-and-suspenders: userinfo before host
    if (/:\/\/[^/@]+@/.test(value)) {
      return {
        ok: false,
        error:
          'Git remote must not contain credentials (user:pass@ or tokens in the URL). Use SSH or a credential helper instead.',
      };
    }

    return { ok: true, remote: value };
  }

  // SCP-like SSH: git@host:path (no password embed)
  if (/^[^/@]+@[^:]+:/.test(value)) {
    // Reject git:token@host style mistaken as SSH
    if (/^[^/@]+:[^/@]+@/.test(value)) {
      return {
        ok: false,
        error:
          'Git remote must not contain credentials (user:pass@ or tokens in the URL). Use SSH or a credential helper instead.',
      };
    }
    return { ok: true, remote: value };
  }

  return { ok: true, remote: value };
}
