import { z } from 'zod';
import { planDataSchema } from '../src/domain/opSchema';
import { USER_ROLES, type UserRole } from '../src/domain/permissions';
import type { Me } from '../src/domain/protocol';
import type { ActivityQuery } from './workspaceEngine';

// Request/response helpers for the API router (kept apart from index.ts so they can be tested in Node).

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
export const fail = (status: number, msg: string) => json({ error: msg }, status);

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const requireRole = (me: Me, min: 'editor' | 'admin') => {
  if (min === 'admin' ? me.role !== 'admin' : me.role === 'viewer') {
    throw new HttpError(403, min === 'admin' ? 'Only admins can do that.' : 'Viewers can’t make changes.');
  }
};

export async function body<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (!(request.headers.get('Content-Type') ?? '').includes('application/json')) throw new HttpError(415, 'Send JSON.');
  const r = schema.safeParse(await request.json().catch(() => undefined));
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Invalid request');
  return r.data;
}

export const createPlanBody = z.object({ name: z.string().trim().min(1).max(200), plan: planDataSchema.optional(), note: z.string().max(200).optional() });
export const patchPlanBody = z.object({ name: z.string().trim().min(1).max(200).optional(), archived: z.boolean().optional() });
export const patchUserBody = z.object({ role: z.enum(USER_ROLES as [UserRole, ...UserRole[]]).optional(), disabled: z.boolean().optional() });
export const inviteBody = z.object({ email: z.string().max(320), role: z.enum(USER_ROLES as [UserRole, ...UserRole[]]) });
export const settingsBody = z.object({ defaultRole: z.enum(['viewer', 'editor', 'admin', 'none']) });

export function activityQuery(url: URL, me: Me): ActivityQuery {
  const p = url.searchParams;
  const num = (k: string) => (p.get(k) ? Number(p.get(k)) : undefined);
  return {
    ...(p.get('plan') !== null ? { planId: p.get('plan')! } : {}),
    ...(p.get('actor') ? { actor: p.get('actor')! } : {}),
    ...(p.get('ref') ? { ref: p.get('ref')! } : {}),
    ...(p.get('op') ? { op: p.get('op')! } : {}),
    ...(num('from') !== undefined ? { from: num('from') } : {}),
    ...(num('to') !== undefined ? { to: num('to') } : {}),
    ...(p.get('q') ? { q: p.get('q')!.slice(0, 200) } : {}),
    ...(p.get('cursor') ? { cursor: p.get('cursor')! } : {}),
    ...(num('limit') !== undefined ? { limit: num('limit') } : {}),
    workspace: me.role === 'admin',
  };
}

export const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  // Leading =+-@ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
