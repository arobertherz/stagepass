import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { ensureCaddyfileMigrated } from '../migrate.js';

describe('ensureCaddyfileMigrated', () => {
  let tmpDir;
  let caddyfilePath;
  let projectsPath;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stagepass-mig-'));
    caddyfilePath = path.join(tmpDir, 'Caddyfile');
    projectsPath = path.join(tmpDir, 'projects.json');
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('backs up once, migrates legacy blocks, and is idempotent', async () => {
    const legacy = `# foreign comment

# START: demo.sp
demo.sp {
    root * "${path.join(tmpDir, 'demo')}"
    php_fastcgi 127.0.0.1:9000
    file_server
    tls internal
    header Access-Control-Allow-Origin *
}
# END: demo.sp
`;
    await fs.writeFile(caddyfilePath, legacy);

    const first = await ensureCaddyfileMigrated({
      caddyfilePath,
      projectsPath,
      silent: true,
    });
    expect(first.changed).toBe(true);
    expect(first.backupPath).toBeTruthy();
    expect(await fs.pathExists(first.backupPath)).toBe(true);
    expect(first.migrated.map((m) => m.domain)).toEqual(['demo.sp']);

    const after = await fs.readFile(caddyfilePath, 'utf-8');
    expect(after).toContain('foreign comment');
    expect(after).toContain('stagepass-block: v3');
    expect(after).toContain('>Access-Control-Allow-Origin');
    expect(after).toContain('allowAllOrigins=true');

    const projects = JSON.parse(await fs.readFile(projectsPath, 'utf-8'));
    expect(projects.projects['demo.sp'].allowAllOrigins).toBe(true);

    const backupsBefore = (await fs.readdir(tmpDir)).filter((f) =>
      f.startsWith('Caddyfile.bak-')
    );

    const second = await ensureCaddyfileMigrated({
      caddyfilePath,
      projectsPath,
      silent: true,
    });
    expect(second.changed).toBe(false);
    expect(second.backupPath).toBeNull();

    const backupsAfter = (await fs.readdir(tmpDir)).filter((f) =>
      f.startsWith('Caddyfile.bak-')
    );
    expect(backupsAfter).toEqual(backupsBefore);
  });

  it('cli-php: rewrites v2 blocks without enabling allow-all or writing projects.json', async () => {
    const root = path.join(tmpDir, 'app');
    const block = `# START: app.sp
# stagepass-block: v2
# stagepass-options: allowAllOrigins=false php=true origins=example.com
app.sp {
    root * "${root}"
    file_server
}
# END: app.sp
`;
    await fs.writeFile(caddyfilePath, block);
    const first = await ensureCaddyfileMigrated({
      caddyfilePath,
      projectsPath,
      silent: true,
    });
    expect(first.changed).toBe(true);
    expect(first.migrated).toEqual([]);
    expect(first.upgraded.map((item) => item.domain)).toEqual(['app.sp']);
    expect(await fs.pathExists(projectsPath)).toBe(false);

    const after = await fs.readFile(caddyfilePath, 'utf-8');
    expect(after).toContain('stagepass-block: v3');
    expect(after).toContain('allowAllOrigins=false');
    expect(after).toContain('origins=example.com');
    expect(after).toContain('>Access-Control-Allow-Origin');
    expect(after).not.toContain('allowAllOrigins=true');

    const second = await ensureCaddyfileMigrated({
      caddyfilePath,
      projectsPath,
      silent: true,
    });
    expect(second.changed).toBe(false);
    expect(second.backupPath).toBeNull();
  });

  function v2Block() {
    const root = path.join(tmpDir, 'app');
    return `# START: app.sp
# stagepass-block: v2
# stagepass-options: allowAllOrigins=false php=true origins=example.com
app.sp {
    root * "${root}"
    file_server
}
# END: app.sp
`;
  }

  function versionExec(stdout, fail) {
    return async (file, args = []) => {
      if (file === 'caddy' && args[0] === 'version') {
        if (fail) throw new Error('caddy not found');
        return { stdout, stderr: '' };
      }
      throw new Error(`unexpected ${file} ${args.join(' ')}`);
    };
  }

  it('[caddy-2.9] leaves v2 blocks unchanged on Caddy 2.8.4 and warns once', async () => {
    await fs.writeFile(caddyfilePath, v2Block());
    const logs = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg)));
    try {
      const result = await ensureCaddyfileMigrated({
        caddyfilePath,
        projectsPath,
        exec: versionExec('v2.8.4 h1:old\n'),
      });
      expect(result.changed).toBe(false);
      expect(result.backupPath).toBeNull();
      const after = await fs.readFile(caddyfilePath, 'utf-8');
      expect(after).toContain('stagepass-block: v2');
      expect(after).not.toContain('stagepass-block: v3');
      expect(after).not.toContain('>Access-Control-Allow-Origin');
      const text = logs.join('\n');
      expect(text).toContain('2.8.4');
      expect(text).toContain('brew upgrade caddy');
      expect(text.match(/brew upgrade caddy/g)).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });

  it.each([
    ['2.9.0', 'v2.9.0 h1:min\n'],
    ['2.10.2', 'v2.10.2 h1:new\n'],
  ])('[caddy-2.9] still rewrites v2 blocks on Caddy %s', async (_label, stdout) => {
      await fs.writeFile(caddyfilePath, v2Block());
      const result = await ensureCaddyfileMigrated({
        caddyfilePath,
        projectsPath,
        silent: true,
        exec: versionExec(stdout),
      });
      expect(result.changed).toBe(true);
      expect(result.upgraded.map((item) => item.domain)).toEqual(['app.sp']);
      const after = await fs.readFile(caddyfilePath, 'utf-8');
      expect(after).toContain('stagepass-block: v3');
      expect(after).toContain('>Access-Control-Allow-Origin');
    }
  );

  it('[caddy-2.9] still rewrites when the Caddy version is unknown', async () => {
    await fs.writeFile(caddyfilePath, v2Block());
    for (const exec of [versionExec('not a version\n'), versionExec('', true)]) {
      await fs.writeFile(caddyfilePath, v2Block());
      const result = await ensureCaddyfileMigrated({
        caddyfilePath,
        projectsPath,
        silent: true,
        exec,
      });
      expect(result.changed).toBe(true);
      expect(await fs.readFile(caddyfilePath, 'utf-8')).toContain('stagepass-block: v3');
    }
  });

  it('no-ops when Caddyfile is missing', async () => {
    const result = await ensureCaddyfileMigrated({
      caddyfilePath: path.join(tmpDir, 'missing'),
      projectsPath,
      silent: true,
    });
    expect(result.changed).toBe(false);
  });
});
