import { createFlag, FLAG_HOOK, type FlagState } from './flag.js';
import { LIVE_HOOK } from './live.js';

const DUP =
  'Multiple assets resolve to local file "%s" without data-stagepass-path. Set unique paths to avoid collisions.';
const VARS_HINT = 'Prefer sp.env()/is()/can()/client()/on() over reading sp.vars directly.';

/**
 * Lazy session chunk: flag UI, live-reload bootstrap, debug vars hint, and duplicate-path warnings.
 * Only requested by the loader while a Stagepass session is active.
 */
try {
  const sp = (window as any).stagepass;
  const hook = sp?.[Symbol.for(FLAG_HOOK)];
  if (typeof hook !== 'function') throw 0;

  hook((state: FlagState) => {
    // One-time debug hint on sp.vars (core keeps a plain writable property until this runs).
    if (state.debug) {
      try {
        const frozen = sp.vars;
        let hinted = false;
        Object.defineProperty(sp, 'vars', {
          configurable: true,
          enumerable: true,
          get() {
            if (!hinted) {
              hinted = true;
              sp.warn(VARS_HINT);
            }
            return frozen;
          },
        });
      } catch (_) {}
    }

    // Live reload: same folder as flag-card.min.js, only during a swap session (not debug).
    if (!state.debug && state.domain) {
      try {
        const LIVE = Symbol.for(LIVE_HOOK);
        const domain = state.domain;
        Object.defineProperty(sp, LIVE, {
          configurable: true,
          value: (start: (opts: {
            url: string;
            localBase: string;
            debug?: boolean;
            log?: (...a: unknown[]) => void;
          }) => void) => {
            delete sp[LIVE];
            try {
              start({
                url: 'https://' + domain + '/__stagepass/live',
                localBase: 'https://' + domain,
                debug: state.debug,
                log: (...a: unknown[]) => sp.log(...a),
              });
            } catch (_) {}
          },
        });
        const live = document.createElement('script');
        live.src = new URL('live.min.js', state.card).href;
        live.async = true;
        // Silent onerror: missing chunk or offline CDN must not spam
        (document.head || document.documentElement).appendChild(live);
      } catch (_) {}
    }

    const warned = new Set<string>();
    const fileOf = (u: string) => (u || '').split(/[?#]/)[0].split('/').pop() || '';
    const checkDups = () => {
      try {
        const counts = new Map<string, number>();
        for (const f of state.f) {
          if (f.x) continue;
          const lp = fileOf(f.local);
          if (!lp) continue;
          const n = (counts.get(lp) || 0) + 1;
          counts.set(lp, n);
          if (n === 2 && !warned.has(lp)) {
            warned.add(lp);
            sp.warn(DUP.replace('%s', lp));
          }
        }
      } catch (_) {}
    };
    // Files may already be tracked before this chunk loads (before createFlag mounts)
    checkDups();
    const render = createFlag(state);

    return () => {
      checkDups();
      render();
    };
  });
} catch (_) {}
