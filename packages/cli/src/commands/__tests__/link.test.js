import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { link } from '../link.js';
import fs from 'fs-extra';
import { execa } from 'execa';
import os from 'os';
import path from 'path';

// Mock dependencies
vi.mock('fs-extra');
vi.mock('execa');
vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn(() => ({
      succeed: vi.fn(),
      fail: vi.fn(),
      warn: vi.fn(),
    })),
  })),
}));

describe('link command', () => {
  const mockCaddyDir = path.join(os.homedir(), '.stagepass');
  const mockCaddyFile = path.join(mockCaddyDir, 'Caddyfile');
  const originalCwd = process.cwd;

  beforeEach(() => {
    vi.clearAllMocks();
    process.cwd = vi.fn(() => '/test/project');
  });

  afterEach(() => {
    process.cwd = originalCwd;
  });

  it('should use current directory name as domain if not provided', async () => {
    fs.pathExists.mockResolvedValue(false);
    fs.ensureDir.mockResolvedValue();
    fs.writeFile.mockResolvedValue();
    execa.mockResolvedValue({});

    await link(undefined, {});

    expect(fs.writeFile).toHaveBeenCalled();
    const writtenContent = fs.writeFile.mock.calls[0][1];
    expect(writtenContent).toContain('project.sp');
  });

  it('should add .sp extension if missing', async () => {
    fs.pathExists.mockResolvedValue(false);
    fs.ensureDir.mockResolvedValue();
    fs.writeFile.mockResolvedValue();
    execa.mockResolvedValue({});

    await link('my-domain', {});

    const writtenContent = fs.writeFile.mock.calls[0][1];
    expect(writtenContent).toContain('my-domain.sp');
  });

  it('should replace existing domain block if already linked', async () => {
    const existingContent = `
# START: test.sp
test.sp {
    root * "/old/path"
}
# END: test.sp
`;

    fs.pathExists.mockResolvedValue(true);
    fs.readFile.mockResolvedValue(existingContent);
    fs.ensureDir.mockResolvedValue();
    fs.writeFile.mockResolvedValue();
    execa.mockResolvedValue({});

    await link('test', {});

    expect(fs.writeFile).toHaveBeenCalled();
    const writtenContent = fs.writeFile.mock.calls[0][1];
    expect(writtenContent).toContain('test.sp');
    expect(writtenContent).toContain('/test/project');
    // Should not contain old path
    expect(writtenContent).not.toContain('/old/path');
  });

  it('should append new domain block if not exists', async () => {
    const existingContent = '# Some existing config';
    
    fs.pathExists.mockResolvedValue(true);
    fs.readFile.mockResolvedValue(existingContent);
    fs.ensureDir.mockResolvedValue();
    fs.writeFile.mockResolvedValue();
    execa.mockResolvedValue({});

    await link('new-domain', {});

    expect(fs.writeFile).toHaveBeenCalled();
    const writtenContent = fs.writeFile.mock.calls[0][1];
    expect(writtenContent).toContain('Some existing config');
    expect(writtenContent).toContain('new-domain.sp');
  });

  it('should handle Caddy reload failure gracefully', async () => {
    fs.pathExists.mockResolvedValue(false);
    fs.ensureDir.mockResolvedValue();
    fs.writeFile.mockResolvedValue();
    execa.mockRejectedValue(new Error('Caddy not running'));

    await link('test', {});

    // Should still write config even if reload fails
    expect(fs.writeFile).toHaveBeenCalled();
  });
});
