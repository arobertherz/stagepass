import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { renderSiteBlock } from '../caddyfile.js';

function dockerAvailable() {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function caddyAdapt(caddyfileContents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stagepass-caddy-'));
  const file = path.join(dir, 'Caddyfile');
  fs.writeFileSync(file, caddyfileContents);
  try {
    const json = execFileSync(
      'docker',
      [
        'run',
        '--rm',
        '-v',
        `${dir}:/c`,
        'caddy:2-alpine',
        'caddy',
        'adapt',
        '--config',
        '/c/Caddyfile',
        '--adapter',
        'caddyfile',
      ],
      { encoding: 'utf-8' }
    );
    return JSON.parse(json);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const describeAdapt = dockerAvailable() ? describe : describe.skip;

describeAdapt('caddy adapt integration (optional)', () => {
  it('adapts default allowlist and allow-all blocks', () => {
    const allowlist = renderSiteBlock('app.sp', '/srv/app', {
      allowAllOrigins: false,
      origins: ['example.com'],
    });
    const allowAll = renderSiteBlock('open.sp', '/srv/open', {
      allowAllOrigins: true,
    });
    const withQuote = renderSiteBlock('q.sp', '/srv/My "App"', {});

    const adapted = caddyAdapt(`${allowlist}\n\n${allowAll}\n\n${withQuote}\n`);
    expect(adapted).toHaveProperty('apps.http');
    const encoded = JSON.stringify(adapted);
    expect(encoded).toMatch(/404/);
    expect(encoded).toMatch(/Access-Control-Allow-Origin/);
    expect(encoded).toMatch(/Access-Control-Allow-Private-Network/);
  });
});
