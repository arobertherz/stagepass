/**
 * Dev flag ("Tally Pass"): red pill with a pass mark, the session label and
 * compact warning/error counters. Rendered in a shadow root so page CSS cannot
 * restyle it. Built with DOM APIs + textContent only (no innerHTML, no inline
 * handlers, no eval). Styles use a constructable stylesheet, so a strict
 * `style-src` CSP does not block them (`<style>` fallback on old browsers).
 */
const CSS =
  ':host{all:initial!important;position:fixed!important;top:10px!important;right:10px!important;z-index:2147483647!important;display:block!important}' +
  'button{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:6px;height:24px;padding:0 9px 0 8px;border-radius:99px;background:linear-gradient(90deg,#FF453A,#FF8A3D);color:#fff;font:700 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.06em;white-space:nowrap;cursor:pointer;user-select:none;-webkit-user-select:none;box-shadow:0 0 14px 2px rgba(255,138,61,.55),0 0 36px 6px rgba(255,69,58,.28),inset 0 1px 0 rgba(255,255,255,.22)}' +
  'button:focus-visible{outline:2px solid #fff;outline-offset:2px}' +
  'i{position:relative;width:9px;height:13px;border-radius:2.5px;background:#fff}' +
  'i:before,i:after{content:"";position:absolute;left:2px;border-radius:1px}' +
  'i:before{top:2px;width:5px;height:2px;background:#FF453A;box-shadow:0 0 3px 1px #FF8A3D}' +
  'i:after{bottom:2px;width:5px;height:1px;background:#121215;opacity:.45;box-shadow:0 -2px #121215}' +
  'span{display:flex;align-items:center;gap:3px;height:16px;padding:0 5px 0 4px;border-radius:99px;background:rgba(18,18,21,.3)}' +
  'span:before{content:"";width:9px;height:8px;background:#fff;clip-path:polygon(50% 0,100% 100%,0 100%)}' +
  '.e:before{width:8px;clip-path:polygon(30% 0,70% 0,100% 30%,100% 70%,70% 100%,30% 100%,0 70%,0 30%)}' +
  '[hidden]{display:none}' +
  '@media (prefers-reduced-motion:no-preference){button{animation:a .45s cubic-bezier(.2,.9,.3,1.2)}i:before{animation:b 1s .15s both}}' +
  '@keyframes a{from{opacity:0;transform:translateY(-30px)}}' +
  '@keyframes b{0%{opacity:0}60%{opacity:1;transform:scale(1.4)}}';

/** Counter state owned by the loader: `n[0]` warnings, `n[1]` errors, `tip` extra hint. */
export type FlagState = { n: number[]; tip: string };

/**
 * Contract between loader and `flag.min.js` (keep stable within a major):
 * the loader defines `stagepass[Symbol.for('stagepass.flag')]`, the flag chunk
 * calls it with `createFlag`, the loader keeps the returned `render` function.
 */
export type CreateFlag = typeof createFlag;

/**
 * Create and mount the dev flag. Returns a render function (call after state changes).
 *
 * @param label - Visible label (`LOCAL` or `DEBUG`)
 * @param domain - Session domain shown in the tooltip
 * @param state - Live counter state
 * @param onClick - Click handler (disconnect)
 */
export function createFlag(
  label: string,
  domain: string | null,
  state: FlagState,
  onClick: () => void
): () => void {
  const d = document;
  const el = d.createElement('div');
  el.id = 'stagepass-flag';
  const root = el.attachShadow({ mode: 'open' });
  try {
    if (!('adoptedStyleSheets' in root)) throw 0;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    root.adoptedStyleSheets = [sheet];
  } catch (_) {
    const style = root.appendChild(d.createElement('style'));
    style.textContent = CSS;
  }
  const add = <K extends keyof HTMLElementTagNameMap>(tag: K, parent: Node) =>
    parent.appendChild(d.createElement(tag));
  const b = add('button', root);
  b.type = 'button';
  add('i', b);
  add('b', b).textContent = label;
  const chips = [add('span', b), add('span', b)];
  chips[1].className = 'e';
  const render = () => {
    const n = state.n;
    const parts = ['Stagepass ' + label + (domain ? ' · ' + domain : '')];
    if (n[0]) parts.push(n[0] + ' warning' + (n[0] > 1 ? 's' : ''));
    if (n[1]) parts.push(n[1] + ' error' + (n[1] > 1 ? 's' : ''));
    if (state.tip) parts.push(state.tip);
    parts.push('Click to disconnect');
    const t = parts.join('\n');
    b.title = t;
    b.setAttribute('aria-label', t);
    chips.forEach((c, i) => {
      c.hidden = !n[i];
      c.textContent = n[i] > 99 ? '99+' : String(n[i]);
    });
  };
  render();
  b.addEventListener('click', onClick);
  const mount = () => {
    if (!el.isConnected) (d.body || d.documentElement).appendChild(el);
  };
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', mount);
  else mount();
  return render;
}
