import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChildBounded } from './run-child-bounded.js';

// [N-1] Process-level check: spawn a real Node child that calls the real
// `confirm()` against the real `@inquirer/prompts` confirm (no mocking).
// Closed stdin reliably reproduces a genuine `ExitPromptError` from EOF
// without a TTY (verified: SIGINT only becomes an ExitPromptError when
// readline owns a real terminal in raw mode; on a plain pipe/closed stdin,
// Ctrl+C is handled by the OS default disposition before @inquirer ever
// sees it). Allocating a real pseudo-TTY inside the Docker test image would
// need an extra system tool (e.g. `script`/a pty helper) that is not an npm
// dependency of this project and is not guaranteed across test
// environments, so the SIGINT branch of the handler is covered at the unit
// level instead (see prompts.test.js), per the "TTY not feasible" fallback.
const HARNESS = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'confirm-abort-harness.mjs'
);

describe('confirm() abort at a real prompt [N-1]', () => {
  it('EOF/closed stdin: no stack trace, one "Aborted." line, exit 1', async () => {
    const result = await runChildBounded({
      args: [HARNESS],
      deadlineMs: 2500,
      outputBudget: 64 * 1024,
      label: 'confirm-abort-eof',
    });
    expect(result.timedOut, `timedOut output=${result.output}`).toBe(false);
    expect(result.code).toBe(1);
    expect(result.output).toContain('Aborted.');
    expect(result.output).not.toContain('ANSWER');
    // No Node stack trace / unhandled rejection dump.
    expect(result.output).not.toMatch(/ExitPromptError/);
    expect(result.output).not.toMatch(/at .*\.(m?js):\d+/);
  });
});
