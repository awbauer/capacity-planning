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
    if (k === name) return decodeURIComponent(v.join('='));
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

/**
 * Who is making the request, from the token Cloudflare Access adds. Workers
 * with static assets don't get `ctx.access`, so the token is verified here
 * against the Access team's public keys and the application's audience.
 */
export async function identify(request: Request, env: Env): Promise<AuthResult> {
  const url = new URL(request.url);
  if (devAuthAllowed(env, url)) {
    const email = cookie(request, 'dev_user')?.trim().toLowerCase();
    if (email) return { ok: true, identity: { email, name: nameFromEmail(email), exp: Date.now() + 24 * 3600_000 } };
  }
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return { ok: false, status: 401, msg: 'Sign in through Cloudflare Access.' };
  if (!env.TEAM_DOMAIN || !env.POLICY_AUD) {
    return { ok: false, status: 500, msg: 'The shared workspace isn’t configured (TEAM_DOMAIN and POLICY_AUD).' };
  }
  const domain = env.TEAM_DOMAIN.replace(/\/+$/, '');
  if (jwks?.domain !== domain) jwks = { domain, keys: createRemoteJWKSet(new URL(`${domain}/cdn-cgi/access/certs`)) };
  try {
    const { payload } = await jwtVerify(token, jwks.keys, { issuer: domain, audience: env.POLICY_AUD });
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
