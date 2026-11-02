import { createCard } from './flag-card.js';
import { CARD_HOOK } from './flag.js';

// Lazy dev chunk: requested by the flag pill on the first expand.
try {
  const hook = (window as any).stagepass?.[Symbol.for(CARD_HOOK)];
  if (typeof hook === 'function') hook(createCard);
} catch (_) {}
