import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import {
  createLiveServer,
  resolveOutputDir,
  classifyChange,
  toUrlPath,
  formatSseEvent,
  LIVE_PATH,
  MAX_CONNECTIONS,
} from '../live-server.js';

describe('resolveOutputDir', () => {
  it('defaults to dist under the project root', () => {
    const r = resolveOutputDir('/Users/dev/Sites/app');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rel).toBe('dist');
      expect(r.abs).toBe(path.resolve('/Users/dev/Sites/app/dist'));
    }
  });

  it('rejects path traversal', () => {
    expect(resolveOutputDir('/Users/dev/Sites/app', '../other').ok).toBe(false);
    expect(resolveOutputDir('/Users/dev/Sites/app', '/etc').ok).toBe(false);
  });
});

describe('classifyChange / toUrlPath / formatSseEvent', () => {
  it('classifies css-only vs reload', () => {
    expect(classifyChange(['/dist/a.css', '/dist/b.css'])).toBe('css');
    expect(classifyChange(['/dist/a.js'])).toBe('reload');
    expect(classifyChange(['/dist/a.css', '/dist/a.js'])).toBe('reload');
  });

  it('maps files under outDir to project-relative URL paths', () => {
    const root = '/Users/dev/Sites/app';
    const out = '/Users/dev/Sites/app/dist';
    expect(toUrlPath('/Users/dev/Sites/app/dist/styles.css', root, out)).toBe(
      '/dist/styles.css'
    );
    expect(toUrlPath('/Users/dev/Sites/other/x.css', root, out)).toBeNull();
    expect(toUrlPath('/Users/dev/Sites/app/dist/.DS_Store', root, out)).toBeNull();
    expect(toUrlPath('/Users/dev/Sites/app/dist/manifest.json', root, out)).toBeNull();
  });

  it('formats SSE data frames', () => {
    expect(formatSseEvent({ type: 'css', paths: ['/dist/a.css'] })).toBe(
      'data: {"type":"css","paths":["/dist/a.css"]}\n\n'
    );
  });
});

describe('createLiveServer', () => {
  let tmp;
  /** @type {Awaited<ReturnType<ReturnType<typeof createLiveServer>['listen']>>|null} */
  let handle = null;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-live-'));
    await fs.ensureDir(path.join(tmp, 'dist'));
  });

  afterEach(async () => {
    if (handle) {
      await handle.close();
      handle = null;
    }
    await fs.remove(tmp);
  });

  it('serves SSE at the fixed path and 404 elsewhere', async () => {
    const server = createLiveServer({ projectRoot: tmp, debounceMs: 10 });
    handle = await server.listen(0);
    const base = `http://127.0.0.1:${handle.port}`;

    const miss = await fetch(`${base}/nope`);
    expect(miss.status).toBe(404);

    const res = await fetch(`${base}${LIVE_PATH}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    // Read first chunk then abort
    const reader = res.body.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain(': connected');
    await reader.cancel();
  });

  it('debounces file changes into one event with relative URL paths', async () => {
    const server = createLiveServer({ projectRoot: tmp, debounceMs: 40 });
    handle = await server.listen(0);
    const events = [];
    const res = await fetch(`http://127.0.0.1:${handle.port}${LIVE_PATH}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const pump = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() || '';
        for (const part of parts) {
          const line = part.split('\n').find((l) => l.startsWith('data: '));
          if (line) events.push(JSON.parse(line.slice(6)));
        }
      }
    })();

    await fs.writeFile(path.join(tmp, 'dist', 'a.css'), 'a{}');
    await fs.writeFile(path.join(tmp, 'dist', 'b.css'), 'b{}');
    await new Promise((r) => setTimeout(r, 120));
    await reader.cancel();
    await pump.catch(() => {});

    expect(events.length).toBeGreaterThanOrEqual(1);
    const last = events[events.length - 1];
    expect(last.type).toBe('css');
    expect(last.paths).toEqual(expect.arrayContaining(['/dist/a.css', '/dist/b.css']));
  });

  it('caps concurrent SSE connections', async () => {
    const server = createLiveServer({
      projectRoot: tmp,
      maxConnections: 2,
      debounceMs: 10,
    });
    handle = await server.listen(0);
    const url = `http://127.0.0.1:${handle.port}${LIVE_PATH}`;
    const a = await fetch(url);
    const b = await fetch(url);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const c = await fetch(url);
    expect(c.status).toBe(503);
    expect(MAX_CONNECTIONS).toBe(32);
    a.body.cancel();
    b.body.cancel();
  });

  it('does not reflect request data into responses', async () => {
    const server = createLiveServer({ projectRoot: tmp });
    handle = await server.listen(0);
    const res = await fetch(
      `http://127.0.0.1:${handle.port}${LIVE_PATH}?q=<script>alert(1)</script>`,
      { headers: { 'X-Evil': '<img>' } }
    );
    const reader = res.body.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).not.toContain('<script>');
    expect(text).not.toContain('<img>');
    expect(text).not.toContain('alert');
    await reader.cancel();
  });

  /**
   * @param {ReadableStreamDefaultReader<Uint8Array>} reader
   * @param {number} ms
   */
  async function collectEvents(reader, ms) {
    const events = [];
    const dec = new TextDecoder();
    let buf = '';
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(resolve, ms);
    });
    const pump = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() || '';
        for (const part of parts) {
          const line = part.split('\n').find((l) => l.startsWith('data: '));
          if (line) events.push(JSON.parse(line.slice(6)));
        }
      }
    })();
    await timeout;
    clearTimeout(timer);
    await reader.cancel();
    await pump.catch(() => {});
    return events;
  }

  it('identical main.js rewrite + real CSS change => css event only', async () => {
    const dist = path.join(tmp, 'dist');
    await fs.writeFile(path.join(dist, 'main.js'), 'console.log(1)');
    await fs.writeFile(path.join(dist, 'styles.css'), 'body{color:red}');
    const server = createLiveServer({ projectRoot: tmp, debounceMs: 40 });
    handle = await server.listen(0);
    const res = await fetch(`http://127.0.0.1:${handle.port}${LIVE_PATH}`);
    const reader = res.body.getReader();
    // Drain the connected comment
    await reader.read();

    await fs.writeFile(path.join(dist, 'main.js'), 'console.log(1)');
    await fs.writeFile(path.join(dist, 'styles.css'), 'body{color:blue}');
    const events = await collectEvents(reader, 180);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('css');
    expect(events[0].paths).toEqual(['/dist/styles.css']);
  });

  it('identical rewrite only => no event', async () => {
    const dist = path.join(tmp, 'dist');
    await fs.writeFile(path.join(dist, 'main.js'), 'console.log(1)');
    const server = createLiveServer({ projectRoot: tmp, debounceMs: 40 });
    handle = await server.listen(0);
    const res = await fetch(`http://127.0.0.1:${handle.port}${LIVE_PATH}`);
    const reader = res.body.getReader();
    await reader.read();

    await fs.writeFile(path.join(dist, 'main.js'), 'console.log(1)');
    const events = await collectEvents(reader, 180);
    expect(events).toEqual([]);
  });

  it('manifest.json change is ignored', async () => {
    const dist = path.join(tmp, 'dist');
    await fs.writeFile(path.join(dist, 'manifest.json'), '{"a":1}\n');
    const server = createLiveServer({ projectRoot: tmp, debounceMs: 40 });
    handle = await server.listen(0);
    const res = await fetch(`http://127.0.0.1:${handle.port}${LIVE_PATH}`);
    const reader = res.body.getReader();
    await reader.read();

    await fs.writeFile(path.join(dist, 'manifest.json'), '{"a":2}\n');
    const events = await collectEvents(reader, 180);
    expect(events).toEqual([]);
  });

  it('JS content change => reload', async () => {
    const dist = path.join(tmp, 'dist');
    await fs.writeFile(path.join(dist, 'main.js'), 'console.log(1)');
    const server = createLiveServer({ projectRoot: tmp, debounceMs: 40 });
    handle = await server.listen(0);
    const res = await fetch(`http://127.0.0.1:${handle.port}${LIVE_PATH}`);
    const reader = res.body.getReader();
    await reader.read();

    await fs.writeFile(path.join(dist, 'main.js'), 'console.log(2)');
    const events = await collectEvents(reader, 180);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('reload');
    expect(events[0].paths).toEqual(['/dist/main.js']);
  });
});
