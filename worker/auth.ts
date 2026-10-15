import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Env } from './env';

export interface Identity {
  email: string;
  name: string;
  /** When the Access token expires (epoch ms). */
  exp: number;
}

export type AuthResult = { ok: true; identity: Identity } | { ok: false; status: 401 | 500; msg: string };

let jwks: { domain: string; keys: JWTVerifyGetKey } | undefined;

const isLocalhost = (url: URL) => url.hostname === 'localhost' || url.hostname === '127.0.0.1';

/** The dev sign-in cookie: only on localhost, and only when DEV_AUTH=1 (set in .dev.vars, never in production). */
export function devAuthAllowed(env: Env, url: URL): boolean {
  return env.DEV_AUTH === '1' && isLocalhost(url);
}

function cookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) {
      try {
        return decodeURIComponent(v.join('='));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

const nameFromEmail = (email: string) =>
  email
    .split('@')[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');

/** The access context Cloudflare gives the Worker for requests Access signed in (absent otherwise). */
type AccessContext = Pick<ExecutionContext, 'access'>;

/** Longest a connection lasts before re-checking the sign-in. */
const MAX_SESSION_MS = 24 * 3600_000;

/**
 * When the Access session ends, from the token Access adds. Read without
 * verifying: it only shortens how long a socket stays open, it never
 * decides who someone is.
 */
export function sessionExpiry(
  request: Request,
  now = Date.now(),
  token = request.headers.get('Cf-Access-Jwt-Assertion') || cookie(request, 'CF_Authorization'),
): number {
  try {
    const part = token?.split('.')[1];
    const exp = part ? Number(JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))).exp) * 1000 : NaN;
    if (Number.isFinite(exp) && exp > 0) return Math.min(exp, now + MAX_SESSION_MS);
  } catch {
    // Not a readable token.
  }
  return now + 3600_000;
}

/**
 * Who is making the request. Cloudflare Access signs people in at the edge
 * and hands the Worker the verified identity in `ctx.access` (the Worker
 * serves the app itself so that this reaches it; see worker/assets.ts).
 * Without it, Cloudflare is asked who the Access token belongs to (see
 * edgeIdentity); without a token Access confirms, the request is refused.
 *
 * Fallback while TEAM_DOMAIN and POLICY_AUD are still set (older
 * deployments): the Access token is verified here instead. Remove them once
 * `ctx.access` is confirmed working.
 */
export async function identify(request: Request, env: Env, ctx?: AccessContext, fetcher: typeof fetch = fetch): Promise<AuthResult> {
  const url = new URL(request.url);
  if (devAuthAllowed(env, url)) {
    const email = (request.headers.get('X-Dev-User') || cookie(request, 'dev_user'))?.trim().toLowerCase();
    if (email) return { ok: true, identity: { email, name: nameFromEmail(email), exp: Date.now() + 24 * 3600_000 } };
  }
  if (ctx?.access) {
    const who = await ctx.access.getIdentity().catch(() => undefined);
    const email = typeof who?.email === 'string' ? who.email.trim().toLowerCase() : '';
    if (!email) return { ok: false, status: 401, msg: 'Your Access sign-in has no email address.' };
    const name = typeof who?.name === 'string' && who.name ? who.name : nameFromEmail(email);
    return { ok: true, identity: { email, name, exp: sessionExpiry(request) } };
  }
  if (env.TEAM_DOMAIN && env.POLICY_AUD) return verifyToken(request, env.TEAM_DOMAIN, env.POLICY_AUD);
  const edge = await edgeIdentity(request, fetcher);
  if (edge) return { ok: true, identity: edge };
  return { ok: false, status: 401, msg: 'Sign in through Cloudflare Access.' };
}

/** Identities Cloudflare confirmed, by Access token, until the session ends. */
const confirmed = new Map<string, Identity>();
const MAX_CONFIRMED = 500;

/**
 * Who Cloudflare Access says the token belongs to, asked of this hostname's
 * own /cdn-cgi/access/get-identity. Cloudflare checks the token against the
 * Access application protecting exactly this hostname, so a forged token, or
 * one from another Access team, gets nothing; so does a hostname Access
 * doesn't protect. Used when `ctx.access` isn't set (it isn't for every way
 * of attaching Access, e.g. the shared Preview URLs application).
 */
export async function edgeIdentity(request: Request, fetcher: typeof fetch = fetch): Promise<Identity | undefined> {
  const token = cookie(request, 'CF_Authorization') || request.headers.get('Cf-Access-Jwt-Assertion') || '';
  if (!token || token.length > 8192) return undefined;
  // Access validates tokens for one application origin, not every hostname this Worker serves.
  const cacheKey = JSON.stringify([new URL(request.url).origin, token]);
  const cached = confirmed.get(cacheKey);
  if (cached && cached.exp > Date.now()) return cached;
  confirmed.delete(cacheKey);
  let status = 0;
  try {
    const res = await fetcher(new URL('/cdn-cgi/access/get-identity', request.url), {
      headers: { Cookie: `CF_Authorization=${token}`, Accept: 'application/json' },
      redirect: 'manual',
    });
    status = res.status;
    if (res.status === 200) {
      const who = (await res.json().catch(() => null)) as { email?: unknown; name?: unknown } | null;
      const email = typeof who?.email === 'string' ? who.email.trim().toLowerCase() : '';
      if (email) {
        const name = typeof who?.name === 'string' && who.name ? who.name : nameFromEmail(email);
        const identity = { email, name, exp: sessionExpiry(request, Date.now(), token) };
        if (confirmed.size >= MAX_CONFIRMED) confirmed.delete(confirmed.keys().next().value!);
        confirmed.set(cacheKey, identity);
        return identity;
      }
    }
  } catch {
    status = -1;
  }
  console.warn('access identity', status);
  return undefined;
}

/** Verifies the Access token against the team's public keys and the application's audience(s, comma-separated). */
async function verifyToken(request: Request, teamDomain: string, policyAud: string): Promise<AuthResult> {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return { ok: false, status: 401, msg: 'Sign in through Cloudflare Access.' };
  const domain = teamDomain.replace(/\/+$/, '');
  if (jwks?.domain !== domain) jwks = { domain, keys: createRemoteJWKSet(new URL(`${domain}/cdn-cgi/access/certs`)) };
  try {
    const audience = policyAud.split(',').map((a) => a.trim()).filter(Boolean);
    const { payload } = await jwtVerify(token, jwks.keys, { issuer: domain, audience });
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    if (!email) return { ok: false, status: 401, msg: 'Your Access sign-in has no email address.' };
    const name = typeof payload.name === 'string' && payload.name ? payload.name : nameFromEmail(email);
    return { ok: true, identity: { email, name, exp: (payload.exp ?? 0) * 1000 || Date.now() + 3600_000 } };
  } catch {
    return { ok: false, status: 401, msg: 'Your sign-in has expired or isn’t valid. Reload to sign in again.' };
  }
}

/**
 * Blocks cross-site requests that would ride on the Access cookie: anything
 * that changes data, and WebSocket upgrades, must come from this origin.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return request.method === 'GET' && request.headers.get('Upgrade') !== 'websocket';
  return origin === new URL(request.url).origin;
}
