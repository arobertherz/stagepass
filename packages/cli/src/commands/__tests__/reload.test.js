import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reload } from '../reload.js';
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

describe('reload command', () => {
  const mockCaddyFile = path.join(os.homedir(), '.stagepass', 'Caddyfile');

  beforeEach(() => {
    vi.clearAllMocks();
    fs.readFile.mockResolvedValue('# stagepass-block: v2\n');
    fs.copy.mockResolvedValue();
    fs.writeFile.mockResolvedValue();
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
