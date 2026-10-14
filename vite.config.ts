import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync } from 'node:fs'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // The Cloudflare plugin runs the Worker and its Durable Objects locally under `npm run dev`.
  plugins: [react(), cloudflare()],
  builder: {
    // Production build: the app first, then the Worker, which inlines the app (worker/clientFiles.ts)
    // and serves it itself, without Workers Static Assets. That keeps `ctx.access` (the signed-in
    // Cloudflare Access user) reaching the Worker; the asset router doesn't pass it on.
    async buildApp(builder) {
      await builder.build(builder.environments.client)
      await builder.build(builder.environments.capacity_planning)
      const out = 'dist/capacity_planning/wrangler.json'
      const config = JSON.parse(readFileSync(out, 'utf-8'))
      delete config.assets
      writeFileSync(out, JSON.stringify(config))
    },
  },
})
