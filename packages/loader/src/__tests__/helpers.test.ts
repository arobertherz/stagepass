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
  it('exposes the stable client shape without reading storage accessors', () => {
    const client = getClientInfo();
    expect(client).toHaveProperty('theme');
    expect(client).toHaveProperty('browser');
    expect(client).toHaveProperty('os');
    expect(client).toHaveProperty('device');
    expect(client).toHaveProperty('viewport');
    expect(client).toHaveProperty('locale');

    const caps = client.capabilities;
    expect(Object.keys(caps).sort()).toEqual([
      'cookiesEnabled',
      'localStorage',
      'sessionStorage',
    ]);
    expect(typeof caps.cookiesEnabled).toBe('boolean');
    for (const key of ['localStorage', 'sessionStorage'] as const) {
      const desc = Object.getOwnPropertyDescriptor(caps, key);
      expect(typeof desc?.get).toBe('function');
      expect(desc?.set).toBeUndefined();
    }
    expect(Object.prototype.hasOwnProperty.call(caps, 'serviceWorker')).toBe(false);
  });

  it('reports storage capabilities as booleans when the accessors are read', () => {
    const caps = getClientInfo().capabilities;
    expect(caps.localStorage).toEqual(expect.any(Boolean));
    expect(caps.sessionStorage).toEqual(expect.any(Boolean));
  });
});
