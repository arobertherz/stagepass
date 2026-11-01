import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queryLoopbackPermission, lnaHintMessage } from '../lna.js';

describe('queryLoopbackPermission', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns unknown when permissions API is missing', async () => {
    vi.stubGlobal('navigator', {});
    expect(await queryLoopbackPermission()).toBe('unknown');
  });

  it('returns loopback-network state when available', async () => {
    const query = vi.fn().mockResolvedValue({ state: 'prompt' });
    vi.stubGlobal('navigator', { permissions: { query } });
    expect(await queryLoopbackPermission()).toBe('prompt');
    expect(query).toHaveBeenCalledWith({ name: 'loopback-network' });
  });

  it('falls back to local-network-access and ignores unknown names', async () => {
    const query = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('unknown'))
      .mockResolvedValueOnce({ state: 'denied' });
    vi.stubGlobal('navigator', { permissions: { query } });
    expect(await queryLoopbackPermission()).toBe('denied');
  });

  it('never throws when all queries fail', async () => {
    const query = vi.fn().mockRejectedValue(new Error('boom'));
    vi.stubGlobal('navigator', { permissions: { query } });
    expect(await queryLoopbackPermission()).toBe('unknown');
  });
});

describe('lnaHintMessage', () => {
  it('returns hints for prompt and denied only', () => {
    expect(lnaHintMessage('prompt')).toMatch(/Local network access/i);
    expect(lnaHintMessage('denied')).toMatch(/blocked/i);
    expect(lnaHintMessage('granted')).toBe(null);
    expect(lnaHintMessage('unknown')).toBe(null);
  });
});
