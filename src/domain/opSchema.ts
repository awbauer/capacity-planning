import { z } from 'zod';
import { CLICK_STEPS } from './steps';
import { CAREER_LEVELS } from './types';
import { normalizeWeek } from './weeks';
import { getEntity, type Change } from './diff';
import type { Op } from './ops';
import type { PlanData } from './types';

/** Ids are uuids or short slugs; nothing that could be mistaken for markup or SQL. */
export const entityId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'invalid id');
const text = (max = 200) => z.string().max(max);
const name = z.string().trim().min(1).max(200);
const isMonday = (k: string) => /^\d{4}-\d{2}-\d{2}$/.test(k) && normalizeWeek(k) === k;
export const weekKey = z.string().refine(isMonday, 'weeks must be Mondays (yyyy-MM-dd)');
const level = z.enum(CAREER_LEVELS);
const tagIds = z.array(entityId).max(50);
const step = z.number().refine((v) => (CLICK_STEPS as readonly number[]).includes(v), 'allocations are 0/25/50/100');

/** Most cells a single op may touch. */
export const MAX_CELLS = 20_000;

const tag = z.strictObject({ id: entityId, name, color: z.string().regex(/^#[0-9a-fA-F]{3,8}$/) });
const seller = z.strictObject({ id: entityId, name, email: text().optional() });
const resource = z.strictObject({ id: entityId, name, role: text().optional(), level: level.optional(), tagIds });
const project = z.strictObject({
  id: entityId,
  name,
  client: text().optional(),
  sellerId: entityId.nullable(),
  status: z.enum(['pipeline', 'won', 'lost']),
  tagIds,
  startWeek: weekKey.optional(),
  endWeek: weekKey.optional(),
  notes: text(5000).optional(),
});
const weekly = z
  .record(weekKey, step.refine((v) => v > 0, 'empty weeks are left out'))
  .refine((w) => Object.keys(w).length <= 520, 'too many weeks');
const role = z.strictObject({
  id: entityId,
  projectId: entityId,
  resourceId: entityId.nullable(),
  name: text(),
  level: level.optional(),
  tagIds,
  weekly,
});
const settings = z.strictObject({
  overallocationThreshold: z.number().positive().max(1000),
  criticalThreshold: z.number().positive().max(1000),
  utilizationTargets: z.partialRecord(level, z.number().min(0).max(100)).optional(),
});

/** A patch over an entity's fields (id excluded). */
const patch = <S extends z.ZodRawShape>(shape: S) => {
  const fields = Object.keys(shape).filter((k) => k !== 'id') as [string, ...string[]];
  return z.strictObject({
    set: z.strictObject(shape).omit({ id: true } as never).partial().optional(),
    unset: z.array(z.enum(fields)).max(fields.length).optional(),
  });
};

const plan = z.strictObject({
  version: z.literal(4),
  tags: z.array(tag).max(500),
  sellers: z.array(seller).max(1000),
  resources: z.array(resource).max(5000),
  projects: z.array(project).max(5000),
  assignments: z.array(role).max(20000),
  settings,
});

const leaf = z.discriminatedUnion('t', [
  z.strictObject({ t: z.literal('tag.add'), tag }),
  z.strictObject({ t: z.literal('tag.update'), id: entityId, p: patch(tag.shape) }),
  z.strictObject({ t: z.literal('tag.delete'), id: entityId }),
  z.strictObject({ t: z.literal('seller.add'), seller }),
  z.strictObject({ t: z.literal('seller.update'), id: entityId, p: patch(seller.shape) }),
  z.strictObject({ t: z.literal('seller.delete'), id: entityId }),
  z.strictObject({ t: z.literal('resource.add'), resource }),
  z.strictObject({ t: z.literal('resource.update'), id: entityId, p: patch(resource.shape) }),
  z.strictObject({ t: z.literal('resource.delete'), id: entityId }),
  z.strictObject({ t: z.literal('project.add'), project }),
  z.strictObject({
    t: z.literal('project.update'),
    id: entityId,
    p: patch(project.shape),
    shift: z.strictObject({ from: weekKey, weeks: z.number().int().min(-260).max(260) }).optional(),
  }),
  z.strictObject({ t: z.literal('project.delete'), id: entityId }),
  z.strictObject({ t: z.literal('role.add'), role }),
  z.strictObject({
    t: z.literal('role.update'),
    id: entityId,
    p: patch({ id: entityId, name: text(), level, tagIds }),
  }),
  z.strictObject({ t: z.literal('role.assign'), id: entityId, resourceId: entityId.nullable() }),
  z.strictObject({ t: z.literal('role.delete'), id: entityId }),
  z.strictObject({
    t: z.literal('cells.set'),
    edits: z
      .array(z.strictObject({ roleId: entityId, weeks: z.array(weekKey).max(520), value: step }))
      .max(5000),
  }),
  z.strictObject({
    t: z.literal('settings.update'),
    set: settings.pick({ overallocationThreshold: true, criticalThreshold: true }).partial().optional(),
    targets: z.partialRecord(level, z.number().min(0).max(100).nullable()).optional(),
  }),
  z.strictObject({ t: z.literal('plan.replace'), plan }),
]);

const group = z.strictObject({ t: z.literal('group'), label: text().optional(), ops: z.array(leaf).min(1).max(200) });

export const opSchema = z.union([leaf, group]);

/** Validates an op from a browser. Returns an error message, or the op. */
export function parseOp(input: unknown): { op: Op } | { error: string } {
  const r = opSchema.safeParse(input);
  if (!r.success) {
    const issue = r.error.issues[0];
    return { error: `${issue.path.join('.') || 'op'}: ${issue.message}` };
  }
  const op = r.data as Op;
  const cells = (o: Op): number =>
    o.t === 'cells.set' ? o.edits.reduce((n, e) => n + e.weeks.length, 0) : o.t === 'group' ? o.ops.reduce((n, x) => n + cells(x), 0) : 0;
  if (cells(op) > MAX_CELLS) return { error: `too many cells in one edit (max ${MAX_CELLS})` };
  return { op };
}

export const planDataSchema = plan;

const lockNote = text(200).optional();
/** A lock as sent by a browser (the server adds owner and time). */
export const newLockSchema = z.discriminatedUnion('scope', [
  z.strictObject({
    scope: z.literal('cells'),
    id: entityId,
    roleIds: z.array(entityId).min(1).max(500),
    from: weekKey,
    to: weekKey,
    note: lockNote,
  }),
  z.strictObject({ scope: z.literal('role'), id: entityId, roleId: entityId, note: lockNote }),
  z.strictObject({ scope: z.literal('project'), id: entityId, projectId: entityId, note: lockNote }),
  z.strictObject({ scope: z.literal('past'), id: entityId, note: lockNote }),
]);

/** The full shape each kind of entity must have. */
export const entitySchemas = { tag, seller, resource, project, role, settings } as const;

/**
 * Checks every entity a change touched, as it now is, against its full
 * schema. Patches are only checked for shape, so this is what stops an op
 * from leaving an entity broken (e.g. unsetting a required field).
 * Returns a message for the first broken entity, or null.
 */
export function validateChanged(after: PlanData, changes: Change[]): string | null {
  const seen = new Set<string>();
  for (const c of changes) {
    const key = `${c.kind}:${c.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const value = c.kind === 'settings' ? after.settings : getEntity(after, c.kind, c.id);
    if (value === null) continue; // deleted
    const r = entitySchemas[c.kind].safeParse(value);
    if (!r.success) {
      const issue = r.error.issues[0];
      const label = (value as { name?: string }).name ? `“${(value as { name: string }).name}”` : c.id;
      return `That would leave ${c.kind === 'role' ? 'role' : c.kind} ${label} invalid (${issue.path.join('.') || c.kind}: ${issue.message}).`;
    }
  }
  return null;
}
