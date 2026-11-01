import { describe, expect, it } from 'vitest';
import { canCapability, getClientInfo } from '../client.js';

describe('canCapability', () => {
  it('maps capability names to client flags', () => {
    const client = getClientInfo();
    expect(typeof canCapability(client, 'localStorage')).toBe('boolean');
    expect(typeof canCapability(client, 'sessionStorage')).toBe('boolean');
    expect(typeof canCapability(client, 'cookies')).toBe('boolean');
    expect(typeof canCapability(client, 'serviceWorker')).toBe('boolean');
    expect(canCapability(client, 'unknown-thing')).toBe(false);
  });
});

describe('getClientInfo shape', () => {
  it('exposes the stable client shape', () => {
    const client = getClientInfo();
    expect(client).toHaveProperty('theme');
    expect(client).toHaveProperty('browser');
    expect(client).toHaveProperty('os');
    expect(client).toHaveProperty('device');
    expect(client).toHaveProperty('viewport');
    expect(client).toHaveProperty('locale');
    expect(client.capabilities).toEqual(
      expect.objectContaining({
        cookiesEnabled: expect.any(Boolean),
        localStorage: expect.any(Boolean),
        sessionStorage: expect.any(Boolean),
      })
    );
    expect(client.capabilities).not.toHaveProperty('serviceWorker');
  });
});
