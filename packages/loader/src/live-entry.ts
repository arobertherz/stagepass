import { LIVE_HOOK, startLiveReload } from './live.js';

// Lazy live-reload chunk: requested by the loader only while a swap session is active.
try {
  const hook = (window as any).stagepass?.[Symbol.for(LIVE_HOOK)];
  if (typeof hook === 'function') hook(startLiveReload);
} catch (_) {}
