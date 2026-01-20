import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reload } from '../reload.js';
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
    })),
  })),
}));

describe('reload command', () => {
  const mockCaddyDir = path.join(os.homedir(), '.stagepass');
  const mockCaddyFile = path.join(mockCaddyDir, 'Caddyfile');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should reload Caddy when Caddyfile exists', async () => {
    fs.pathExists.mockResolvedValue(true);
    execa.mockResolvedValue({});

    await reload({});

    expect(execa).toHaveBeenCalledWith(
      'caddy',
      ['reload', '--config', mockCaddyFile],
      expect.any(Object)
    );
  });

  it('should fail if Caddyfile does not exist', async () => {
    fs.pathExists.mockResolvedValue(false);

    await reload({});

    expect(execa).not.toHaveBeenCalled();
  });

  it('should fail if Caddy is not installed', async () => {
    fs.pathExists.mockResolvedValue(true);
    execa.mockRejectedValueOnce(new Error('caddy: command not found'));

    await reload({});

    // Should not attempt reload if version check fails
    expect(execa).toHaveBeenCalledTimes(1);
    expect(execa).toHaveBeenCalledWith('caddy', ['version'], expect.any(Object));
  });

  it('should use verbose stdio when verbose option is set', async () => {
    fs.pathExists.mockResolvedValue(true);
    execa.mockResolvedValue({});

    await reload({ verbose: true });

    expect(execa).toHaveBeenCalledWith(
      'caddy',
      ['reload', '--config', mockCaddyFile],
      expect.objectContaining({ stdio: 'inherit' })
    );
  });
});
