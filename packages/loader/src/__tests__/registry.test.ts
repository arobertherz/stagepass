import { describe, expect, it, vi } from 'vitest';
import { createModuleRegistry, majorFromVersion } from '../registry.js';

describe('majorFromVersion', () => {
  it('parses major versions', () => {
    expect(majorFromVersion('2.1.0')).toBe(2);
    expect(majorFromVersion('2')).toBe(2);
    expect(majorFromVersion(' 3.0.0 ')).toBe(3);
  });

  it('returns null for invalid input', () => {
    expect(majorFromVersion('')).toBeNull();
    expect(majorFromVersion('x.y.z')).toBeNull();
  });
});

describe('createModuleRegistry', () => {
  it('registers matching majors', () => {
    const warn = vi.fn();
    const { use, registered } = createModuleRegistry('2.0.0', warn);
    const api: Record<string, unknown> = {};
    const ok = use('cookies', '2.1.0', (a) => {
      a.cookies = { ok: true };
    }, api);
    expect(ok).toBe(true);
    expect(api.cookies).toEqual({ ok: true });
    expect(registered.get('cookies')).toBe('2.1.0');
    expect(warn).not.toHaveBeenCalled();
  });

  it('rejects mismatched majors', () => {
    const warn = vi.fn();
    const { use } = createModuleRegistry('2.0.0', warn);
    const api: Record<string, unknown> = {};
    const ok = use('cookies', '3.0.0', () => {}, api);
    expect(ok).toBe(false);
    expect(warn).toHaveBeenCalled();
  });
});
