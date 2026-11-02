/**
 * Dev flag v2, card (stage 3). Lazy chunk (flag-card.min.js), fetched on the first expand.
 * DOM APIs + textContent only: page-controlled strings (console messages, file names)
 * are never parsed as HTML. Opaque surface, 1px border, no shadow, no blur, no filter.
 */
import type { FlagApi, FlagCard, FlagMsg } from './flag.js';

const CSS =
  '.cd{--bg:#FFFFFF;--ink:#17171B;--mu:#6D6869;--ln:#9C938E;--sep:#ECE6E2;--hv:#F6F2EF;--cp:#EFE9E4;--live:#C9302A;--err:#C0265A;--wa:#8A5C00;--on:#17171B;--onf:#FFFFFF;' +
  'position:absolute;right:0;top:44px;width:340px;max-width:calc(100vw - 24px);max-height:calc(100vh - 68px);display:flex;flex-direction:column;box-sizing:border-box;border:1px solid var(--ln);border-radius:12px;background:var(--bg);color:var(--ink);font:400 13px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:0;text-align:left;overflow:hidden;opacity:0;transform:translateY(-4px);transform-origin:100% 0;outline:0}' +
  '.cd.dk{--bg:#18181C;--ink:#F4F2F0;--mu:#A19C9E;--ln:#66666F;--sep:#2C2C32;--hv:#222227;--cp:#2A2A30;--live:#FF6A5E;--err:#FF6B93;--wa:#F2B53A;--on:#F4F2F0;--onf:#17171B}' +
  '.cd.on{opacity:1;transform:none}.cd[hidden]{display:none}.hd,.lh,.ft,.em{flex:none}' +
  '.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}' +
  '.mo{font-family:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace}' +
  '.hd{padding:14px 16px 12px;display:grid;gap:4px}' +
  '.r1{display:flex;align-items:center;gap:8px;min-width:0}' +
  '.r1 strong{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}' +
  '.md{margin-left:auto;flex:none;font:700 11px/1 ui-monospace,"SF Mono",Menlo,Consolas,monospace;letter-spacing:.06em;color:var(--live);border:1px solid currentColor;border-radius:999px;padding:3px 7px}' +
  '.kp{display:flex;align-items:center;justify-content:center;flex:none;width:20px;height:10px;border-radius:5px;background:#121215}' +
  '.kp:before{content:"";width:15px;height:5px;border-radius:2.5px;background:linear-gradient(90deg,#FF453A,#FF8A3D)}' +
  '.dm{font-size:12px;color:var(--mu);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
  '.sw{font-size:12px;color:var(--mu)}.sw b{color:var(--ink);font-weight:600}' +
  '.lh{display:flex;justify-content:space-between;gap:8px;padding:8px 16px 6px;border-top:1px solid var(--sep);font-size:11px;color:var(--mu)}' +
  '.lh span:first-child{font-weight:600;letter-spacing:.06em;text-transform:uppercase}' +
  'ul{list-style:none;margin:0;padding:0 0 6px;max-height:264px;min-height:40px;flex:0 1 auto;overflow:auto;overscroll-behavior:contain}' +
  '.it{all:unset;box-sizing:border-box;display:grid;grid-template-columns:14px minmax(0,1fr);column-gap:10px;row-gap:3px;width:100%;padding:8px 16px;cursor:copy}' +
  '.it:hover{background:var(--hv)}' +
  '.it:focus-visible{outline:2px solid var(--ink);outline-offset:-2px;border-radius:6px}' +
  '.it svg{width:14px;height:14px;grid-row:1/3;margin-top:1px}' +
  '.it.e svg{color:var(--err)}.it.w svg{color:var(--wa)}' +
  '.tx{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}' +
  '.mt,.ok{font-size:11px;color:var(--mu);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
  '.ok{display:none;color:var(--ink);font-weight:600}' +
  '.it.cp{background:var(--cp)}.it.cp .mt{display:none}.it.cp .ok{display:block}' +
  '.em{margin:0;padding:6px 16px 14px;color:var(--mu);font-size:12px}' +
  '.ft{display:flex;align-items:center;gap:8px;padding:10px 12px 12px;border-top:1px solid var(--sep)}' +
  '.bt{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border:1px solid var(--ln);border-radius:8px;font:600 13px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);cursor:pointer;white-space:nowrap}' +
  '.bt:hover{background:var(--hv)}' +
  '.bt:disabled{opacity:.5;cursor:default;background:none}' +
  '.bt[aria-pressed=true]{background:var(--on);border-color:var(--on);color:var(--onf)}' +
  '.bt i{width:6px;height:6px;border-radius:50%;border:1.5px solid currentColor}' +
  '.bt[aria-pressed=true] i{background:currentColor}' +
  '.end{all:unset;margin-left:auto;padding:8px 4px;font:500 12px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--err);cursor:pointer;white-space:nowrap}' +
  '.end:hover{text-decoration:underline}' +
  '.bt:focus-visible,.end:focus-visible{outline:2px solid var(--ink);outline-offset:2px}' +
  '@media (pointer:coarse){.bt{height:44px}.end{padding:16px 6px}.it{padding:10px 16px}}' +
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
  const sw = el('div', hd, 'sw');
  const lh = el('div', cd, 'lh');
  el('span', lh, '', 'Messages');
  const cnt = el('span', lh);
  const ls = el('div', cd);
  const ft = el('div', cd, 'ft');
  const rl = btn(ft, 'bt', 'Reload');
  const db = btn(ft, 'bt');
  const end = btn(ft, 'end', 'End session');
  let last: FlagMsg | null | undefined;
  let len = -1;
  let t: ReturnType<typeof setTimeout> | undefined;

  const copy = (x: FlagMsg, b: HTMLElement) => {
    const txt = '[' + x.type + '] ' + x.time + (x.src ? ' ' + x.src + (x.line ? ':' + x.line : '') : '') + ' ' + x.text;
    const ok = () => {
      b.classList.add('cp');
      lv.textContent = 'Copied to clipboard';
      setTimeout(() => b.classList.remove('cp'), 1600);
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

  const render = () => {
    const dom = s.domain || location.hostname;
    const name = s.domain ? dom.replace(/\.sp$/, '') : 'Debug session';
    pj.textContent = pj.title = name;
    md.textContent = s.debug ? 'DEBUG' : 'LOCAL';
    dm.textContent = dm.title = dom;
    sw.textContent = '';
    el('b', sw, '', String(s.swapped));
    sw.appendChild(d.createTextNode(' file' + (s.swapped == 1 ? '' : 's') + ' swapped locally'));
    const [v, e] = s.n;
    const m = s.m;
    cnt.textContent =
      v + e > m.length
        ? v + e + ' total, latest ' + m.length + ' shown'
        : e + ' error' + (e == 1 ? '' : 's') + ' · ' + v + ' warning' + (v == 1 ? '' : 's');
    db.textContent = '';
    el('i', db);
    db.appendChild(d.createTextNode('Debug ' + (s.debug ? 'on' : 'off')));
    db.setAttribute('aria-pressed', String(s.debug));
    db.disabled = !dbg;
    // Rebuild the list only when messages changed (keeps focus and the copied state)
    if (m.length == len && m[m.length - 1] === last) return;
    len = m.length;
    last = m[len - 1];
    ls.textContent = '';
    if (!len) {
      el('p', ls, 'em', 'No warnings or errors in this session.');
      return;
    }
    const ul = el('ul', ls);
    for (let i = len - 1; i >= 0; i--) {
      const x = m[i];
      const er = x.type == 'error';
      const b = btn(el('li', ul), 'it ' + (er ? 'e' : 'w'));
      b.appendChild(a.icon(er ? 1 : 0));
      const tx = el('span', b, 'tx');
      el('span', tx, 'sr', er ? 'Error: ' : 'Warning: ');
      tx.appendChild(d.createTextNode(x.text));
      el('span', b, 'mt mo', x.time + (x.src ? ' · ' + x.src + (x.line ? ':' + x.line : '') : ''));
      el('span', b, 'ok', 'Copied to clipboard');
      b.addEventListener('click', () => copy(x, b));
    }
  };

  // Debug toggle: reload with ?stagepass=debug, and back to the .sp session it came from
  let prev: string | null = null;
  try {
    prev = sessionStorage.getItem(PREV);
  } catch (_) {}
  const dbg = s.debug ? prev : 'debug';
  rl.addEventListener('click', () => location.reload());
  db.addEventListener('click', () => {
    if (!dbg) return;
    try {
      if (s.domain) sessionStorage.setItem(PREV, s.domain);
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
