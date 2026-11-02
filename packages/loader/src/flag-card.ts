/**
 * Dev flag v2, card (stage 3). Lazy chunk (flag-card.min.js), fetched on the first expand.
 * DOM APIs + textContent only: page-controlled strings (console messages, file names)
 * are never parsed as HTML. Opaque surface, 1px border, no shadow, no blur, no filter.
 * Shows little by default: one-line messages and a collapsed file list, details on demand.
 */
import { FLASH } from './flag.js';
import type { FlagApi, FlagCard, FlagFile, FlagMsg } from './flag.js';

const CSS =
  '.cd{--bg:#FFFFFF;--ink:#17171B;--mu:#6D6869;--ln:#9C938E;--sep:#ECE6E2;--hv:#F6F2EF;--cp:#EFE9E4;--live:#C9302A;--err:#C0265A;--wa:#8A5C00;--on:#17171B;--onf:#FFFFFF;' +
  'position:absolute;right:0;top:44px;width:360px;max-width:calc(100vw - 24px);max-height:calc(100vh - 68px);max-height:calc(100dvh - 68px);display:flex;flex-direction:column;box-sizing:border-box;border:1px solid var(--ln);border-radius:12px;background:var(--bg);color:var(--ink);font:400 13px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:0;text-align:left;overflow:hidden;opacity:0;transform:translateY(-4px);transform-origin:100% 0;outline:0}' +
  '.cd.dk{--bg:#18181C;--ink:#F4F2F0;--mu:#A19C9E;--ln:#66666F;--sep:#2C2C32;--hv:#222227;--cp:#2A2A30;--live:#FF6A5E;--err:#FF6B93;--wa:#F2B53A;--on:#F4F2F0;--onf:#17171B}' +
  '.cd.on{opacity:1;transform:none}.cd[hidden],[hidden]{display:none!important}.hd,.ft{flex:none}' +
  '.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}' +
  '.mo{font-family:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace}' +
  '.hd{padding:14px 16px 10px;display:grid;gap:4px;border-bottom:1px solid var(--sep)}' +
  '.r1{display:flex;align-items:center;gap:8px;min-width:0}' +
  '.r1 strong{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}' +
  '.md{margin-left:auto;flex:none;font:700 11px/1 ui-monospace,"SF Mono",Menlo,Consolas,monospace;letter-spacing:.06em;color:var(--live);border:1px solid currentColor;border-radius:999px;padding:3px 7px}' +
  '.kp{display:flex;align-items:center;justify-content:center;flex:none;width:20px;height:10px;border-radius:5px;background:#121215}' +
  '.kp:before{content:"";width:15px;height:5px;border-radius:2.5px;background:linear-gradient(90deg,#FF453A,#FF8A3D)}' +
  '.dm,.hn{font-size:12px;color:var(--mu);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hn{white-space:normal}' +
  '.sc{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain}' +
  '.ds,.it{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;min-height:36px;padding:6px 16px;cursor:pointer}' +
  '.ds{font-size:12px;color:var(--mu)}.ds b{color:var(--ink);font-weight:600}' +
  '.ds:before,.it:before{content:"";flex:none;width:5px;height:5px;border:solid var(--mu);border-width:0 1.5px 1.5px 0;transform:rotate(-45deg);margin:0 2px 0 -1px}' +
  '[aria-expanded=true]:before{transform:rotate(45deg)}' +
  '.ds:hover,.it:hover{background:var(--hv)}' +
  'ul{list-style:none;margin:0;padding:0}' +
  '.fl{padding:0 0 6px}.fl li{display:grid;grid-template-columns:30px minmax(0,1fr) auto;column-gap:8px;padding:3px 16px 3px 31px;font-size:12px}' +
  '.fl .ty,.fl .lv{color:var(--mu)}.fl .lv{grid-column:2/4;font-size:11px}' +
  '.fl .pa,.fl .lv,.tx,.mt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}' +
  '.fl .bad{color:var(--err);font-weight:600}' +
  '.lh{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:8px;padding:6px 12px 6px 16px;border-top:1px solid var(--sep);background:var(--bg);font-size:11px;color:var(--mu)}' +
  '.lh>span:first-child{font-weight:600;letter-spacing:.06em;text-transform:uppercase}' +
  '.lh .ct{margin-right:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}' +
  '.sm{all:unset;box-sizing:border-box;flex:none;display:inline-flex;align-items:center;height:24px;padding:0 8px;border:1px solid var(--sep);border-radius:6px;font:500 11px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);cursor:pointer;white-space:nowrap}' +
  '.sm:hover{background:var(--hv)}.sm[aria-pressed=true]{border-color:var(--ink)}' +
  '.it svg{flex:none;width:14px;height:14px}' +
  '.it.e svg{color:var(--err)}.it.w svg{color:var(--wa)}' +
  '.tx{flex:1}' +
  '.mt{flex:none;font-size:11px;color:var(--mu)}.mt b{color:var(--ink);font-weight:600;margin-right:6px}' +
  '.dt{display:grid;gap:6px;padding:0 16px 10px 53px;font-size:12px}' +
  '.dt .ms{word-break:break-word}.dt .lo{color:var(--mu);font-size:11px;word-break:break-all}' +
  '.dt pre{margin:0;padding:8px;border-radius:6px;background:var(--hv);font:11px/1.45 ui-monospace,"SF Mono",Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-all;max-height:180px;overflow:auto;overscroll-behavior:contain}' +
  '.dt .sm{justify-self:start}' +
  '.em{margin:0;padding:6px 16px 14px;color:var(--mu);font-size:12px}' +
  '.ft{display:flex;align-items:center;gap:8px;padding:10px 12px 12px;border-top:1px solid var(--sep)}' +
  '.bt{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;height:32px;padding:0 12px;border:1px solid var(--ln);border-radius:8px;font:600 13px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);cursor:pointer;white-space:nowrap}' +
  '.bt:hover{background:var(--hv)}' +
  '.bt:disabled{opacity:.45;cursor:not-allowed;background:none;border-style:dashed}' +
  '.end{all:unset;margin-left:auto;padding:8px 4px;font:500 12px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--err);cursor:pointer;white-space:nowrap}' +
  '.end:hover{text-decoration:underline}' +
  '.bt:focus-visible,.end:focus-visible,.sm:focus-visible{outline:2px solid var(--ink);outline-offset:2px}' +
  '.ds:focus-visible,.it:focus-visible{outline:2px solid var(--ink);outline-offset:-2px;border-radius:6px}' +
  '@media (pointer:coarse){.bt,.ds,.it,.sm{min-height:44px}.end{padding:16px 6px}}' +
  '@media (max-width:400px){.ft{gap:6px;padding:8px}.bt{padding:0 10px}}' +
  '@media (prefers-reduced-motion:no-preference){.cd{transition:opacity .1s,transform .1s cubic-bezier(.4,0,1,1)}.cd.on{transition:opacity .16s,transform .16s cubic-bezier(.2,.8,.2,1)}}';

/** Relative luminance of a computed colour, -1 when (nearly) transparent. */
function lum(c: string): number {
  const m = c.match(/[\d.]+/g);
  if (!m || (m.length > 3 && +m[3] < 0.5)) return -1;
  return m.slice(0, 3).reduce((a, x, i) => {
    let v = +x / 255;
    v = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    return a + v * [0.2126, 0.7152, 0.0722][i];
  }, 0);
}

/** Card tone follows the page right behind it; falls back to prefers-color-scheme. */
function isDark(h: HTMLElement): boolean {
  const d = document;
  try {
    const r = h.getBoundingClientRect();
    const els = d.elementsFromPoint(Math.max(8, r.right - 170), r.bottom + 60);
    for (const x of els) {
      if (x == h) continue;
      for (let e: Element | null = x; e; e = e.parentElement) {
        const L = lum(getComputedStyle(e).backgroundColor);
        if (L >= 0) return L < 0.18;
      }
    }
  } catch (_) {}
  return mq('(prefers-color-scheme: dark)');
}

function mq(q: string): boolean {
  try {
    return matchMedia(q).matches;
  } catch (_) {
    return false;
  }
}

const PREV = 'stagepass:prev';
const OPEN = 'stagepass:expand';
const SP = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.sp$/;
const ls = (k: string, v?: string | null): string | null => {
  try {
    if (v === undefined) return localStorage.getItem(k);
    v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
  } catch (_) {}
  return null;
};
const plural = (x: number, w: string) => x + ' ' + w + (x == 1 ? '' : 's');
/** Short display form of a URL: host/…/file for other origins, path for the .sp server */
const short = (u: string, own?: boolean) => {
  try {
    const x = new URL(u);
    const p = x.pathname.split('/').filter(Boolean);
    return own ? '/' + p.join('/') : x.host + (p.length > 2 ? '/…/' : '/') + p.slice(-2).join('/');
  } catch (_) {
    return u;
  }
};
const where = (x: FlagMsg) => (x.url || x.file) + (x.line ? ':' + x.line + (x.col ? ':' + x.col : '') : '');
const label = (x: FlagMsg) => (x.type == 'error' ? 'Error' : 'Warning') + (x.c > 1 ? ' ×' + x.c : '');
const status = (f: FlagFile) => f.st || 'loading';

/** Plain Markdown block for a coding assistant (no cookies, no storage, no query string). */
export function report(s: FlagApi['s'], list: FlagMsg[]): string {
  const L = location;
  const out = [
    '### Stagepass messages',
    '- Page: ' + L.origin + L.pathname,
    '- Project: ' + (s.domain ? s.domain + ' (local files)' : 'debug session (live files)'),
    '- Loader: @stagepass/loader ' + s.v,
  ];
  if (s.f.length) out.push('- Files: ' + s.f.map((f) => short(f.local, true) + ' ' + status(f)).join(', '));
  list.forEach((x, i) => {
    out.push('', '**' + (i + 1) + '. ' + label(x) + '** (last ' + x.time + ')', x.text);
    if (x.src || x.line) out.push('Location: ' + [x.src, where(x)].filter(Boolean).join(' · '));
    if (x.stack) out.push('```', x.stack.replace(/```/g, '` ` `'), '```');
  });
  return out.join('\n');
}

export function createCard(a: FlagApi): FlagCard {
  const d = document;
  const s = a.s;
  a.css(a.root, CSS);
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, parent: Node, cls?: string, text?: string) => {
    const e = parent.appendChild(d.createElement(tag));
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  };
  const btn = (parent: Node, cls: string, text?: string) => {
    const b = el('button', parent, cls, text);
    b.type = 'button';
    return b;
  };
  const setText = (e: HTMLElement, t: string) => {
    if (e.textContent !== t) e.textContent = t;
  };
  const lv = el('span', a.w, 'sr');
  lv.setAttribute('role', 'status');
  lv.setAttribute('aria-live', 'polite');
  const cd = el('div', a.w, 'cd');
  cd.hidden = true;
  cd.tabIndex = -1;
  cd.setAttribute('role', 'dialog');
  cd.setAttribute('aria-label', 'Stagepass session');
  const hd = el('div', cd, 'hd');
  const r1 = el('div', hd, 'r1');
  el('span', r1, 'kp').setAttribute('aria-hidden', 'true');
  const pj = el('strong', r1);
  const md = el('span', r1, 'md');
  const dm = el('div', hd, 'dm mo');
  const hn = el('div', hd, 'hn');
  const sc = el('div', cd, 'sc');
  const ds = btn(sc, 'ds');
  const fl = el('ul', sc, 'fl');
  fl.id = 'sp-files';
  ds.setAttribute('aria-controls', fl.id);
  const lh = el('div', sc, 'lh');
  el('span', lh, '', 'Messages');
  const cnt = el('span', lh, 'ct');
  const ax = btn(lh, 'sm', 'Always expanded');
  const ca = btn(lh, 'sm', 'Copy all');
  const box = el('div', sc);
  const ft = el('div', cd, 'ft');
  const rl = btn(ft, 'bt', 'Reload');
  const db = btn(ft, 'bt');
  const end = btn(ft, 'end', 'End session');
  let filesOpen = false;
  let all = ls(OPEN) == '1';
  // Per-entry open state survives list rebuilds (keyed by group)
  const open = new Map<string, boolean>();
  const key = (x: FlagMsg) => x.type + x.text + x.url + x.line + x.col;
  let sig = '';
  let fsig = '';
  let t: ReturnType<typeof setTimeout> | undefined;

  const copy = (txt: string, b: HTMLElement, done: string) => {
    const ok = () => {
      const o = b.textContent || '';
      b.textContent = done;
      lv.textContent = 'Copied to clipboard';
      setTimeout(() => (b.textContent = o), 1600);
    };
    const fallback = () => {
      const ta = el('textarea', a.root);
      ta.value = txt;
      ta.select();
      try {
        d.execCommand('copy');
      } catch (_) {}
      ta.remove();
      ok();
    };
    try {
      navigator.clipboard.writeText(txt).then(ok, fallback);
    } catch (_) {
      fallback();
    }
  };

  // Debug toggle: reload with ?stagepass=debug, and back to the .sp session it came from.
  // The return target is kept per origin, so it also works from a new tab or a restored session.
  let prev = ls(PREV);
  try {
    prev = prev || sessionStorage.getItem(PREV);
  } catch (_) {}
  if (prev && !SP.test(prev)) prev = null;
  const dbg = s.debug ? prev : 'debug';

  const render = () => {
    const dom = s.domain || location.hostname;
    const name = s.domain ? dom.replace(/\.sp$/, '') : 'Debug session';
    setText(pj, name);
    pj.title = name;
    setText(md, s.debug ? 'DEBUG' : 'LOCAL');
    setText(dm, dom);
    dm.title = dom;
    setText(
      hn,
      s.debug
        ? dbg
          ? 'Live files with console logs. Back to local loads ' + dbg + '.'
          : 'Live files with console logs. No local session to return to: open the page with ?stagepass=<project>.sp'
        : ''
    );
    hn.hidden = !s.debug;
    setText(db, s.debug ? 'Back to local' : 'Debug mode');
    db.title = s.debug ? (dbg ? 'Reload with local files from ' + dbg : 'No local session to return to') : 'Reload with live files and console logs';
    db.disabled = !dbg;

    // Swapped files: one collapsed row, details on demand
    const f = s.f;
    const bad = f.filter((x) => x.st && x.st != 'ok').length;
    const fs = f.map((x) => x.local + x.st).join() + filesOpen;
    ds.hidden = !f.length;
    if (fs != fsig) {
      fsig = fs;
      ds.textContent = '';
      el('b', ds, '', String(s.swapped));
      ds.appendChild(d.createTextNode(' ' + (s.swapped == 1 ? 'file' : 'files') + ' swapped locally' + (bad ? ' · ' + bad + ' failed' : '')));
      ds.setAttribute('aria-expanded', String(filesOpen));
      fl.hidden = !filesOpen;
      fl.textContent = '';
      if (filesOpen)
        f.forEach((x) => {
          const li = el('li', fl);
          li.title = x.live + '\n→ ' + x.local;
          el('span', li, 'ty mo', x.type);
          el('span', li, 'pa mo', short(x.local, true));
          el('span', li, x.st && x.st != 'ok' ? 'bad' : '', status(x));
          el('span', li, 'lv mo', 'live ' + short(x.live));
        });
    }

    const [v, e] = s.n;
    const m = s.m;
    const shown = m.reduce((n, x) => n + x.c, 0);
    setText(
      cnt,
      v + e > shown ? v + e + ' total, latest ' + m.length + ' shown' : plural(e, 'error') + ' · ' + plural(v, 'warning')
    );
    ax.setAttribute('aria-pressed', String(all));
    ca.hidden = !m.length;
    // Rebuild the list only when messages changed (keeps focus and open entries)
    const ms = m.map((x) => key(x) + x.c).join('|') + all;
    if (ms == sig) return;
    sig = ms;
    const fk = a.root.activeElement && (a.root.activeElement as HTMLElement).dataset.k;
    box.textContent = '';
    if (!m.length) {
      el('p', box, 'em', 'No warnings or errors in this session.');
      return;
    }
    const ul = el('ul', box);
    for (let i = m.length - 1; i >= 0; i--) {
      const x = m[i];
      const k = key(x);
      const er = x.type == 'error';
      const li = el('li', ul);
      const b = btn(li, 'it ' + (er ? 'e' : 'w'));
      b.dataset.k = k;
      b.appendChild(a.icon(er ? 1 : 0));
      const tx = el('span', b, 'tx');
      el('span', tx, 'sr', er ? 'Error: ' : 'Warning: ');
      tx.appendChild(d.createTextNode(x.text));
      const mt = el('span', b, 'mt mo');
      if (x.c > 1) el('b', mt, '', '×' + x.c);
      mt.appendChild(d.createTextNode(x.time));
      const dt = el('div', li, 'dt');
      el('div', dt, 'ms', x.text);
      if (x.src || x.line) {
        const lo = el('div', dt, 'lo mo', [x.src, where(x)].filter(Boolean).join(' · '));
        lo.title = where(x);
      }
      if (x.stack) el('pre', dt, '', x.stack);
      const cp = btn(dt, 'sm', 'Copy');
      cp.addEventListener('click', () => copy(report(s, [x]), cp, 'Copied'));
      const set = (o: boolean) => {
        b.setAttribute('aria-expanded', String(o));
        dt.hidden = !o;
      };
      set(open.has(k) ? !!open.get(k) : all);
      b.addEventListener('click', () => {
        const o = b.getAttribute('aria-expanded') != 'true';
        open.set(k, o);
        set(o);
      });
      if (fk === k) b.focus({ preventScroll: true });
    }
  };

  ds.addEventListener('click', () => {
    filesOpen = !filesOpen;
    render();
  });
  ax.addEventListener('click', () => {
    all = !all;
    ls(OPEN, all ? '1' : null);
    open.clear();
    render();
  });
  ca.addEventListener('click', () => copy(report(s, s.m.slice().reverse()), ca, 'Copied'));
  rl.addEventListener('click', () => location.reload());
  db.addEventListener('click', () => {
    if (!dbg) return;
    if (s.domain) ls(PREV, s.domain);
    try {
      if (s.domain) sessionStorage.setItem(PREV, s.domain);
      sessionStorage.setItem(FLASH, '1');
    } catch (_) {}
    const u = new URL(location.href);
    u.searchParams.set('stagepass', dbg);
    location.href = u.href;
  });
  end.addEventListener('click', () => s.end());

  return {
    render,
    show() {
      clearTimeout(t);
      render();
      cd.classList.toggle('dk', isDark(a.host));
      cd.hidden = false;
      void cd.offsetWidth;
      cd.classList.add('on');
      cd.focus({ preventScroll: true });
    },
    hide() {
      cd.classList.remove('on');
      t = setTimeout(() => (cd.hidden = true), mq('(prefers-reduced-motion: reduce)') ? 0 : 110);
    },
  };
}
