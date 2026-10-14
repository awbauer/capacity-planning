import type { PlanRoom } from './planRoom';
import type { Workspace } from './workspace';

export interface Env {
  PLAN_ROOM: DurableObjectNamespace<PlanRoom>;
  WORKSPACE: DurableObjectNamespace<Workspace>;
  /** Development only (the dev server's assets); deployed, the Worker serves the app itself. */
  ASSETS?: Fetcher;
  /** https://<team>.cloudflareaccess.com */
  TEAM_DOMAIN?: string;
  /** The Access application's audience (AUD) tag. */
  POLICY_AUD?: string;
  /** Comma-separated emails that are always admins. */
  OWNER_EMAILS?: string;
  /** "1" (in .dev.vars only) allows the dev sign-in cookie on localhost. */
  DEV_AUTH?: string;
  /** Cloudflare Email Service, for mention emails. */
  EMAIL?: SendEmail;
  /** Sender of mention emails, e.g. "Capacity Planning <notify@example.com>" (on a domain onboarded to Email Sending). */
  MAIL_FROM?: string;
  /** The app's address, for links in emails, e.g. https://capacity.example.com */
  APP_URL?: string;
}

/** Mention emails go out only once the sender and the app's address are set. */
export const mailEnabled = (env: Env) => !!(env.EMAIL && env.MAIL_FROM?.trim() && env.APP_URL?.trim());

/** "Name <addr>" or "addr" as an email address. */
export function parseSender(from: string): string | { email: string; name: string } {
  const m = from.trim().match(/^(.*?)\s*<([^<>\s]+)>$/);
  if (!m) return from.trim();
  const name = m[1].replace(/^"|"$/g, '').trim();
  return name ? { email: m[2], name } : m[2];
}

export const owners = (env: Env) =>
  new Set(
    (env.OWNER_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );

export const workspaceStub = (env: Env) => env.WORKSPACE.get(env.WORKSPACE.idFromName('workspace'));
export const roomStub = (env: Env, planId: string) => env.PLAN_ROOM.get(env.PLAN_ROOM.idFromName(planId));
