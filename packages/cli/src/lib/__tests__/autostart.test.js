import { describe, it, expect } from 'vitest';
import {
  escapeXml,
  buildDaemonProgramArguments,
  buildLaunchctlBootstrapArgs,
  buildLaunchctlBootoutArgs,
  buildLaunchctlPrintArgs,
  buildLaunchctlKickstartArgs,
  renderLaunchAgentPlist,
  resolveAutostartPaths,
  enableAutostart,
  disableAutostart,
  LAUNCH_AGENT_LABEL,
} from '../autostart.js';

describe('autostart helpers', () => {
  it('escapes XML special characters', () => {
    expect(escapeXml(`a&b<c>"d"'e`)).toBe(
      'a&amp;b&lt;c&gt;&quot;d&quot;&apos;e'
    );
  });

  it('builds daemon program arguments with absolute paths', () => {
    expect(
      buildDaemonProgramArguments({
        nodePath: '/usr/local/bin/node',
        cliPath: '/opt/stagepass/bin/index.js',
      })
    ).toEqual([
      '/usr/local/bin/node',
      '/opt/stagepass/bin/index.js',
      'daemon',
    ]);
  });

  it('builds launchctl argument arrays', () => {
    expect(buildLaunchctlBootstrapArgs(501, '/tmp/agent.plist')).toEqual([
      'bootstrap',
      'gui/501',
      '/tmp/agent.plist',
    ]);
    expect(buildLaunchctlBootoutArgs(501)).toEqual([
      'bootout',
      `gui/501/${LAUNCH_AGENT_LABEL}`,
    ]);
    expect(buildLaunchctlPrintArgs(501)).toEqual([
      'print',
      `gui/501/${LAUNCH_AGENT_LABEL}`,
    ]);
    expect(buildLaunchctlKickstartArgs(501)).toEqual([
      'kickstart',
      '-k',
      `gui/501/${LAUNCH_AGENT_LABEL}`,
    ]);
  });

  it('renders an idempotent LaunchAgent plist snapshot', () => {
    const plist = renderLaunchAgentPlist({
      nodePath: '/usr/local/bin/node',
      cliPath: '/Users/me/.nvm/versions/node/bin/stagepass',
      stdoutPath: '/Users/me/.stagepass/logs/daemon.stdout.log',
      stderrPath: '/Users/me/.stagepass/logs/daemon.stderr.log',
      workingDirectory: '/Users/me',
    });

    expect(plist).toContain(`<string>${LAUNCH_AGENT_LABEL}</string>`);
    expect(plist).toContain('<key>RunAtLoad</key>');
    expect(plist).toContain('<true/>');
    expect(plist).toContain('<key>SuccessfulExit</key>');
    expect(plist).toContain('<false/>');
    expect(plist).toContain('<string>/usr/local/bin/node</string>');
    expect(plist).toContain(
      '<string>/Users/me/.nvm/versions/node/bin/stagepass</string>'
    );
    expect(plist).toContain('<string>daemon</string>');
    expect(plist).toMatchSnapshot();
  });

  it('resolves absolute autostart paths', async () => {
    const result = await resolveAutostartPaths({
      execPath: '/usr/local/bin/node',
      argv1: '/opt/cli/bin/index.js',
      realpath: async (p) => p,
      pathExists: async () => true,
    });
    expect(result.ok).toBe(true);
    expect(result.nodePath).toBe('/usr/local/bin/node');
    expect(result.cliPath).toBe('/opt/cli/bin/index.js');
  });

  it('rejects missing or unresolved autostart paths', async () => {
    const missing = await resolveAutostartPaths({
      execPath: '/usr/local/bin/node',
      argv1: '/opt/cli/bin/index.js',
      realpath: async (p) => p,
      pathExists: async (p) => p === '/usr/local/bin/node',
    });
    expect(missing.ok).toBe(false);
    expect(missing.error).toMatch(/does not exist/);

    const noCli = await resolveAutostartPaths({
      execPath: '/usr/local/bin/node',
      argv1: null,
      realpath: async (p) => p,
      pathExists: async () => true,
      exec: async () => {
        throw Object.assign(new Error('not found'), { code: 1 });
      },
    });
    expect(noCli.ok).toBe(false);
    expect(noCli.error).toMatch(/Could not resolve absolute path/);
  });

  it('enableAutostart writes plist and bootstraps via exec arrays', async () => {
    const writes = [];
    const calls = [];
    const result = await enableAutostart({
      uid: 501,
      plistPath: '/tmp/io.github.arobertherz.stagepass.plist',
      logsDir: '/tmp/stagepass-logs',
      paths: {
        ok: true,
        nodePath: '/usr/local/bin/node',
        cliPath: '/opt/cli/bin/index.js',
      },
      pathExists: async () => true,
      ensureDir: async () => {},
      writeFile: async (p, c) => {
        writes.push({ path: p, content: c });
      },
      exec: async (file, args) => {
        calls.push({ file, args });
        return { stdout: '', stderr: '', code: 0 };
      },
    });

    expect(result.ok).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0].content).toContain(LAUNCH_AGENT_LABEL);
    expect(calls.some((c) => c.args[0] === 'bootout')).toBe(true);
    expect(calls.some((c) => c.args[0] === 'bootstrap')).toBe(true);
    expect(calls.every((c) => c.file === 'launchctl')).toBe(true);
  });

  it('enableAutostart refuses when injected paths are missing', async () => {
    const result = await enableAutostart({
      uid: 501,
      plistPath: '/tmp/io.github.arobertherz.stagepass.plist',
      logsDir: '/tmp/stagepass-logs',
      paths: {
        ok: true,
        nodePath: '/usr/local/bin/node',
        cliPath: '/opt/cli/bin/index.js',
      },
      pathExists: async () => false,
      ensureDir: async () => {},
      writeFile: async () => {
        throw new Error('should not write');
      },
      exec: async () => {
        throw new Error('should not exec');
      },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/does not exist/);
  });

  it('disableAutostart boots out and removes plist without shell strings', async () => {
    const removed = [];
    const calls = [];
    await disableAutostart({
      uid: 501,
      plistPath: '/tmp/io.github.arobertherz.stagepass.plist',
      pathExists: async () => true,
      remove: async (p) => {
        removed.push(p);
      },
      exec: async (file, args) => {
        calls.push({ file, args });
        return { stdout: '', stderr: '', code: 0 };
      },
    });
    expect(removed).toEqual(['/tmp/io.github.arobertherz.stagepass.plist']);
    expect(calls[0]).toEqual({
      file: 'launchctl',
      args: buildLaunchctlBootoutArgs(501),
    });
  });
});
