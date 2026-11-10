import { describe, it, expect, vi } from 'vitest';
import { certsTrust } from '../certs.js';

describe('certs trust', () => {
  it('refuses without confirmation', async () => {
    const exec = vi.fn();
    const code = await certsTrust({
      yes: false,
      prompt: async () => ({ ok: false }),
      exec,
    });
    expect(code).toBe(1);
    expect(exec).not.toHaveBeenCalled();
  });

  it('runs caddy trust only after --yes', async () => {
    const exec = vi.fn(async () => ({ stdout: '', stderr: '', code: 0 }));
    const code = await certsTrust({ yes: true, exec });
    expect(code).toBe(0);
    expect(exec).toHaveBeenCalledWith('caddy', ['trust'], {
      stdio: 'inherit',
    });
  });

  it('runs caddy trust after interactive yes', async () => {
    const exec = vi.fn(async () => ({ stdout: '', stderr: '', code: 0 }));
    const code = await certsTrust({
      yes: false,
      prompt: async () => ({ ok: true }),
      exec,
    });
    expect(code).toBe(0);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  // Mutant: catch path `return 1` -> `return undefined` must stay a hard failure.
  it('returns exit code 1 (not undefined) when caddy trust throws', async () => {
    const code = await certsTrust({
      yes: true,
      exec: async () => {
        throw new Error('trust denied');
      },
    });
    expect(code).toBe(1);
    expect(code).not.toBeUndefined();
  });
});
