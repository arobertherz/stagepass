/**
 * Apply async/defer so dynamically inserted classic scripts keep document order.
 * Dynamically created scripts default to async=true; force async=false unless
 * the original had async. Preserve existing async/defer; add defer when neither
 * was set (same behaviour as Stagepass 1.x for order vs DOM parse).
 *
 * @param script - Newly created script element
 * @param source - Original element whose attributes are copied
 */
export function applyScriptLoadOrder(
  script: HTMLScriptElement,
  source: Element
): void {
  const hadAsync = source.hasAttribute('async');
  const hadDefer = source.hasAttribute('defer');

  if (hadAsync) {
    script.async = true;
  } else {
    // Critical: keep insertion order for classic scripts
    script.async = false;
    if (!hadDefer) {
      script.defer = true;
    }
  }
}

export const NOCACHE_ATTR = 'data-stagepass-nocache';

/**
 * Per-asset permanent cache busting (opt-in, production only): exactly one fresh
 * `?_cb=<ts>` on every page view, for every visitor (not just during a Stagepass
 * session). An existing `_cb` in the asset URL is replaced, so the page cannot
 * keep a stale value and a second `_cb` is never appended. Unlike
 * `data-stagepass-cachebust` (legacy, no-op in production), this is scoped to
 * exactly the tagged element.
 *
 * Boolean attribute semantics: present (any value, including `""`) = on;
 * explicit `="false"` = off. `="true"` also reads as on.
 *
 * @param el - Asset element (`script[data-src]` / `link[data-href]`)
 */
export function isNoCacheEnabled(el: Element): boolean {
  if (!el.hasAttribute(NOCACHE_ATTR)) return false;
  return el.getAttribute(NOCACHE_ATTR) !== 'false';
}
