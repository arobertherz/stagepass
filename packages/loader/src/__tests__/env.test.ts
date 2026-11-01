import { describe, expect, it } from 'vitest';
import { detectRuntimeEnv, parseStagingHosts } from '../env.js';

describe('parseStagingHosts', () => {
  it('splits and normalizes comma-separated hosts', () => {
    expect(parseStagingHosts('a.example, B.Example ,')).toEqual([
      'a.example',
      'b.example',
    ]);
  });

  it('returns empty for missing values', () => {
    expect(parseStagingHosts(null)).toEqual([]);
    expect(parseStagingHosts('')).toEqual([]);
  });
});

describe('detectRuntimeEnv', () => {
  it('returns local for active .sp swap session', () => {
    expect(detectRuntimeEnv('my-project.webflow.io', 'my-project.sp')).toBe('local');
    expect(detectRuntimeEnv('example.com', 'app.sp')).toBe('local');
  });

  it('does not treat debug or localhost session as local', () => {
    expect(detectRuntimeEnv('example.com', null)).toBe('production');
    expect(detectRuntimeEnv('localhost', null)).toBe('production');
  });

  it('returns staging for .webflow.io when not swapping', () => {
    expect(detectRuntimeEnv('my-project.webflow.io', null)).toBe('staging');
  });

  it('returns staging for custom staging hosts', () => {
    expect(
      detectRuntimeEnv('preview.example.com', null, ['preview.example.com'])
    ).toBe('staging');
  });

  it('returns production otherwise', () => {
    expect(detectRuntimeEnv('example.com', null)).toBe('production');
  });
});
