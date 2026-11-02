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
