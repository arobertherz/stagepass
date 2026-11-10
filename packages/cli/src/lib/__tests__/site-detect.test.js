import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detectSite,
  describeDetection,
  normalizeSiteUrl,
  parseStagepassScripts,
  detectedModulesList,
} from '../site-detect.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => fs.readFileSync(path.join(here, 'fixtures/sites', name), 'utf8');

function htmlResponse(body, status = 200, headers = {}) {
  return new Response(body, { status, headers: { 'content-type': 'text/html', ...headers } });
}
function redirect(location, status = 301) {
  return new Response(null, { status, headers: { location } });
}

describe('normalizeSiteUrl', () => {
  it('accepts bare hosts and https URLs', () => {
    expect(normalizeSiteUrl('my-site.webflow.io')).toMatchObject({ ok: true, host: 'my-site.webflow.io', url: 'https://my-site.webflow.io/' });
    expect(normalizeSiteUrl('https://www.example.com/de/')).toMatchObject({ ok: true, host: 'www.example.com' });
  });
  it.each([
    ['http://example.com', /https/],
    ['https://user:pw@example.com', /credentials/],
    ['https://example.com:8443', /port/],
    ['https://example.com:443', /port/],
    ['example.com:443', /port/],
    ['https://example.com:0443', /port/],
    ['*.webflow.io', /./],
    ['', /No live site/],
    ['javascript:alert(1)', /./],
  ])('rejects %s', (input, re) => {
    const r = normalizeSiteUrl(input);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(re);
  });

  it.each([
    [' example.com'],
    ['example.com '],
    ['example.com\n'],
    ['example.com\t'],
    ['exa\tmple.com'],
    ['exa\nmple.com'],
    ['exa\rmple.com'],
    ['example.com\r'],
    ['\u0000example.com'],
    ['example.com\u0000'],
    ['https://exa\tmple.com'],
  ])('rejects whitespace/controls in %j before any fetch (AC-10)', (input) => {
    const r = normalizeSiteUrl(input);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/whitespace|control/i);
  });
});

describe('parseStagepassScripts (hostile input)', () => {
  it('stays fast on unterminated comments and script tags', () => {
    const big = '<!--'.repeat(200000) + '<script'.repeat(200000);
    const t = Date.now();
    const r = parseStagepassScripts(big);
    expect(Date.now() - t).toBeLessThan(2000);
    expect(r.loader).toBeNull();
  });

  it('ignores tags after an unterminated comment', () => {
    const html =
      '<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js"></script><!-- <script src="https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/all.min.js"></script>';
    const r = parseStagepassScripts(html);
    expect(r.loader).not.toBeNull();
    expect(r.modules).toEqual([]);
  });
});

describe('parseStagepassScripts (fixtures)', () => {
  it('none: no loader, no modules (text mentions are ignored)', () => {
    const r = parseStagepassScripts(fixture('none.html'));
    expect(r).toEqual({ loader: null, modules: [] });
    expect(detectedModulesList(r)).toEqual([]);
  });
  it('loader only', () => {
    const r = parseStagepassScripts(fixture('loader-only.html'));
    expect(r.loader).toEqual({ version: '2', cdn: 'jsdelivr' });
    expect(detectedModulesList(r)).toEqual([]);
  });
  it('single module (single quotes)', () => {
    const r = parseStagepassScripts(fixture('single.html'));
    expect(r.modules).toEqual([{ id: 'cookies', version: '2', cdn: 'jsdelivr' }]);
    expect(detectedModulesList(r)).toEqual(['cookies']);
  });
  it('all bundle (uppercase tag)', () => {
    const r = parseStagepassScripts(fixture('all.html'));
    expect(r.loader).not.toBeNull();
    expect(detectedModulesList(r)).toEqual(['all']);
  });
  it('unpkg: unversioned, protocol-relative, unminified, query string, unquoted', () => {
    const r = parseStagepassScripts(fixture('unpkg.html'));
    expect(r.loader).toEqual({ version: 'latest', cdn: 'unpkg' });
    expect(r.modules).toEqual([
      { id: 'inject', version: '^2', cdn: 'unpkg' },
      { id: 'maintenance', version: '2', cdn: 'unpkg' },
    ]);
    expect(detectedModulesList(r)).toEqual(['inject', 'maintenance']);
  });
  it('pinned @2.0.0; ignores comments, data-src and foreign hosts', () => {
    const r = parseStagepassScripts(fixture('pinned.html'));
    expect(r.loader).toEqual({ version: '2.0.0', cdn: 'jsdelivr' });
    expect(detectedModulesList(r)).toEqual(['inject', 'cookies']);
    expect(describeDetection({ ok: true, ...r })).toBe('loader @2.0.0 (jsdelivr), modules inject@2.0.0, cookies@2.0.0');
  });
});

describe('parseStagepassScripts (package-root CDN)', () => {
  it.each([
    ['https://unpkg.com/@stagepass/loader@2', { version: '2', cdn: 'unpkg' }],
    ['https://unpkg.com/@stagepass/loader@2/', { version: '2', cdn: 'unpkg' }],
    ['https://unpkg.com/@stagepass/loader@2?v=1', { version: '2', cdn: 'unpkg' }],
    ['https://unpkg.com/@stagepass/loader', { version: 'latest', cdn: 'unpkg' }],
    ['https://cdn.jsdelivr.net/npm/@stagepass/loader@2', { version: '2', cdn: 'jsdelivr' }],
    ['https://cdn.jsdelivr.net/npm/@stagepass/loader@2/', { version: '2', cdn: 'jsdelivr' }],
    ['//cdn.jsdelivr.net/npm/@stagepass/loader@2.3.1', { version: '2.3.1', cdn: 'jsdelivr' }],
  ])('loader package root %s', (src, loader) => {
    const r = parseStagepassScripts(`<script src="${src}"></script>`);
    expect(r.loader).toEqual(loader);
    expect(r.modules).toEqual([]);
  });

  it.each([
    ['https://unpkg.com/@stagepass/modules@2', '2', 'unpkg'],
    ['https://unpkg.com/@stagepass/modules@2/', '2', 'unpkg'],
    ['https://unpkg.com/@stagepass/modules', 'latest', 'unpkg'],
    ['https://cdn.jsdelivr.net/npm/@stagepass/modules@2', '2', 'jsdelivr'],
    ['https://cdn.jsdelivr.net/npm/@stagepass/modules@2?module', '2', 'jsdelivr'],
  ])('modules package root %s maps to all (package.json main)', (src, version, cdn) => {
    const r = parseStagepassScripts(`<script src="${src}"></script>`);
    expect(r.loader).toBeNull();
    expect(r.modules).toEqual([{ id: 'all', version, cdn }]);
    expect(detectedModulesList(r)).toEqual(['all']);
  });

  it('package-root loader + modules together', () => {
    const html = `
<script src="https://unpkg.com/@stagepass/loader@2"></script>
<script src="https://unpkg.com/@stagepass/modules@2"></script>`;
    const r = parseStagepassScripts(html);
    expect(r.loader).toEqual({ version: '2', cdn: 'unpkg' });
    expect(detectedModulesList(r)).toEqual(['all']);
  });
});

describe('parseStagepassScripts (self-hosted)', () => {
  it('matches loader with data-stagepass-* attribute', () => {
    const r = parseStagepassScripts(
      '<script src="/assets/loader.min.js" data-stagepass-version="2.3.1"></script>'
    );
    expect(r.loader).toEqual({ version: '2.3.1', cdn: 'self' });
  });

  it('matches known build file under a /stagepass/ path', () => {
    const html = `
<script src="/vendor/stagepass/loader.min.js"></script>
<script src="/vendor/stagepass/inject.min.js"></script>
<script src="/vendor/stagepass/cookies.js"></script>`;
    const r = parseStagepassScripts(html);
    expect(r.loader).toEqual({ version: 'latest', cdn: 'self' });
    expect(r.modules).toEqual([
      { id: 'inject', version: 'latest', cdn: 'self' },
      { id: 'cookies', version: 'latest', cdn: 'self' },
    ]);
    expect(detectedModulesList(r)).toEqual(['inject', 'cookies']);
  });

  it('matches renamed file with loader-config data attribute', () => {
    const r = parseStagepassScripts(
      '<script src="/js/sp-runtime.js" data-stagepass-live-src="true" data-stagepass-version="2"></script>'
    );
    expect(r.loader).toEqual({ version: '2', cdn: 'self' });
    expect(r.modules).toEqual([]);
  });

  it('matches node_modules/@stagepass paths', () => {
    const r = parseStagepassScripts(
      '<script src="/node_modules/@stagepass/modules/dist/all.min.js"></script>'
    );
    expect(r.modules).toEqual([{ id: 'all', version: 'latest', cdn: 'self' }]);
  });

  it('does not match bare loader.js without a Stagepass hint', () => {
    const r = parseStagepassScripts('<script src="/js/loader.js"></script>');
    expect(r).toEqual({ loader: null, modules: [] });
  });

  it('does not match other libraries all.min.js without a Stagepass hint', () => {
    const r = parseStagepassScripts('<script src="https://cdn.example.com/libs/all.min.js"></script>');
    expect(r).toEqual({ loader: null, modules: [] });
  });

  it('does not match project asset tags with data-stagepass and a non-Stagepass filename', () => {
    const r = parseStagepassScripts(
      '<script src="https://cdn.example.com/js/main.js" data-stagepass="true" data-stagepass-path="dist/main.js"></script>'
    );
    expect(r).toEqual({ loader: null, modules: [] });
  });

  it('ignores commented-out self-hosted and package-root tags', () => {
    const html = `
<!-- <script src="https://unpkg.com/@stagepass/loader@2"></script> -->
<!-- <script src="/stagepass/loader.min.js"></script> -->
<script src="/other.js"></script>`;
    expect(parseStagepassScripts(html)).toEqual({ loader: null, modules: [] });
  });
});

describe('detectSite', () => {
  it('fetches https without credentials and detects modules', async () => {
    const fetch = vi.fn(async () => htmlResponse(fixture('single.html')));
    const r = await detectSite('app.webflow.io', { fetch });
    expect(r).toMatchObject({ ok: true, url: 'https://app.webflow.io/', list: ['cookies'] });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://app.webflow.io/');
    expect(init).toMatchObject({ method: 'GET', redirect: 'manual', credentials: 'omit' });
    expect(Object.keys(init.headers).map((h) => h.toLowerCase())).not.toContain('cookie');
    expect(Object.keys(init.headers).map((h) => h.toLowerCase())).not.toContain('authorization');
  });

  it('follows up to 3 https redirects', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(redirect('https://www.app.com/'))
      .mockResolvedValueOnce(redirect('/de/', 302))
      .mockResolvedValueOnce(redirect('https://www.app.com/de/home', 308))
      .mockResolvedValueOnce(htmlResponse(fixture('all.html')));
    const r = await detectSite('app.com', { fetch });
    expect(r).toMatchObject({ ok: true, url: 'https://www.app.com/de/home', list: ['all'] });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('stops after more than 3 redirects', async () => {
    const fetch = vi.fn(async () => redirect('https://app.com/again'));
    const r = await detectSite('app.com', { fetch });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/More than 3 redirects/);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('refuses redirects that name an explicit port (including :443)', async () => {
    let r = await detectSite('app.com', { fetch: async () => redirect('https://app.com:443/') });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/port/);
    r = await detectSite('app.com', { fetch: async () => redirect('https://app.com:8443/path') });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/port/);
  });

  it('refuses http and credential redirects', async () => {
    let r = await detectSite('app.com', { fetch: async () => redirect('http://app.com/') });
    expect(r.error).toMatch(/non-https/);
    r = await detectSite('app.com', { fetch: async () => redirect('https://a:b@app.com/') });
    expect(r.error).toMatch(/credentials/);
  });

  it('reports unreachable sites', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('getaddrinfo ENOTFOUND app.invalid');
    });
    const r = await detectSite('app.invalid', { fetch });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not reachable.*ENOTFOUND/);
  });

  it('reports HTTP errors', async () => {
    const r = await detectSite('app.com', { fetch: async () => htmlResponse('nope', 503) });
    expect(r).toMatchObject({ ok: false, error: 'Site answered HTTP 503.' });
  });

  it('times out', async () => {
    const fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
      });
    const r = await detectSite('slow.com', { fetch, timeoutMs: 30 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/did not answer within/);
  });

  it('caps the body size', async () => {
    const big = `<html>${'x'.repeat(5000)}<script src="https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js"></script>`;
    const r = await detectSite('big.com', { fetch: async () => htmlResponse(big), maxBytes: 1000 });
    expect(r).toMatchObject({ ok: true, loader: null });
  });

  it('rejects invalid input before fetching', async () => {
    const fetch = vi.fn();
    const r = await detectSite('http://app.com', { fetch });
    expect(r.ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
