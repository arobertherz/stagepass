import { describe, it, expect } from 'vitest';
import {
  parseLsofListenOutput,
  assessResolverContent,
  assessCaddyfileStructure,
  runDoctor,
} from '../doctor.js';
import {
  RECOMMENDED_CDN_SNIPPETS,
  findUnpinnedCdnSnippets,
} from '../cdn-snippets.js';

describe('doctor helpers', () => {
  it('parses lsof listen lines', () => {
    const out = `COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
caddy   1234 me    8u  IPv6 0x1      0t0  TCP *:443 (LISTEN)
`;
    expect(parseLsofListenOutput(out)).toEqual([
      { command: 'caddy', pid: '1234', name: 'caddy' },
    ]);
  });

  it('assesses resolver content', () => {
    expect(assessResolverContent('nameserver 127.0.0.1\n').status).toBe('ok');
    expect(assessResolverContent('nameserver 8.8.8.8\n').status).toBe('fail');
  });

  it('assesses caddyfile structure', () => {
    const ok = `# START: my-project.sp
# stagepass-block: v2
# stagepass-options: allowAllOrigins=false
my-project.sp {
    tls internal
    handle {
        root * "/Users/me/Sites/my-project"
        file_server
    }
}
# END: my-project.sp
`;
    expect(assessCaddyfileStructure(ok).status).toBe('ok');
    expect(assessCaddyfileStructure('').status).toBe('warn');
  });

  // F-11: `missingRoot.length > 0` must not become `> 1` — a single missing root is a fail.
  it('[F-11] fails when exactly one Caddyfile block lacks a parseable root', () => {
    const oneMissing = `# START: broken.sp
# stagepass-block: v2
broken.sp {
    tls internal
    handle {
        file_server
    }
}
# END: broken.sp
`;
    const r = assessCaddyfileStructure(oneMissing);
    expect(r.status).toBe('fail');
    expect(r.message).toMatch(/1 block\(s\) without a parseable root/);
    expect(r.detail).toBe('broken.sp');
  });

  it('flags @latest, @1, and bare package in recommended snippets', () => {
    expect(findUnpinnedCdnSnippets().ok).toBe(true);
    expect(
      findUnpinnedCdnSnippets([
        'https://cdn.jsdelivr.net/npm/@stagepass/loader@latest/dist/loader.min.js',
      ]).ok
    ).toBe(false);
    expect(
      findUnpinnedCdnSnippets([
        'https://cdn.jsdelivr.net/npm/@stagepass/loader@1/dist/loader.min.js',
      ]).ok
    ).toBe(false);
    expect(
      findUnpinnedCdnSnippets([
        'https://cdn.jsdelivr.net/npm/@stagepass/loader/dist/loader.min.js',
      ]).ok
    ).toBe(false);
  });

  it('recommended CDN snippets use jsDelivr @2 and real dist paths', () => {
    expect(RECOMMENDED_CDN_SNIPPETS).toEqual([
      'https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js',
      'https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/inject.min.js',
      'https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/cookies.min.js',
      'https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/maintenance.min.js',
      'https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/all.min.js',
    ]);
    for (const url of RECOMMENDED_CDN_SNIPPETS) {
      expect(url).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/npm\/@stagepass\//);
      expect(url).not.toMatch(/unpkg/i);
      expect(url).toMatch(/@2\//);
    }
  });

  it('runDoctor is read-only and uses execFile-style arrays', async () => {
    const calls = [];
    const files = new Map([
      ['/etc/resolver/sp', 'nameserver 127.0.0.1\n'],
      [
        '/tmp/Caddyfile',
        `# START: demo.sp
# stagepass-block: v2
# stagepass-options: allowAllOrigins=false
demo.sp {
    tls internal
    handle {
        root * "/tmp/demo-site"
        file_server
    }
}
# END: demo.sp
`,
      ],
      [
        '/tmp/projects.json',
        JSON.stringify({
          version: 1,
          projects: { 'demo.sp': { root: '/tmp/demo-site', origins: [] } },
        }),
      ],
      ['/tmp/root.crt', null],
    ]);

    const result = await runDoctor({
      resolverPath: '/etc/resolver/sp',
      caddyfilePath: '/tmp/Caddyfile',
      projectsPath: '/tmp/projects.json',
      rootCaPath: '/tmp/missing-root.crt',
      plistPath: '/tmp/missing.plist',
      skipHandshake: true,
      projectChecks: false,
      projectCdnResult: { ok: true, offenders: [] },
      pathExists: async (p) => {
        if (p === '/tmp/demo-site') return true;
        if (p === '/tmp/missing-root.crt') return false;
        if (p === '/tmp/missing.plist') return false;
        return files.has(p) || p.includes('php-fpm') || p.includes('dnsmasq');
      },
      readFile: async (p) => {
        const v = files.get(p);
        if (v == null) throw new Error(`missing ${p}`);
        return v;
      },
      exec: async (file, args = []) => {
        calls.push({ file, args });
        if (file === '/usr/bin/env' && args[0] === 'which') {
          const name = args[1];
          if (['brew', 'caddy', 'php', 'php-fpm', 'dnsmasq'].includes(name)) {
            return { stdout: `/usr/local/bin/${name}\n`, stderr: '', code: 0 };
          }
          throw Object.assign(new Error('not found'), { code: 1 });
        }
        if (file === 'brew' && args[0] === '--prefix') {
          return { stdout: '/usr/local\n', stderr: '', code: 0 };
        }
        if (file === 'lsof') {
          return {
            stdout:
              'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\ncaddy 9 me 8u IPv6 0x1 0t0 TCP *:443 (LISTEN)\n',
            stderr: '',
            code: 0,
          };
        }
        if (file === 'security') {
          return { stdout: '', stderr: '', code: 0 };
        }
        if (file === 'launchctl') {
          throw Object.assign(new Error('not loaded'), { code: 1 });
        }
        return { stdout: '', stderr: '', code: 0 };
      },
    });

    expect(calls.every((c) => Array.isArray(c.args))).toBe(true);
    expect(calls.some((c) => c.file === 'sudo')).toBe(false);
    expect(result.checks.some((c) => c.id === 'homebrew' && c.status === 'ok')).toBe(
      true
    );
    expect(result.hints.length).toBeGreaterThan(0);
    expect(result.exitCode).toBe(1); // missing root CA / trust fail
  });
});

const DOCTOR_CADDY = `# START: demo.sp
# stagepass-block: v2
# stagepass-options: allowAllOrigins=false
demo.sp {
    tls internal
    handle {
        root * "/tmp/demo-site"
        file_server
    }
}
# END: demo.sp
`;

function agentPlist(nodePath, cliPath) {
  return `<plist><dict><key>ProgramArguments</key><array><string>${nodePath}</string><string>${cliPath}</string><string>daemon</string></array></dict></plist>`;
}

async function runLaunchAgentDoctor({ nodePath, cliPath, exists, stateVersion }) {
  const plistPath = '/tmp/sp74-agent.plist';
  const statePath = '/tmp/sp74-daemon.json';
  const files = new Map([
    ['/etc/resolver/sp', 'nameserver 127.0.0.1\n'],
    ['/tmp/Caddyfile', DOCTOR_CADDY],
    [plistPath, agentPlist(nodePath, cliPath)],
    [statePath, JSON.stringify({ version: stateVersion, pid: process.pid })],
  ]);
  return runDoctor({
    platform: 'darwin',
    cliVersion: '2.3.1',
    plistPath,
    daemonStatePath: statePath,
    resolverPath: '/etc/resolver/sp',
    caddyfilePath: '/tmp/Caddyfile',
    projectsPath: '/tmp/sp-doctor-74-no-projects.json',
    rootCaPath: '/tmp/missing-root.crt',
    skipHandshake: true,
    projectChecks: false,
    projectCdnScan: false,
    pathExists: async (p) => {
      if (p === '/tmp/missing-root.crt') return false;
      if (p === plistPath || p === '/etc/resolver/sp' || p === '/tmp/Caddyfile') return true;
      return exists(p);
    },
    readFile: async (p) => {
      if (!files.has(p)) throw new Error(`missing ${p}`);
      return files.get(p);
    },
    exec: async (file, args = []) => {
      if (file === '/usr/bin/env' && args[0] === 'which') {
        const name = args[1];
        if (['brew', 'caddy', 'php', 'php-fpm', 'dnsmasq'].includes(name)) {
          return { stdout: `/usr/local/bin/${name}\n`, stderr: '', code: 0 };
        }
        throw Object.assign(new Error('not found'), { code: 1 });
      }
      if (file === 'brew' && args[0] === '--prefix') {
        return { stdout: '/usr/local\n', stderr: '', code: 0 };
      }
      if (file === 'lsof') {
        return {
          stdout:
            'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\ncaddy 9 me 8u IPv6 0x1 0t0 TCP *:443 (LISTEN)\n',
          stderr: '',
          code: 0,
        };
      }
      if (file === 'launchctl') {
        return { stdout: 'state = running\npid = 1\n', stderr: '', code: 0 };
      }
      return { stdout: '', stderr: '', code: 0 };
    },
  });
}

function byId(result, id) {
  return result.checks.find((c) => c.id === id);
}

describe('[#74] LaunchAgent doctor checks', () => {
  const node = '/opt/homebrew/bin/node';
  const cli = '/opt/homebrew/bin/stagepass';

  it('[#74] fails when a LaunchAgent node or CLI path is missing', async () => {
    const missingNode = await runLaunchAgentDoctor({
      nodePath: node,
      cliPath: cli,
      exists: (p) => p === cli,
      stateVersion: '2.3.1',
    });
    const nodeFail = byId(missingNode, 'autostart.paths');
    expect(nodeFail?.status).toBe('fail');
    expect(nodeFail?.detail).toBe('stagepass autostart on');
    expect(nodeFail?.message).toMatch(/node/);

    const missingCli = await runLaunchAgentDoctor({
      nodePath: node,
      cliPath: cli,
      exists: (p) => p === node,
      stateVersion: '2.3.1',
    });
    const cliFail = byId(missingCli, 'autostart.paths');
    expect(cliFail?.status).toBe('fail');
    expect(cliFail?.detail).toBe('stagepass autostart on');
    expect(cliFail?.message).toMatch(/CLI/);
  });

  it('[#74] warns when the LaunchAgent node path is a versioned Cellar path', async () => {
    const cellar = '/opt/homebrew/Cellar/node/25.2.1/bin/node';
    const result = await runLaunchAgentDoctor({
      nodePath: cellar,
      cliPath: cli,
      exists: (p) => p === cellar || p === cli,
      stateVersion: '2.3.1',
    });
    expect(byId(result, 'autostart.paths')?.status).toBe('ok');
    const warn = byId(result, 'autostart.node');
    expect(warn?.status).toBe('warn');
    expect(warn?.detail).toBe('stagepass autostart on');
    expect(byId(result, 'autostart.version')?.status).toBe('ok');
  });

  it('[#74] warns when the daemon version differs from the CLI', async () => {
    const result = await runLaunchAgentDoctor({
      nodePath: node,
      cliPath: cli,
      exists: (p) => p === node || p === cli,
      stateVersion: '2.2.7',
    });
    expect(byId(result, 'autostart.paths')?.status).toBe('ok');
    expect(byId(result, 'autostart.node')?.status).toBe('ok');
    const warn = byId(result, 'autostart.version');
    expect(warn?.status).toBe('warn');
    expect(warn?.detail).toBe('stagepass autostart on');
    expect(warn?.message).toMatch(/2\.2\.7/);
    expect(warn?.message).toMatch(/2\.3\.1/);
  });

  it('[#74] reports ok when LaunchAgent paths and daemon version match', async () => {
    const result = await runLaunchAgentDoctor({
      nodePath: node,
      cliPath: cli,
      exists: (p) => p === node || p === cli,
      stateVersion: '2.3.1',
    });
    expect(byId(result, 'autostart.paths')).toMatchObject({ status: 'ok' });
    expect(byId(result, 'autostart.node')).toMatchObject({ status: 'ok' });
    expect(byId(result, 'autostart.version')).toMatchObject({ status: 'ok' });
    for (const id of ['autostart.paths', 'autostart.node', 'autostart.version']) {
      expect(byId(result, id)?.status).not.toMatch(/warn|fail/);
    }
  });
});
