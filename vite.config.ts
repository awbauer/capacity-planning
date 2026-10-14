import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync } from 'node:fs'
import { defineConfig } from 'vite'
// @ts-expect-error plain ESM script, no types
import { writeClientFiles } from './scripts/client-files.mjs'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    // Runs the Worker and its Durable Objects locally under `npm run dev`. Deployed, the Worker serves the
    // app itself (worker/assets.ts) rather than through Workers Static Assets, whose router doesn't pass
    // `ctx.access` (the signed-in Cloudflare Access user) on; in development the dev server serves it.
    cloudflare(
      command === 'serve'
        ? { config: { assets: { not_found_handling: 'single-page-application', run_worker_first: ['/api/*'] } } }
        : {},
    ),
  ],
  builder: {
    // The app first, inlined into the Worker as a module (also what `wrangler preview` bundles), then the Worker.
    async buildApp(builder) {
      await builder.build(builder.environments.client)
      writeClientFiles()
      await builder.build(builder.environments.capacity_planning)
      const out = 'dist/capacity_planning/wrangler.json'
      const config = JSON.parse(readFileSync(out, 'utf-8'))
      delete config.assets
      writeFileSync(out, JSON.stringify(config))
    },
  },
}))
