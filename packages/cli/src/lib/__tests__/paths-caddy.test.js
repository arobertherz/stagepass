import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  getCaddyDataDir,
  getCaddyRootCaPath,
  getBrewCaddyDataDir,
  getLogsDir,
  LAUNCH_AGENT_LABEL,
  getLaunchAgentPlistPath,
} from '../paths.js';

describe('caddy / autostart paths', () => {
  it('uses macOS Application Support by default', () => {
    const dir = getCaddyDataDir({ home: '/Users/demo', env: {} });
    expect(dir).toBe(
      path.join('/Users/demo', 'Library', 'Application Support', 'Caddy')
    );
    expect(getCaddyRootCaPath({ home: '/Users/demo', env: {} })).toBe(
      path.join(dir, 'pki', 'authorities', 'local', 'root.crt')
    );
  });

  it('honours XDG_DATA_HOME like Caddy', () => {
    expect(
      getCaddyDataDir({
        home: '/Users/demo',
        env: { XDG_DATA_HOME: '/custom/data' },
      })
    ).toBe(path.join('/custom/data', 'caddy'));
  });

  it('reports brew secondary data dir', () => {
    expect(getBrewCaddyDataDir({ brewPrefix: '/opt/homebrew' })).toBe(
      path.join('/opt/homebrew', 'var', 'lib', 'caddy')
    );
    expect(getBrewCaddyDataDir({})).toBeNull();
  });

  it('exposes launch agent label and paths', () => {
    expect(LAUNCH_AGENT_LABEL).toBe('io.github.arobertherz.stagepass');
    expect(getLaunchAgentPlistPath()).toContain(
      `${LAUNCH_AGENT_LABEL}.plist`
    );
    expect(getLogsDir()).toContain('.stagepass');
    expect(getLogsDir()).toContain('logs');
  });
});
