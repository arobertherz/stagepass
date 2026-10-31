import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { link } from '../link.js';
import fs from 'fs-extra';
import { execa } from 'execa';
import os from 'os';
import path from 'path';

vi.mock('fs-extra');
vi.mock('execa');
vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn(function start() {
      return this;
    }),
    succeed: vi.fn(),
    fail: vi.fn(),
    warn: vi.fn(),
    stop: vi.fn(),
    info: vi.fn(),
  })),
}));

describe('link command', () => {
  const mockCaddyDir = path.join(os.homedir(), '.stagepass');
  const mockCaddyFile = path.join(mockCaddyDir, 'Caddyfile');
  const mockProjects = path.join(mockCaddyDir, 'projects.json');
  const originalCwd = process.cwd;

  beforeEach(() => {
    vi.clearAllMocks();
    process.cwd = vi.fn(() => '/Users/dev/Sites/project');
    fs.pathExists.mockResolvedValue(false);
    fs.ensureDir.mockResolvedValue();
    fs.writeFile.mockResolvedValue();
    fs.readFile.mockResolvedValue('');
    fs.copy.mockResolvedValue();
    execa.mockResolvedValue({});
  });

  afterEach(() => {
    process.cwd = originalCwd;
  });

  it('should use current directory name as domain if not provided', async () => {
    await link(undefined, {});

    expect(fs.writeFile).toHaveBeenCalled();
    const caddyWrites = fs.writeFile.mock.calls.filter((c) => c[0] === mockCaddyFile);
    expect(caddyWrites.length).toBeGreaterThan(0);
    expect(caddyWrites.at(-1)[1]).toContain('project.sp');
    expect(caddyWrites.at(-1)[1]).toContain('stagepass-block: v2');
    expect(caddyWrites.at(-1)[1]).toContain('allowAllOrigins=false');
  });

  it('should add .sp extension if missing', async () => {
    await link('my-domain', {});

    const caddyWrites = fs.writeFile.mock.calls.filter((c) => c[0] === mockCaddyFile);
    expect(caddyWrites.at(-1)[1]).toContain('my-domain.sp');
  });

  it('should reject invalid domains without writing Caddyfile', async () => {
    await link('bad domain', {});
    const caddyWrites = fs.writeFile.mock.calls.filter((c) => c[0] === mockCaddyFile);
    expect(caddyWrites).toHaveLength(0);
  });

  it('should replace existing domain block if already linked', async () => {
    const existingContent = `
# START: test.sp
# stagepass-block: v2
# stagepass-options: allowAllOrigins=false
test.sp {
    @blocked path_regexp blocked x
    handle @blocked { respond 404 }
    handle {
        root * "/old/path"
        php_fastcgi 127.0.0.1:9000
        file_server
        tls internal
    }
}
# END: test.sp
`;

    fs.pathExists.mockImplementation(async (p) => p === mockCaddyFile);
    fs.readFile.mockImplementation(async (p) => {
      if (p === mockCaddyFile) return existingContent;
      throw new Error('missing');
    });

    await link('test', {});

    const caddyWrites = fs.writeFile.mock.calls.filter((c) => c[0] === mockCaddyFile);
    const writtenContent = caddyWrites.at(-1)[1];
    expect(writtenContent).toContain('test.sp');
    expect(writtenContent).toContain('/Users/dev/Sites/project');
    expect(writtenContent).not.toContain('/old/path');
  });

  it('should append new domain block if not exists', async () => {
    const existingContent = '# Some existing config\n';

    fs.pathExists.mockImplementation(async (p) => p === mockCaddyFile);
    fs.readFile.mockImplementation(async (p) => {
      if (p === mockCaddyFile) return existingContent;
      throw new Error('missing');
    });

    await link('new-domain', {});

    const caddyWrites = fs.writeFile.mock.calls.filter((c) => c[0] === mockCaddyFile);
    const writtenContent = caddyWrites.at(-1)[1];
    expect(writtenContent).toContain('Some existing config');
    expect(writtenContent).toContain('new-domain.sp');
  });

  it('should handle Caddy reload failure gracefully', async () => {
    execa.mockRejectedValue(new Error('Caddy not running'));

    await link('test', {});

    const caddyWrites = fs.writeFile.mock.calls.filter((c) => c[0] === mockCaddyFile);
    expect(caddyWrites.length).toBeGreaterThan(0);
  });

  it('should persist --origin and --allow-all-origins into projects.json', async () => {
    await link('cors-app', {
      origin: ['example.com', '*.example.org'],
      allowAllOrigins: true,
    });

    const projectWrites = fs.writeFile.mock.calls.filter((c) => c[0] === mockProjects);
    expect(projectWrites.length).toBeGreaterThan(0);
    const doc = JSON.parse(projectWrites.at(-1)[1]);
    expect(doc.projects['cors-app.sp'].origins).toEqual([
      'example.com',
      '*.example.org',
    ]);
    expect(doc.projects['cors-app.sp'].allowAllOrigins).toBe(true);

    const caddyWrites = fs.writeFile.mock.calls.filter((c) => c[0] === mockCaddyFile);
    expect(caddyWrites.at(-1)[1]).toContain('allowAllOrigins=true');
    expect(caddyWrites.at(-1)[1]).toContain('Access-Control-Allow-Origin *');
  });
});
