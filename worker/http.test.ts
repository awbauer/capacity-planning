import { describe, expect, it } from 'vitest';
import { assetResponse } from './assets';
import { devAuthAllowed, identify, sameOrigin, sessionExpiry } from './auth';
import type { Env } from './env';
import { activityQuery, body, createPlanBody, csvCell, HttpError, requireRole } from './http';

const admin = { email: 'a@x', name: 'A', role: 'admin' as const, owner: true };
const viewer = { ...admin, role: 'viewer' as const, owner: false };
const env = (vars: Partial<Env> = {}) => vars as Env;

describe('auth', () => {
  it('only accepts the dev sign-in on localhost with DEV_AUTH=1', async () => {
    expect(devAuthAllowed(env({ DEV_AUTH: '1' }), new URL('http://localhost:5173/api/me'))).toBe(true);
    expect(devAuthAllowed(env({ DEV_AUTH: '1' }), new URL('https://plans.example.com/api/me'))).toBe(false);
    expect(devAuthAllowed(env({}), new URL('http://localhost:5173/api/me'))).toBe(false);
    const cookie = { headers: { Cookie: 'dev_user=eve@x' } };
    // Production host: the cookie is ignored and the Access token is required.
    expect(await identify(new Request('https://plans.example.com/api/me', cookie), env({ DEV_AUTH: '1' }))).toMatchObject({ ok: false, status: 401 });
    expect(await identify(new Request('http://localhost/api/me', cookie), env({ DEV_AUTH: '1' }))).toMatchObject({ ok: true, identity: { email: 'eve@x' } });
  });

  it('takes the signed-in person from ctx.access, and refuses requests Access didn’t sign in', async () => {
    const req = new Request('https://plans.example.com/api/me');
    const access = (identity: Record<string, unknown> | undefined) => ({ access: { aud: 'a', getIdentity: async () => identity } });
    expect(await identify(req, env(), access({ email: 'Ann@X.com', name: 'Ann Lee' }))).toMatchObject({
      ok: true,
      identity: { email: 'ann@x.com', name: 'Ann Lee' },
    });
    expect(await identify(req, env(), access({ email: 'bo.diaz@x.com' }))).toMatchObject({ ok: true, identity: { name: 'Bo Diaz' } });
    expect(await identify(req, env(), access({}))).toMatchObject({ ok: false, status: 401 });
    // No ctx.access and Cloudflare doesn't confirm the token (an unprotected URL, a forged token): refused.
    const forged = new Request('https://plans.example.com/api/me', { headers: { 'Cf-Access-Jwt-Assertion': 'not.a.jwt' } });
    expect(await identify(forged, env(), {}, async () => new Response('', { status: 404 }))).toMatchObject({ ok: false, status: 401 });
    // The fallback token check (TEAM_DOMAIN and POLICY_AUD set) rejects a bad token.
    expect(await identify(forged, env({ TEAM_DOMAIN: 'https://t.cloudflareaccess.com', POLICY_AUD: 'aud' }))).toMatchObject({ ok: false, status: 401 });
  });

  it('without ctx.access, asks this hostname’s Access for the identity, and caches it', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const respond = (body: unknown, status = 200, type = 'application/json') => async (url: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': type } });
    };
    const withCookie = (t: string) => new Request('https://p.example.dev/api/me', { headers: { Cookie: `a=1; CF_Authorization=${t}` } });

    const ok = await identify(withCookie('tok1'), env(), {}, respond({ email: 'Ann@X.com', name: 'Ann Lee' }) as typeof fetch);
    expect(ok).toMatchObject({ ok: true, identity: { email: 'ann@x.com', name: 'Ann Lee' } });
    expect(calls[0].url).toBe('https://p.example.dev/cdn-cgi/access/get-identity');
    expect(calls[0].init).toMatchObject({ redirect: 'manual', headers: { Cookie: 'CF_Authorization=tok1' } });
    // Cached: no second call for the same token.
    await identify(withCookie('tok1'), env(), {}, respond({ email: 'x@x.com' }) as typeof fetch);
    expect(calls).toHaveLength(1);
    // The header works too.
    const viaHeader = new Request('https://p.example.dev/api/me', { headers: { 'Cf-Access-Jwt-Assertion': 'tok2' } });
    expect(await identify(viaHeader, env(), {}, respond({ email: 'bo@x.com' }) as typeof fetch)).toMatchObject({ ok: true, identity: { email: 'bo@x.com', name: 'Bo' } });

    // Anything but a 200 with an email is no identity.
    const refused = [
      respond('', 302),
      respond({ err: 'no' }, 401),
      respond('<html>login</html>', 200, 'text/html'),
      respond({ name: 'No Email' }),
      async () => {
        throw new Error('network');
      },
    ];
    for (const [i, f] of refused.entries()) {
      expect(await identify(withCookie(`bad${i}`), env(), {}, f as typeof fetch)).toMatchObject({ ok: false, status: 401 });
    }
    // No token: nothing to ask.
    const before = calls.length;
    expect(await identify(new Request('https://p.example.dev/api/me'), env(), {}, respond({ email: 'x@x.com' }) as typeof fetch)).toMatchObject({ ok: false });
    expect(calls.length).toBe(before);
  });

  it('reads the session expiry from the Access token, within limits', () => {
    const now = 1_000_000_000_000;
    const tok = (exp: number) => `x.${btoa(JSON.stringify({ exp })).replace(/=+$/, '')}.y`;
    const at = (t?: string) => new Request('https://x/api/me', t ? { headers: { 'Cf-Access-Jwt-Assertion': t } } : {});
    expect(sessionExpiry(at(tok(now / 1000 + 600)), now)).toBe(now + 600_000);
    expect(sessionExpiry(at(tok(now / 1000 + 7 * 86400)), now)).toBe(now + 24 * 3600_000);
    expect(sessionExpiry(at(tok(now / 1000 - 5)), now)).toBe(now + 3600_000);
    expect(sessionExpiry(at('garbage'), now)).toBe(now + 3600_000);
    expect(sessionExpiry(at(), now)).toBe(now + 3600_000);
  });

  it('blocks cross-site writes and WebSocket upgrades', () => {
    const at = (init: RequestInit) => new Request('https://plans.example.com/api/plans', init);
    expect(sameOrigin(at({ method: 'GET' }))).toBe(true);
    expect(sameOrigin(at({ method: 'POST' }))).toBe(false);
    expect(sameOrigin(at({ method: 'POST', headers: { Origin: 'https://evil.example' } }))).toBe(false);
    expect(sameOrigin(at({ method: 'POST', headers: { Origin: 'https://plans.example.com' } }))).toBe(true);
    expect(sameOrigin(at({ headers: { Upgrade: 'websocket' } }))).toBe(false);
    expect(sameOrigin(at({ headers: { Upgrade: 'websocket', Origin: 'https://evil.example' } }))).toBe(false);
  });
});

describe('serving the app', () => {
  const files = { '/index.html': '<html>app</html>', '/assets/index-abc.js': 'js()', '/favicon.svg': '<svg/>' };
  const get = (path: string, method = 'GET') => assetResponse(files, new Request(`https://x${path}`, { method }));

  it('serves files with their type, and caches fingerprinted ones forever', async () => {
    const js = get('/assets/index-abc.js');
    expect(js.headers.get('Content-Type')).toMatch(/javascript/);
    expect(js.headers.get('Cache-Control')).toMatch(/immutable/);
    expect(await js.text()).toBe('js()');
    expect(get('/favicon.svg').headers.get('Content-Type')).toBe('image/svg+xml');
  });

  it('serves the app shell for app routes, never cached; 404 for missing files', async () => {
    for (const p of ['/', '/index.html', '/some/route']) {
      const r = get(p);
      expect(r.status).toBe(200);
      expect(r.headers.get('Cache-Control')).toBe('no-cache');
      expect(await r.text()).toBe('<html>app</html>');
    }
    expect(get('/assets/index-old.js').status).toBe(404);
    expect(get('/robots.txt').status).toBe(404);
    expect(get('/', 'POST').status).toBe(405);
    expect(await get('/', 'HEAD').text()).toBe('');
    expect(assetResponse({}, new Request('https://x/')).status).toBe(404);
  });
});

describe('router helpers', () => {
  it('checks roles', () => {
    expect(() => requireRole(viewer, 'editor')).toThrow(HttpError);
    expect(() => requireRole({ ...viewer, role: 'editor' }, 'admin')).toThrow(/admins/);
    expect(() => requireRole(admin, 'admin')).not.toThrow();
  });

  it('only takes JSON bodies that match the schema', async () => {
    const post = (b: string, type = 'application/json') => new Request('https://x/api/plans', { method: 'POST', body: b, headers: { 'Content-Type': type } });
    await expect(body(post('{"name":"Q4"}', 'text/plain'), createPlanBody)).rejects.toMatchObject({ status: 415 });
    await expect(body(post('{"name":""}'), createPlanBody)).rejects.toMatchObject({ status: 400 });
    await expect(body(post('nope'), createPlanBody)).rejects.toMatchObject({ status: 400 });
    expect(await body(post('{"name":" Q4 "}'), createPlanBody)).toEqual({ name: 'Q4' });
  });

  it('reads activity filters, showing workspace events to admins only', () => {
    const q = activityQuery(new URL('https://x/api/activity?plan=p1&actor=bob@x&q=' + 'x'.repeat(300) + '&from=5&limit=10'), viewer);
    expect(q).toMatchObject({ planId: 'p1', actor: 'bob@x', from: 5, limit: 10, workspace: false });
    expect(q.q).toHaveLength(200);
    expect(activityQuery(new URL('https://x/api/activity'), admin).workspace).toBe(true);
  });

  it('escapes CSV cells, including spreadsheet formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
  });
});
