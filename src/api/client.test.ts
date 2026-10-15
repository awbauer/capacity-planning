import { afterEach, expect, it, vi } from 'vitest';
import { api, ApiError } from './client';
afterEach(() => vi.unstubAllGlobals());
it('distinguishes static hosting without an API from a network outage', async () => {
  vi.stubGlobal('fetch', async () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }));
  await expect(api('/api/me')).rejects.toMatchObject({ status: 0, noBackend: true, signIn: false });
  vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
  await expect(api('/api/me')).rejects.toMatchObject({ status: 0, noBackend: false });
});
it('preserves JSON access denials and expired sign-ins', async () => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'Disabled' }), { status: 403, headers: { 'Content-Type': 'application/json' } }));
  await expect(api('/api/me')).rejects.toMatchObject({ message: 'Disabled', noBackend: false });
  expect(new ApiError(401, 'Expired', true).signIn).toBe(true);
});
