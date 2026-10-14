import type { PlanRoom } from './planRoom';
import type { Workspace } from './workspace';

export interface Env {
  PLAN_ROOM: DurableObjectNamespace<PlanRoom>;
  WORKSPACE: DurableObjectNamespace<Workspace>;
  ASSETS: Fetcher;
  /** https://<team>.cloudflareaccess.com */
  TEAM_DOMAIN?: string;
  /** The Access application's audience (AUD) tag. */
  POLICY_AUD?: string;
  /** Comma-separated emails that are always admins. */
  OWNER_EMAILS?: string;
  /** IANA time zone that decides "this week" for the past-weeks lock. */
  TIMEZONE?: string;
  /** "1" (in .dev.vars only) allows the dev sign-in cookie on localhost. */
  DEV_AUTH?: string;
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
