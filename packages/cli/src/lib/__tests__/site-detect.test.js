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
    ['*.webflow.io', /./],
    ['', /No live site/],
    ['javascript:alert(1)', /./],
  ])('rejects %s', (input, re) => {
    const r = normalizeSiteUrl(input);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(re);
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

describe('normalizeSiteUrl: any explicit port is rejected (AC-22)', () => {
  const withPort = [
    'example.com:443',
    'https://example.com:443',
    'https://example.com:443/pfad',
    'EXAMPLE.com:443',
    'example.com:0443',
    'example.com:8443',
    'https://example.com:8443/pfad',
    '[::1]:443',
    'https://[::1]:443/',
    'https://[2001:db8::1]:8443/',
  ];

  it.each(withPort)('rejects %s', (input) => {
    const r = normalizeSiteUrl(input);
    expect(r.ok).toBe(false);
    expect(r.error).toEqual(expect.any(String));
  });

  it.each(withPort)('detectSite(%s) never fetches', async (input) => {
    const fetch = vi.fn(async () => htmlResponse(fixture('single.html')));
    const r = await detectSite(input, { fetch });
    expect(r.ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    'example.com:',
    'https://example.com:/',
    'HTTPS://EXAMPLE.COM:443/',
    ' example.com:443 ',
    'https://user@example.com:443/',
    'https:\\\\example.com:443/',
  ])('rejects %s and names the port as the reason', (input) => {
    const r = normalizeSiteUrl(input);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/port/);
  });

  it.each(['example.com', 'https://example.com', 'https://example.com/'])(
    'still accepts %s',
    (input) => {
      expect(normalizeSiteUrl(input)).toMatchObject({ ok: true });
    },
  );
});
