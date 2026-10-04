import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts so tests don't pick up the dev server's
// HTTPS/proxy setup. The sveltekit() plugin resolves $app/* and compiles
// .svelte.ts runes modules (api.ts imports api-cache.svelte.ts).
export default defineConfig({
  plugins: [sveltekit()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false,
  },
});
