import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Cap forks. Uncapped workers OOM on the Cerebro self-hosted runner
    // when new.test.js / php-new.test.js run (heap limit, not assertion failures).
    maxWorkers: 4,
  },
});
