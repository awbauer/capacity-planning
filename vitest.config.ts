import { defineConfig } from 'vitest/config'

// Tests run in Node: domain logic, stores, and the server engines on Node's
// built-in SQLite. (vite.config.ts's Cloudflare plugin is for the dev server and build.)
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'worker/**/*.test.ts'],
  },
})
