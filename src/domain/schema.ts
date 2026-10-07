import { z } from 'zod';
import type { PlanData } from './types';
import { snapWeekly } from './steps';
import { normalizeWeek } from './weeks';

const id = z.string().min(1);
const isMonday = (k: string) => /^\d{4}-\d{2}-\d{2}$/.test(k) && normalizeWeek(k) === k;
const weekKey = z.string().refine(isMonday, 'weeks must be Mondays in yyyy-MM-dd format');

const planSchema = z.object({
  // Version 1 files predate project status and allocation kind; defaults upgrade them.
  version: z.union([z.literal(1), z.literal(2)]),
  tags: z.array(z.object({ id, name: z.string().min(1), color: z.string() })),
  sellers: z.array(z.object({ id, name: z.string().min(1), email: z.string().optional() })),
  resources: z.array(
    z.object({ id, name: z.string().min(1), role: z.string().optional(), tagIds: z.array(id) }),
  ),
  projects: z.array(
    z.object({
      id,
      name: z.string().min(1),
      client: z.string().optional(),
      sellerId: id.nullable(),
      status: z.enum(['pipeline', 'won', 'lost']).default('won'),
      tagIds: z.array(id),
      startWeek: weekKey.optional(),
      endWeek: weekKey.optional(),
      notes: z.string().optional(),
    }),
  ),
  assignments: z.array(
    z.object({
      id,
      projectId: id,
      resourceId: id,
      kind: z.enum(['presales', 'delivery']).default('delivery'),
      weekly: z.record(z.string(), z.number().min(0)),
    }),
  ),
  settings: z.object({ overallocationThreshold: z.number().positive() }),
});

/** Validates an imported plan, including references between entities. Throws on error. */
export function parsePlan(input: unknown): PlanData {
  const result = planSchema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`Invalid plan file at ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  const plan: PlanData = {
    ...result.data,
    version: 2,
    assignments: result.data.assignments.map((a) => ({ ...a, weekly: snapWeekly(a.weekly) })),
  };
  const tagIds = new Set(plan.tags.map((t) => t.id));
  const sellerIds = new Set(plan.sellers.map((s) => s.id));
  const resourceIds = new Set(plan.resources.map((r) => r.id));
  const projectIds = new Set(plan.projects.map((p) => p.id));
  const missing = (kind: string, ref: string, owner: string) => {
    throw new Error(`Invalid plan file: ${owner} references unknown ${kind} "${ref}"`);
  };
  for (const r of plan.resources) {
    for (const t of r.tagIds) if (!tagIds.has(t)) missing('tag', t, `resource "${r.name}"`);
  }
  for (const p of plan.projects) {
    for (const t of p.tagIds) if (!tagIds.has(t)) missing('tag', t, `workstream "${p.name}"`);
    if (p.sellerId && !sellerIds.has(p.sellerId)) missing('seller', p.sellerId, `workstream "${p.name}"`);
  }
  for (const a of plan.assignments) {
    const bad = Object.keys(a.weekly).find((k) => !isMonday(k));
    if (bad) {
      throw new Error(`Invalid plan file: assignment ${a.id} has week "${bad}"; weeks must be Mondays (yyyy-MM-dd)`);
    }
    if (!projectIds.has(a.projectId)) missing('workstream', a.projectId, `assignment ${a.id}`);
    if (!resourceIds.has(a.resourceId)) missing('resource', a.resourceId, `assignment ${a.id}`);
  }
  const seen = new Set<string>();
  for (const a of plan.assignments) {
    const key = `${a.projectId}|${a.resourceId}|${a.kind}`;
    if (seen.has(key)) {
      throw new Error(`Invalid plan file: duplicate ${a.kind} assignment ${a.id} for the same person and workstream`);
    }
    seen.add(key);
  }
  return plan;
}

/**
 * Best-effort upgrade of data saved by an older version of the app (no
 * validation, so a slightly malformed save isn't thrown away). Fills in
 * status/kind and snaps weekly values to 0/25/50/100.
 */
export function upgradePlan(raw: unknown): PlanData {
  const plan = raw as PlanData;
  return {
    ...plan,
    version: 2,
    projects: (plan.projects ?? []).map((p) => ({ ...p, status: p.status ?? 'won' })),
    assignments: (plan.assignments ?? []).map((a) => ({
      ...a,
      kind: a.kind ?? 'delivery',
      weekly: snapWeekly(a.weekly ?? {}),
    })),
  };
}
