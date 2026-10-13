import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // The Cloudflare plugin runs the Worker and its Durable Objects locally under `npm run dev`.
  plugins: [react(), cloudflare()],
})
