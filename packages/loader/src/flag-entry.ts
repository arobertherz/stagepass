import { createFlag } from './flag.js';

// Lazy dev chunk: only requested by the loader while a Stagepass session is active.
try {
  const hook = (window as any).stagepass?.[Symbol.for('stagepass.flag')];
  if (typeof hook === 'function') hook(createFlag);
} catch (_) {}
