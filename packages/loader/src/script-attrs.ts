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
