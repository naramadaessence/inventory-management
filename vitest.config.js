import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // happy-dom gives us localStorage + DOM globals that the demoRpc layer needs.
    environment: 'happy-dom',
    // Tests live alongside js/ in tests/.
    include: ['tests/**/*.test.js'],
    // Reset module state between tests so localStorage clears reliably.
    globals: false,
  },
});
