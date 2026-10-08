import { z } from 'zod';
import { DEFAULT_PLAN_NAME, type PlanFile } from './plans';
import { CAREER_LEVELS, type Assignment, type PlanData } from './types';
import { snapWeekly } from './steps';
import { normalizeWeek } from './weeks';

const id = z.string().min(1);
const isMonday = (k: string) => /^\d{4}-\d{2}-\d{2}$/.test(k) && normalizeWeek(k) === k;
const weekKey = z.string().refine(isMonday, 'weeks must be Mondays in yyyy-MM-dd format');

const planSchema = z.object({
  // v1 predates workstream status; v2 had separate presales/delivery rows; v3 kept open
  // roles apart from people's rows. All are upgraded to v4 (every row is a role).
  version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
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
      resourceId: id.nullable(),
      name: z.string().optional(),
      level: z.enum(CAREER_LEVELS).optional(),
      tagIds: z.array(id).optional(),
      kind: z.enum(['presales', 'delivery']).optional(),
      weekly: z.record(z.string(), z.number().min(0)),
    }),
  ),
  // v3 only: open roles were kept separately.
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
    .optional(),
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
  const { name, revision, roles, ...data } = result.data;
  const plan: PlanData = {
    ...data,
    version: 4,
    assignments: toRoles(data.version, data.assignments, roles, data.resources),
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
    const label = a.name ? `role "${a.name}"` : `role ${a.id}`;
    const bad = Object.keys(a.weekly).find((k) => !isMonday(k));
    if (bad) throw new Error(`Invalid plan file: ${label} has week "${bad}"; weeks must be Mondays (yyyy-MM-dd)`);
    if (!projectIds.has(a.projectId)) missing('workstream', a.projectId, label);
    if (a.resourceId !== null && !resourceIds.has(a.resourceId)) missing('resource', a.resourceId, label);
    for (const t of a.tagIds) if (!tagIds.has(t)) missing('tag', t, label);
  }
  return { name: name ?? DEFAULT_PLAN_NAME, revision: revision ?? 0, plan };
}

/** A row as saved by any version: v1–v3 rows had no role fields, v1–v2 could have a `kind`. */
type StoredAssignment = {
  id: string;
  projectId: string;
  resourceId: string | null;
  name?: string;
  level?: Assignment['level'];
  tagIds?: string[];
  weekly?: Record<string, number>;
  kind?: string;
};
type StoredRole = Omit<Assignment, 'resourceId'>;

/**
 * Older data could have separate presales and delivery rows for the same
 * person on a workstream; their weeks are added together into one row.
 */
export function mergeAssignments(list: StoredAssignment[]): StoredAssignment[] {
  const byKey = new Map<string, StoredAssignment & { weekly: Record<string, number> }>();
  for (const a of list) {
    const key = `${a.projectId}|${a.resourceId}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...a, weekly: { ...a.weekly } });
      continue;
    }
    for (const [w, v] of Object.entries(a.weekly ?? {})) prev.weekly[w] = (prev.weekly[w] ?? 0) + v;
  }
  return [...byKey.values()];
}

/**
 * Brings rows from any version to v4 roles. Before v4, a person had one row
 * per workstream (merged here) and open roles were kept apart (folded in
 * here). A person's row becomes a role named after their title, so nobody is
 * outside a role. Every week is snapped to 0/25/50/100.
 */
export function toRoles(
  version: number | undefined,
  rows: StoredAssignment[],
  roles: StoredRole[] | undefined,
  resources: { id: string; role?: string }[],
): Assignment[] {
  const legacy = (version ?? 0) < 4;
  const titles = new Map(resources.map((r) => [r.id, r.role ?? '']));
  const people = (legacy ? mergeAssignments(rows) : rows).map(
    (a): Assignment => ({
      id: a.id,
      projectId: a.projectId,
      resourceId: a.resourceId ?? null,
      name: a.name ?? (a.resourceId ? (titles.get(a.resourceId) ?? '') : ''),
      ...(a.level ? { level: a.level } : {}),
      tagIds: a.tagIds ?? [],
      weekly: snapWeekly(a.weekly ?? {}),
    }),
  );
  const open = (roles ?? []).map((r): Assignment => ({ ...r, resourceId: null, weekly: snapWeekly(r.weekly) }));
  return [...people, ...open];
}

/**
 * Best-effort upgrade of data saved by an older version of the app (no
 * validation, so a slightly malformed save isn't thrown away). Fills in
 * workstream status and thresholds, and brings rows up to v4 roles.
 */
export function upgradePlan(raw: unknown): PlanData {
  const plan = raw as Omit<PlanData, 'version'> & { version?: number; roles?: StoredRole[] };
  const { roles, ...rest } = plan;
  return {
    ...rest,
    version: 4,
    settings: {
      ...plan.settings,
      overallocationThreshold: plan.settings?.overallocationThreshold ?? 100,
      criticalThreshold: plan.settings?.criticalThreshold ?? 149,
    },
    projects: (plan.projects ?? []).map((p) => ({ ...p, status: p.status ?? 'won' })),
    assignments: toRoles(plan.version, plan.assignments ?? [], roles, plan.resources ?? []),
  };
}
