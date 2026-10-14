import type { ClientFiles } from './assets';

// The built app, inlined at build time (vite.config.ts builds the client before the Worker).
// Empty in development, where the dev server serves the app.
const raw = import.meta.glob('/dist/client/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export const clientFiles: ClientFiles = Object.fromEntries(
  Object.entries(raw).map(([file, body]) => [file.replace(/^\/dist\/client/, ''), body]),
);
