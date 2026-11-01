import { describe, it, expect } from 'vitest';
import { validateGitRemote } from '../remote-url.js';

describe('validateGitRemote', () => {
  it('allows empty, HTTPS without creds, and SSH', () => {
    expect(validateGitRemote('').ok).toBe(true);
    expect(validateGitRemote('https://github.com/org/repo.git').ok).toBe(true);
    expect(validateGitRemote('git@github.com:org/repo.git').ok).toBe(true);
  });

  it('rejects user:pass and token userinfo', () => {
    expect(
      validateGitRemote('https://user:pass@github.com/org/repo.git').ok
    ).toBe(false);
    expect(
      validateGitRemote('https://ghp_notarealtoken@github.com/org/repo.git').ok
    ).toBe(false);
    expect(
      validateGitRemote(
        'https://x-access-token:abc123@github.com/org/repo.git'
      ).ok
    ).toBe(false);
  });
});
