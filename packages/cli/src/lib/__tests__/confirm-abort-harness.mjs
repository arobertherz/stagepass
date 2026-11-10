/**
 * [N-1] Process-level harness: calls the real `confirm()` wrapper backed by
 * the real `@inquirer/prompts` confirm (no mocking), so an abort goes through
 * the actual ExitPromptError the dependency throws.
 */
import { confirm } from '../prompts.js';

// No top-level await: keeps the module settled if the process exits from
// inside confirm() (abort path), avoiding Node's unrelated "unsettled
// top-level await" diagnostic from showing up in the captured output.
async function main() {
  const answer = await confirm('Proceed?', { default: false });
  console.log('ANSWER', answer);
  process.exit(0);
}

main();
