import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { unlink } from '../unlink.js';
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
  })),
}));

describe('unlink command', () => {
  const mockCaddyDir = path.join(os.homedir(), '.stagepass');
  const mockCaddyFile = path.join(mockCaddyDir, 'Caddyfile');
  const mockProjects = path.join(mockCaddyDir, 'projects.json');

  beforeEach(() => {
    vi.clearAllMocks();
    fs.writeFile.mockResolvedValue();
    execa.mockResolvedValue({});
  });

  it('should remove domain block from Caddyfile', async () => {
    const existingContent = `
# START: test.sp
# stagepass-block: v2
# stagepass-options: allowAllOrigins=false
test.sp {
    handle {
        root * "/some/path"
    }
}
# END: test.sp

# START: other.sp
# stagepass-block: v2
# stagepass-options: allowAllOrigins=false
other.sp {
    handle {
        root * "/other/path"
    }
}
# END: other.sp
`;

    fs.pathExists.mockResolvedValue(true);
    fs.readFile.mockImplementation(async (p) => {
      if (p === mockCaddyFile) return existingContent;
      if (p === mockProjects) {
        return JSON.stringify({
          version: 1,
          projects: {
            'test.sp': { root: '/some/path', origins: [], allowAllOrigins: false },
            'other.sp': { root: '/other/path', origins: [], allowAllOrigins: false },
          },
        });
      }
      return '';
    });

    await unlink('test', {});

    expect(fs.writeFile).toHaveBeenCalled();
    const caddyWrites = fs.writeFile.mock.calls.filter((c) => c[0] === mockCaddyFile);
    const writtenContent = caddyWrites.at(-1)[1];
    expect(writtenContent).not.toContain('# START: test.sp');
    expect(writtenContent).toContain('other.sp');
  });

  it('should use current directory name if domain not provided', async () => {
    const originalCwd = process.cwd;
    process.cwd = vi.fn(() => '/Users/dev/Sites/my-project');

    const existingContent = `
# START: my-project.sp
# stagepass-block: v2
# stagepass-options: allowAllOrigins=false
my-project.sp {
    handle {
        root * "/Users/dev/Sites/my-project"
    }
}
# END: my-project.sp
`;

    fs.pathExists.mockResolvedValue(true);
    fs.readFile.mockResolvedValue(existingContent);

    await unlink(undefined, {});

    const caddyWrites = fs.writeFile.mock.calls.filter((c) => c[0] === mockCaddyFile);
    expect(caddyWrites.at(-1)[1]).not.toContain('# START: my-project.sp');

    process.cwd = originalCwd;
  });

  it('should fail if Caddyfile does not exist', async () => {
    fs.pathExists.mockResolvedValue(false);

    await unlink('test', {});

    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(execa).not.toHaveBeenCalled();
  });
});
