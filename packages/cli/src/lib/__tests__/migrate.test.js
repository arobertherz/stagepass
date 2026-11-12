import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
    expect(after).toContain('stagepass-block: v2');
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

  it('no-ops when Caddyfile is missing', async () => {
    const result = await ensureCaddyfileMigrated({
      caddyfilePath: path.join(tmpDir, 'missing'),
      projectsPath,
      silent: true,
    });
    expect(result.changed).toBe(false);
  });
});
