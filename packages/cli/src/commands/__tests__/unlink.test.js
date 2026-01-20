import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { unlink } from '../unlink.js';
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

describe('unlink command', () => {
  const mockCaddyDir = path.join(os.homedir(), '.stagepass');
  const mockCaddyFile = path.join(mockCaddyDir, 'Caddyfile');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should remove domain block from Caddyfile', async () => {
    const existingContent = `
# START: test.sp
test.sp {
    root * "/some/path"
}
# END: test.sp

# START: other.sp
other.sp {
    root * "/other/path"
}
# END: other.sp
`;

    fs.pathExists.mockResolvedValue(true);
    fs.readFile.mockResolvedValue(existingContent);
    fs.writeFile.mockResolvedValue();
    execa.mockResolvedValue({});

    await unlink('test', {});

    expect(fs.writeFile).toHaveBeenCalled();
    const writtenContent = fs.writeFile.mock.calls[0][1];
    expect(writtenContent).not.toContain('test.sp');
    expect(writtenContent).toContain('other.sp');
  });

  it('should use current directory name if domain not provided', async () => {
    const originalCwd = process.cwd;
    process.cwd = vi.fn(() => '/test/my-project');

    const existingContent = `
# START: my-project.sp
my-project.sp {
    root * "/test/my-project"
}
# END: my-project.sp
`;

    fs.pathExists.mockResolvedValue(true);
    fs.readFile.mockResolvedValue(existingContent);
    fs.writeFile.mockResolvedValue();
    execa.mockResolvedValue({});

    await unlink(undefined, {});

    const writtenContent = fs.writeFile.mock.calls[0][1];
    expect(writtenContent).not.toContain('my-project.sp');

    process.cwd = originalCwd;
  });

  it('should fail if Caddyfile does not exist', async () => {
    fs.pathExists.mockResolvedValue(false);

    await unlink('test', {});

    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(execa).not.toHaveBeenCalled();
  });
});
