/**
 * Serves the built app (dist/client) from the Worker itself. With Workers
 * Static Assets, requests go through Cloudflare's asset router, which doesn't
 * pass `ctx.access` (the signed-in Access user) on to the Worker; serving the
 * four files here means it does. See README "How it works".
 */

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  webmanifest: 'application/manifest+json',
};

const typeOf = (path: string) => TYPES[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

/** Files keyed by URL path ("/index.html", "/assets/index-abc.js"). */
export type ClientFiles = Record<string, string>;

/** The response for a non-API request: a file, the app shell for app routes, or 404/405. */
export function assetResponse(files: ClientFiles, request: Request): Response {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const path = decodeURIComponent(new URL(request.url).pathname);
  const send = (file: string, cache: string) =>
    new Response(request.method === 'HEAD' ? null : files[file], {
      headers: { 'Content-Type': typeOf(file), 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' },
    });
  const shell = () => (files['/index.html'] === undefined ? new Response('Not found', { status: 404 }) : send('/index.html', 'no-cache'));

  if (path === '/' || path === '/index.html') return shell();
  if (files[path] !== undefined) {
    // Vite fingerprints everything under /assets/, so those never change.
    return send(path, path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
  }
  // A missing file (an old bundle after a deploy) is a 404, not the app shell.
  if (path.startsWith('/assets/') || /\.[a-z0-9]+$/i.test(path)) return new Response('Not found', { status: 404 });
  return shell();
}
