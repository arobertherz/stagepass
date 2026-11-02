import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, Route } from '@playwright/test';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.join(ROOT, '..');
const FIX = path.join(ROOT, 'fixtures');
const LOADER_DIST = path.join(REPO, 'packages', 'loader', 'dist');

const SESSION_KEY = 'stagepass_domain';

export function sessionJson(domain: string, hours = 12): string {
  const expires = Date.now() + hours * 3600e3;
  return JSON.stringify({ domain, expires });
}

function mime(file: string): string {
  if (file.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  return 'application/octet-stream';
}

function read(file: string): Buffer {
  return fs.readFileSync(file);
}

/**
 * Intercept all requests and fulfill from fixtures / built loader dist.
 * No real network. Page origin is https://site.test/
 */
export async function installRoutes(page: Page): Promise<{ requests: string[] }> {
  const requests: string[] = [];

  await page.route('**/*', async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    requests.push(url.href);

    const cors = { 'Access-Control-Allow-Origin': '*' };

    // Loader + flag chunks (any host; path ends with the file name)
    const base = path.basename(url.pathname);
    if (base === 'loader.min.js' || base === 'loader.js') {
      const file = path.join(LOADER_DIST, base === 'loader.js' ? 'loader.js' : 'loader.min.js');
      return route.fulfill({
        status: 200,
        contentType: mime(file),
        headers: cors,
        body: read(file),
      });
    }
    if (base === 'flag.min.js' || base === 'flag-card.min.js') {
      const file = path.join(LOADER_DIST, base);
      return route.fulfill({
        status: 200,
        contentType: mime(file),
        headers: cors,
        body: read(file),
      });
    }

    // Local .sp assets
    if (url.hostname.endsWith('.sp')) {
      const name = path.basename(url.pathname);
      const local = path.join(FIX, 'local', name);
      if (fs.existsSync(local)) {
        return route.fulfill({
          status: 200,
          contentType: mime(local),
          headers: cors,
          body: read(local),
        });
      }
      return route.fulfill({ status: 404, headers: cors, body: 'not found' });
    }

    // Production CDN assets
    if (url.hostname === 'cdn.example.com') {
      const name = path.basename(url.pathname);
      const prod = path.join(FIX, 'prod', name);
      if (fs.existsSync(prod)) {
        return route.fulfill({
          status: 200,
          contentType: mime(prod),
          headers: cors,
          body: read(prod),
        });
      }
      return route.fulfill({ status: 404, headers: cors, body: 'not found' });
    }

    // HTML pages under site.test
    if (url.hostname === 'site.test') {
      const pageName = url.pathname === '/' ? 'live-src.html' : path.basename(url.pathname);
      const html = path.join(FIX, 'pages', pageName);
      if (fs.existsSync(html)) {
        return route.fulfill({ status: 200, contentType: mime(html), body: read(html) });
      }
    }

    return route.fulfill({ status: 404, body: `unmocked ${url.href}` });
  });

  return { requests };
}

export async function gotoPage(
  page: Page,
  file: string,
  opts?: { session?: string; search?: string }
): Promise<void> {
  const search = opts?.search || '';
  if (opts?.session) {
    await page.addInitScript(
      ([key, raw]) => {
        localStorage.setItem(key, raw);
      },
      [SESSION_KEY, sessionJson(opts.session)] as [string, string]
    );
  }
  await page.goto(`https://site.test/${file}${search}`, { waitUntil: 'load' });
}

export { FIX, LOADER_DIST };
