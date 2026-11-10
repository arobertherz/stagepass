import { describe, it, expect, vi } from 'vitest';
import {
  meetsNodeEngine,
  parseNodeVersion,
  unsupportedNodeMessage,
  assertNodeEngine,
  MIN_NODE_MAJOR,
  MIN_NODE_MINOR,
} from '../node-engine.js';

describe('node-engine', () => {
  it('parses process.version strings', () => {
    expect(parseNodeVersion('v20.17.0')).toEqual({ major: 20, minor: 17, patch: 0 });
    expect(parseNodeVersion('18.20.8')).toEqual({ major: 18, minor: 20, patch: 8 });
    expect(parseNodeVersion('bogus')).toBeNull();
  });

  it(`requires >=${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}.0`, () => {
    expect(meetsNodeEngine('v18.20.8')).toBe(false);
    expect(meetsNodeEngine('v20.10.0')).toBe(false);
    expect(meetsNodeEngine('v20.16.0')).toBe(false);
    expect(meetsNodeEngine('v20.17.0')).toBe(true);
    expect(meetsNodeEngine('v22.0.0')).toBe(true);
    expect(meetsNodeEngine('v24.1.0')).toBe(true);
  });

  it('prints a clear message and exits 1 when too old', () => {
    const write = vi.fn();
    const exit = vi.fn();
    assertNodeEngine({ version: 'v18.20.8', write, exit });
    expect(write).toHaveBeenCalledWith(unsupportedNodeMessage('v18.20.8'));
    expect(String(write.mock.calls[0][0])).toMatch(/requires Node\.js >=20\.17\.0/);
    expect(String(write.mock.calls[0][0])).toMatch(/@stagepass\/cli@2\.2\.7/);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('allows a supported version without writing or exiting', () => {
    const write = vi.fn();
    const exit = vi.fn();
    assertNodeEngine({ version: 'v20.17.0', write, exit });
    expect(write).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });
});
