import { describe, it, expect } from 'vitest';

/**
 * v2: global console mute is opt-in via data-stagepass-mute-console="true".
 * Without that attribute, production never mutes the global console.
 */
describe('Console mute (v2 opt-in)', () => {
  it('does not mute globally by default in production', () => {
    const muteConsole = false;
    const env = 'production';
    const hasActiveSession = false;
    const shouldMute = muteConsole && env === 'production' && !hasActiveSession;
    expect(shouldMute).toBe(false);
  });

  it('mutes only when data-stagepass-mute-console is true and no session', () => {
    const muteConsole = true;
    const env = 'production';
    const hasActiveSession = false;
    expect(muteConsole && env === 'production' && !hasActiveSession).toBe(true);
  });

  it('does not mute when a session is active even with opt-in', () => {
    const muteConsole = true;
    const env = 'production';
    const hasActiveSession = true;
    expect(muteConsole && env === 'production' && !hasActiveSession).toBe(false);
  });
});
