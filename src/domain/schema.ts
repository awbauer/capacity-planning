import { z } from 'zod';
import { DEFAULT_PLAN_NAME, type PlanFile } from './plans';
import { CAREER_LEVELS, type Assignment, type PlanData } from './types';
import { snapWeekly } from './steps';
import { normalizeWeek } from './weeks';

const id = z.string().min(1);
const isMonday = (k: string) => /^\d{4}-\d{2}-\d{2}$/.test(k) && normalizeWeek(k) === k;
const weekKey = z.string().refine(isMonday, 'weeks must be Mondays in yyyy-MM-dd format');

const planSchema = z.object({
  // v1 predates workstream status; v2 had separate presales/delivery rows. Both are upgraded.
  version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  // Files exported before named plans have neither; they import as "Default".
  name: z.string().trim().min(1).optional(),
  revision: z.number().int().min(0).optional(),
  tags: z.array(z.object({ id, name: z.string().min(1), color: z.string() })),
  sellers: z.array(z.object({ id, name: z.string().min(1), email: z.string().optional() })),
  resources: z.array(
    z.object({
      id,
      name: z.string().min(1),
      role: z.string().optional(),
      level: z.enum(CAREER_LEVELS).optional(),
      tagIds: z.array(id),
    }),
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
      kind: z.enum(['presales', 'delivery']).optional(),
      weekly: z.record(z.string(), z.number().min(0)),
    }),
  ),
  // Open roles (unfilled demand); files from before they existed have none.
  roles: z
    .array(
      z.object({
        id,
        projectId: id,
        name: z.string().min(1),
        level: z.enum(CAREER_LEVELS).optional(),
        tagIds: z.array(id),
        weekly: z.record(z.string(), z.number().min(0)),
      }),
    )
    .default([]),
  settings: z.object({
    overallocationThreshold: z.number().positive(),
    criticalThreshold: z.number().positive().default(149),
    utilizationTargets: z.partialRecord(z.enum(CAREER_LEVELS), z.number().min(0).max(100)).optional(),
  }),
});

/** Validates an imported plan, including references between entities. Throws on error. */
export function parsePlan(input: unknown): PlanData {
  return parsePlanFile(input).plan;
}

/** Like parsePlan, plus the plan's name and revision from the file. */
export function parsePlanFile(input: unknown): PlanFile {
  const result = planSchema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`Invalid plan file at ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  const { name, revision, ...data } = result.data;
  const plan: PlanData = {
    ...data,
    version: 3,
    assignments: mergeAssignments(data.assignments),
    roles: data.roles.map((r) => ({ ...r, weekly: snapWeekly(r.weekly) })),
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
  for (const r of plan.roles) {
    const bad = Object.keys(r.weekly).find((k) => !isMonday(k));
    if (bad) throw new Error(`Invalid plan file: role "${r.name}" has week "${bad}"; weeks must be Mondays (yyyy-MM-dd)`);
    if (!projectIds.has(r.projectId)) missing('workstream', r.projectId, `role "${r.name}"`);
    for (const t of r.tagIds) if (!tagIds.has(t)) missing('tag', t, `role "${r.name}"`);
  }
  return { name: name ?? DEFAULT_PLAN_NAME, revision: revision ?? 0, plan };
}

type StoredAssignment = Omit<Assignment, 'weekly'> & { weekly?: Record<string, number>; kind?: string };

/**
 * One row per person per workstream. Older data could have separate presales
 * and delivery rows; their weeks are added together, then every week is
 * snapped to 0/25/50/100.
 */
export function mergeAssignments(list: StoredAssignment[]): Assignment[] {
  const byKey = new Map<string, Assignment>();
  for (const a of list) {
    const key = `${a.projectId}|${a.resourceId}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { id: a.id, projectId: a.projectId, resourceId: a.resourceId, weekly: { ...a.weekly } });
      continue;
    }
    for (const [w, v] of Object.entries(a.weekly ?? {})) prev.weekly[w] = (prev.weekly[w] ?? 0) + v;
  }
  return [...byKey.values()].map((a) => ({ ...a, weekly: snapWeekly(a.weekly) }));
}

/**
 * Best-effort upgrade of data saved by an older version of the app (no
 * validation, so a slightly malformed save isn't thrown away). Fills in
 * workstream status, merges presales/delivery rows and snaps weekly values.
 */
export function upgradePlan(raw: unknown): PlanData {
  const plan = raw as PlanData;
  return {
    ...plan,
    version: 3,
    settings: {
      ...plan.settings,
      overallocationThreshold: plan.settings?.overallocationThreshold ?? 100,
      criticalThreshold: plan.settings?.criticalThreshold ?? 149,
    },
    projects: (plan.projects ?? []).map((p) => ({ ...p, status: p.status ?? 'won' })),
    assignments: mergeAssignments(plan.assignments ?? []),
    roles: plan.roles ?? [],
  };
}
