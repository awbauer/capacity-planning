import { describe, expect, it } from 'vitest';
import { devAuthAllowed, identify, sameOrigin } from './auth';
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

  it('rejects a bad Access token, and says when Access isn’t configured', async () => {
    const req = new Request('https://plans.example.com/api/me', { headers: { 'Cf-Access-Jwt-Assertion': 'not.a.jwt' } });
    expect(await identify(req, env())).toMatchObject({ ok: false, status: 500 });
    expect(await identify(req, env({ TEAM_DOMAIN: 'https://t.cloudflareaccess.com', POLICY_AUD: 'aud' }))).toMatchObject({ ok: false, status: 401 });
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
