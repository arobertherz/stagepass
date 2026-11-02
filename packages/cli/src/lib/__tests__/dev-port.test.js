import { describe, it, expect } from 'vitest';
import { isValidDevPort, normalizeDevPort, isPidAlive } from '../dev-port.js';

describe('dev-port', () => {
  it('accepts only integers 1024..65535', () => {
    expect(isValidDevPort(1024)).toBe(true);
    expect(isValidDevPort(65535)).toBe(true);
    expect(isValidDevPort(80)).toBe(false);
    expect(isValidDevPort(65536)).toBe(false);
    expect(isValidDevPort(3000.5)).toBe(false);
    expect(isValidDevPort('3000')).toBe(false);
    expect(isValidDevPort(null)).toBe(false);
  });

  it('normalizes numeric strings', () => {
    expect(normalizeDevPort('34567')).toBe(34567);
    expect(normalizeDevPort('99')).toBeNull();
    expect(normalizeDevPort('nope')).toBeNull();
  });

  it('detects the current process as alive', () => {
    expect(isPidAlive(process.pid)).toBe(true);
    expect(isPidAlive(-1)).toBe(false);
    expect(isPidAlive('nope')).toBe(false);
  });
});
