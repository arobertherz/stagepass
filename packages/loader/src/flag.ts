/**
 * Dev flag v2, pill (stage 1 rest, stage 2 expanded). The card (stage 3) lives in
 * flag-card.min.js and is fetched on the first expand. Rendered in a shadow root so
 * page CSS cannot restyle it. Built with DOM APIs + textContent only (no innerHTML,
 * no inline handlers, no eval). Styles use a constructable stylesheet, so a strict
 * `style-src` CSP does not block them (`<style>` fallback on old browsers).
 */
// No glow, no shadows, no blur, no filters in any state. Only transform and opacity animate.
// The pill is three layers anchored right (left cap, gradient middle, right cap), so the
// rest/expanded switch never animates width and the rounded ends stay round.
// Pill text colour is one token (--fg).
const CSS =
  ':host{all:initial!important;position:fixed!important;top:12px!important;right:12px!important;z-index:2147483647!important;display:block!important}' +
  '.w{--W:44px;--k:1;--fg:#17171B;--a:#FF453A;--z:#FF8A3D;--ring:#121215;--bd:rgba(18,18,21,.22);position:relative;display:block;font:700 12px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.04em;color:var(--fg)}' +
  '.b{all:unset;box-sizing:border-box;position:relative;display:block;margin-left:auto;height:44px;width:var(--W);cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}' +
  '[data-st=rest] .b{width:44px}' +
  '.bg,.t,.fr{position:absolute;right:0;top:8px;height:28px;box-sizing:border-box}' +
  '.bg{width:var(--W);transform-origin:100% 50%}' +
  '.bg i{position:absolute;top:0;height:28px;box-sizing:border-box;border:solid var(--bd);border-width:1px 0}' +
  '.bg .l{left:0;width:14px;border-left-width:1px;border-radius:14px 0 0 14px;background:var(--a)}' +
  '.bg .r{right:0;width:14px;border-right-width:1px;border-radius:0 14px 14px 0;background:var(--z)}' +
  '.m{left:13px;right:13px;background:linear-gradient(90deg,var(--a),var(--z));transform-origin:100% 0}' +
  '[data-st=rest] .l{transform:translateX(calc(var(--W) - 44px))}' +
  '[data-st=rest] .m{transform:scaleX(var(--k))}' +
  '.t{display:flex;align-items:center;gap:10px;padding:0 14px;white-space:nowrap;pointer-events:none}' +
  '[data-st=rest] .t>b,[data-st=rest] .c{opacity:0}' +
  '.c{display:flex;gap:10px}.c:empty{display:none}' +
  '.c span{display:flex;align-items:center;gap:4px}' +
  'svg{flex:none;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}' +
  '.c svg{width:12px;height:12px}' +
  '.k{width:16px;height:8px;stroke-width:2}' +
  '.dot{position:absolute;right:-1px;top:3px;width:8px;height:8px;border-radius:50%;border:2px solid var(--ring);background:var(--d);opacity:0}' +
  '[data-d=e] .dot{--d:#FF2E4D}[data-d=w] .dot{--d:#FFB224}' +
  '[data-st=rest][data-d] .dot{opacity:1}' +
  '.fr{right:-4px;top:4px;height:36px;width:calc(var(--W) + 8px);border-radius:18px;border:2px solid #fff;outline:2px solid var(--ring);opacity:0;pointer-events:none}' +
  '.b:focus-visible .fr{opacity:1}' +
  '[data-st=rest] .fr{width:52px}' +
  '.b:active .bg{transform:scale(.96)}' +
  '@media (prefers-reduced-motion:no-preference){' +
  '.l,.m{transition:transform .22s cubic-bezier(.2,.8,.2,1)}' +
  '.t>b,.c{transition:opacity .14s .06s}' +
  '[data-st=rest] .l,[data-st=rest] .m{transition:transform .16s cubic-bezier(.4,0,.6,1)}' +
  '[data-st=rest] .t>b,[data-st=rest] .c{transition:opacity .08s}' +
  '.dot{transition:opacity .12s}[data-st=rest] .dot{transition-delay:.12s}' +
  '.fr{transition:opacity .12s .12s}.bg{transition:transform .08s}}';

const NS = 'http://www.w3.org/2000/svg';
// 12x12 icons: [0] triangle = warning, [1] octagon = error
const ICONS = ['M6 1.3 11 10.3H1zM6 4.8v2.2m0 1.6v.1', 'M4 1h4l3 3v4l-3 3H4L1 8V4zM6 3.8v2.6m0 1.6v.1'];

/** One captured warning or error, grouped by type, text and location (rendered as text only). */
export type FlagMsg = {
  type: 'warn' | 'error';
  /** Time of the latest occurrence */
  time: string;
  /** local (.sp file), live (other readable script), external (sanitized cross-origin), '' unknown */
  src: string;
  file: string;
  url: string;
  line: string;
  col: string;
  text: string;
  stack: string;
  /** Occurrences */
  c: number;
};
/** One swapped file. st: '' pending, 'ok', HTTP status like '404', or 'failed' (network). x: path was explicit. */
export type FlagFile = { live: string; local: string; type: 'js' | 'css'; st: string; x?: boolean };

/** State owned by the loader. `n` = totals [warnings, errors], `m` = latest messages (capped). */
export type FlagState = {
  n: number[];
  m: FlagMsg[];
  f: FlagFile[];
  /** Files that loaded from the local server */
  swapped: number;
  /** Loader version */
  v: string;
  debug: boolean;
  domain: string | null;
  /** URL of flag-card.min.js (same pinned path as the loader) */
  card: string;
  /** Shared domain guard (from loader) — card must not re-bundle isValidDomain */
  vd: (d: string) => boolean;
  /** End session: the only action that disconnects */
  end: () => void;
};

export type FlagStage = 'rest' | 'exp' | 'card';

/** What the card chunk gets from the pill. */
export type FlagApi = {
  s: FlagState;
  root: ShadowRoot;
  w: HTMLElement;
  host: HTMLElement;
  go: (st: FlagStage) => void;
  icon: (i: number) => SVGSVGElement;
  css: (root: ShadowRoot, css: string) => void;
};
export type FlagCard = { render: () => void; show: () => void; hide: () => void };
export type CreateCard = (api: FlagApi) => FlagCard;
/** Loader hook contract (versioned symbol, so mismatched cached chunks simply do nothing). */
export type CreateFlag = typeof createFlag;
export const FLAG_HOOK = 'stagepass.flag.v2';
/** Set by the Debug toggle before it reloads: the pill expands once to show the new mode */
export const FLASH = 'stagepass:flash';
export const CARD_HOOK = 'stagepass.card.v2';

export function addCss(root: ShadowRoot, css: string): void {
  try {
    if (!('adoptedStyleSheets' in root)) throw 0;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
  } catch (_) {
    root.appendChild(document.createElement('style')).textContent = css;
  }
}

function icon(i: number): SVGSVGElement {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 12 12');
  s.setAttribute('aria-hidden', 'true');
  s.appendChild(document.createElementNS(NS, 'path')).setAttribute('d', ICONS[i]);
  return s;
}

const plural = (x: number, w: string) => x + ' ' + w + (x == 1 ? '' : 's');
const is = (e: Element, sel: string) => {
  try {
    return e.matches(sel);
  } catch (_) {
    return false;
  }
};

/** Create and mount the dev flag. Returns a render function (call after state changes). */
export function createFlag(s: FlagState): () => void {
  const d = document;
  const host = d.createElement('div');
  host.id = 'stagepass-flag';
  const root = host.attachShadow({ mode: 'open' });
  addCss(root, CSS);
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, parent: Node, cls?: string) => {
    const e = parent.appendChild(d.createElement(tag));
    if (cls) e.className = cls;
    return e;
  };
  const w = el('div', root, 'w');
  w.setAttribute('data-st', 'rest');
  const b = el('button', w, 'b');
  b.type = 'button';
  b.setAttribute('aria-haspopup', 'dialog');
  b.setAttribute('aria-expanded', 'false');
  const bg = el('span', b, 'bg');
  ['l', 'm', 'r'].forEach((c) => el('i', bg, c));
  el('span', b, 'fr');
  const t = el('span', b, 't');
  bg.setAttribute('aria-hidden', 'true');
  t.setAttribute('aria-hidden', 'true');
  const lab = el('b', t);
  const c = el('span', t, 'c');
  const k = t.appendChild(d.createElementNS(NS, 'svg'));
  k.setAttribute('class', 'k');
  k.setAttribute('viewBox', '0 0 16 8');
  k.appendChild(d.createElementNS(NS, 'path')).setAttribute('d', 'M4 1h8a3 3 0 0 1 0 6H4a3 3 0 0 1 0-6z');
  el('i', b, 'dot');

  let st: FlagStage = 'rest';
  let card: FlagCard | null = null;
  let loading = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let touch = false;
  let pre: FlagStage = 'rest';
  let quiet = false;

  const render = () => {
    const [v, e] = s.n;
    const l = s.debug ? 'DEBUG' : 'LOCAL';
    lab.textContent = l;
    c.textContent = '';
    [v, e].forEach((x, i) => {
      if (!x) return;
      const g = el('span', c);
      g.appendChild(icon(i));
      g.appendChild(d.createTextNode(x > 99 ? '99+' : String(x)));
    });
    if (e || v) w.setAttribute('data-d', e ? 'e' : 'w');
    else w.removeAttribute('data-d');
    b.setAttribute(
      'aria-label',
      'Stagepass ' + l + ', ' + plural(v, 'warning') + ', ' + plural(e, 'error') + '. ' +
        (st == 'card' ? 'Hide' : 'Show') + ' session details'
    );
    const x = t.offsetWidth;
    if (x) {
      w.style.setProperty('--W', x + 'px');
      w.style.setProperty('--k', String(18 / (x - 26)));
    }
    if (card) card.render();
  };

  const load = () => {
    if (loading) return;
    loading = true;
    try {
      const sp = (window as any).stagepass;
      const H = Symbol.for(CARD_HOOK);
      Object.defineProperty(sp, H, {
        configurable: true,
        value: (create: CreateCard) => {
          delete sp[H];
          try {
            card = create(api);
            if (st == 'card') card.show();
          } catch (_) {}
        },
      });
      const sc = d.createElement('script');
      sc.src = s.card;
      sc.async = true;
      (d.head || d.documentElement).appendChild(sc);
    } catch (_) {}
  };

  const go = (n: FlagStage) => {
    if (n == st) return;
    clearTimeout(timer);
    st = n;
    w.setAttribute('data-st', n);
    b.setAttribute('aria-expanded', String(n == 'card'));
    if (n != 'rest') load();
    if (card) n == 'card' ? card.show() : card.hide();
    render();
  };

  const api: FlagApi = { s, root, w, host, go, icon, css: addCss };

  b.addEventListener('pointerdown', (e) => {
    touch = e.pointerType == 'touch';
    pre = st;
  });
  b.addEventListener('pointerenter', (e) => {
    if (e.pointerType == 'mouse' && st == 'rest') go('exp');
  });
  w.addEventListener('pointerleave', (e) => {
    if (e.pointerType == 'mouse' && st == 'exp' && !is(b, ':focus-visible')) go('rest');
  });
  b.addEventListener('focus', () => {
    if (!touch && !quiet && st == 'rest') go('exp');
  });
  b.addEventListener('blur', () => {
    if (st == 'exp' && !is(b, ':hover')) go('rest');
  });
  b.addEventListener('click', () => {
    // Touch: first tap expands (collapses again after 4 s), second tap opens the card
    if (touch && pre == 'rest') {
      go('exp');
      timer = setTimeout(() => go('rest'), 4e3);
    } else go(st == 'card' ? 'exp' : 'card');
    touch = false;
  });
  d.addEventListener('keydown', (e) => {
    if (e.key != 'Escape' || st == 'rest') return;
    if (st == 'card') {
      go('exp');
      b.focus();
    } else go('rest');
  });
  d.addEventListener(
    'pointerdown',
    (e) => {
      if (st == 'rest' || e.composedPath().indexOf(host) >= 0) return;
      const had = d.activeElement == host;
      go('rest');
      // Focus goes back to the pill unless the click moved it somewhere on the page
      if (had)
        setTimeout(() => {
          const a = d.activeElement;
          if (!a || a == d.body || a == host) {
            quiet = true;
            b.focus({ preventScroll: true });
            quiet = false;
          }
        });
    },
    true
  );

  const mount = () => {
    if (!host.isConnected) (d.body || d.documentElement).appendChild(host);
    render();
    try {
      if (sessionStorage.getItem(FLASH)) {
        sessionStorage.removeItem(FLASH);
        go('exp');
        timer = setTimeout(() => go('rest'), 3e3);
      }
    } catch (_) {}
  };
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', mount);
  else mount();
  render();
  return render;
}
