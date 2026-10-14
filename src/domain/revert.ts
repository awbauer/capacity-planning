import { deepEqual, getEntity, LIST_KINDS, type Change, type EntityKind } from './diff';
import { applyOp, type Op } from './ops';
import type { Assignment, PlanData } from './types';

export interface RevertResult {
  plan: PlanData;
  /** Changes left alone because someone changed the same thing since. */
  skipped: Change[];
}

const KEY_OF = Object.fromEntries(LIST_KINDS) as Record<Exclude<EntityKind, 'settings'>, keyof PlanData>;
const ORDER: EntityKind[] = ['tag', 'seller', 'resource', 'project', 'role', 'settings'];
const DELETE_OP: Record<Exclude<EntityKind, 'settings'>, Op['t']> = {
  tag: 'tag.delete',
  seller: 'seller.delete',
  resource: 'resource.delete',
  project: 'project.delete',
  role: 'role.delete',
};

type Entity = { id: string } & Record<string, unknown>;
/** Fields that are always present and may be null (null is a value, not "unset"). */
const NULLABLE_FIELDS = new Set(['resourceId', 'sellerId']);

function replaceEntity(plan: PlanData, kind: EntityKind, next: Entity): PlanData {
  if (kind === 'settings') {
    const { id: _id, ...settings } = next;
    return { ...plan, settings: settings as unknown as PlanData['settings'] };
  }
  const key = KEY_OF[kind];
  const list = plan[key] as unknown as Entity[];
  const i = list.findIndex((x) => x.id === next.id);
  const copy = list.slice();
  if (i < 0) copy.push(next);
  else copy[i] = next;
  return { ...plan, [key]: copy };
}

const asEntity = (plan: PlanData, kind: EntityKind, id: string): Entity | null => {
  const v = getEntity(plan, kind, id);
  if (!v) return null;
  return kind === 'settings' ? ({ id, ...(v as object) } as Entity) : (v as Entity);
};

/** Whether anything in the plan refers to this entity (so deleting it would cascade). */
function hasDependents(plan: PlanData, kind: EntityKind, id: string): boolean {
  switch (kind) {
    case 'project':
      return plan.assignments.some((a) => a.projectId === id);
    case 'resource':
      return plan.assignments.some((a) => a.resourceId === id);
    case 'seller':
      return plan.projects.some((p) => p.sellerId === id);
    case 'tag':
      return [...plan.resources, ...plan.projects, ...plan.assignments].some((x) => x.tagIds.includes(id));
    default:
      return false;
  }
}

/**
 * Drops or clears references to things that no longer exist (after a revert
 * brings back a role whose workstream is gone, say). Untouched entities keep
 * their references.
 */
export function normalizeRefs(plan: PlanData): PlanData {
  const tags = new Set(plan.tags.map((t) => t.id));
  const sellers = new Set(plan.sellers.map((s) => s.id));
  const resources = new Set(plan.resources.map((r) => r.id));
  const projects = new Set(plan.projects.map((p) => p.id));
  const cleanTags = <T extends { tagIds: string[] }>(x: T): T =>
    x.tagIds.every((t) => tags.has(t)) ? x : { ...x, tagIds: x.tagIds.filter((t) => tags.has(t)) };
  const mapKeep = <T>(list: T[], fn: (x: T) => T): T[] => {
    const next = list.map(fn);
    return next.every((x, i) => x === list[i]) ? list : next;
  };
  const assignments = plan.assignments.filter((a) => projects.has(a.projectId));
  return {
    ...plan,
    resources: mapKeep(plan.resources, cleanTags),
    projects: mapKeep(plan.projects, (p) => {
      const q = cleanTags(p);
      return q.sellerId && !sellers.has(q.sellerId) ? { ...q, sellerId: null } : q;
    }),
    assignments: mapKeep(assignments.length === plan.assignments.length ? plan.assignments : assignments, (a) => {
      const q = cleanTags(a);
      return q.resourceId && !resources.has(q.resourceId) ? { ...q, resourceId: null } : q;
    }),
  };
}

/**
 * Undoes a recorded batch of changes on top of the current plan. Each change
 * is only undone where the current value is still what the batch wrote, so
 * later edits by anyone are kept (and returned as skipped). Deleted things
 * come back first, then fields and weeks are restored, then things the batch
 * created are removed (with the usual cascades), then dangling references
 * are cleaned up.
 */
export function revertChanges(plan: PlanData, changes: Change[]): RevertResult {
  const skipped: Change[] = [];
  let next = plan;
  const byOrder = (a: Change, b: Change) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind);

  // 1. Bring back what the batch deleted.
  for (const c of changes.filter((c) => c.after === null && c.field === undefined).sort(byOrder)) {
    if (getEntity(next, c.kind, c.id)) skipped.push(c);
    else next = replaceEntity(next, c.kind, c.before as Entity);
  }

  // 2. Restore fields and weeks it changed.
  for (const c of [...changes].reverse()) {
    if (c.field === undefined) continue;
    const current = asEntity(next, c.kind, c.id);
    if (!current) {
      skipped.push(c);
      continue;
    }
    if (c.field === 'weekly' && c.week) {
      const role = current as unknown as Assignment;
      if ((role.weekly[c.week] ?? null) !== c.after) {
        skipped.push(c);
        continue;
      }
      const weekly = { ...role.weekly };
      if (c.before === null) delete weekly[c.week];
      else weekly[c.week] = c.before as number;
      next = replaceEntity(next, c.kind, { ...current, weekly });
    } else {
      if (!deepEqual(current[c.field] ?? null, c.after)) {
        skipped.push(c);
        continue;
      }
      const updated: Entity = { ...current };
      if (c.before === null && !NULLABLE_FIELDS.has(c.field)) delete updated[c.field];
      else updated[c.field] = c.before;
      next = replaceEntity(next, c.kind, updated);
    }
  }

  // 3. Remove what it created (children first, so cascades don't hide them), unless it
  //    was changed since or something else now depends on it: deleting it would take
  //    other people's work with it.
  for (const c of changes.filter((c) => c.before === null && c.field === undefined).sort(byOrder).reverse()) {
    if (c.kind === 'settings') continue;
    const current = getEntity(next, c.kind, c.id);
    if (!current) continue;
    if (!deepEqual(current, c.after) || hasDependents(next, c.kind, c.id)) {
      skipped.push(c);
      continue;
    }
    next = applyOp(next, { t: DELETE_OP[c.kind], id: c.id } as Op);
  }

  return { plan: normalizeRefs(next), skipped };
}
