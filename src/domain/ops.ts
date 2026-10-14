import { snapToStep } from './steps';
import type {
  Assignment,
  CapabilityTag,
  CareerLevel,
  PlanData,
  PlanSettings,
  Project,
  Resource,
  Seller,
  WeekKey,
} from './types';
import { shiftWeekly } from './weeks';

/**
 * A field-level change to one entity. `unset` removes optional fields
 * (JSON can't carry `undefined`, so clearing is explicit).
 */
export interface Patch<T> {
  set?: Partial<T>;
  unset?: (keyof T & string)[];
}

export type RoleFields = Pick<Assignment, 'name' | 'level' | 'tagIds'>;
export type ThresholdFields = Pick<PlanSettings, 'overallocationThreshold' | 'criticalThreshold'>;

export interface CellEdit {
  roleId: string;
  weeks: WeekKey[];
  /** 0/25/50/100; 0 clears the weeks. */
  value: number;
}

/**
 * One edit to a plan. Ops are deterministic: the caller resolves everything
 * that depends on the current state (new ids, tag colours, reuse of an
 * existing role, snapping) before dispatching, so the same op gives the same
 * result in the browser and on the server.
 */
export type Op =
  | { t: 'tag.add'; tag: CapabilityTag }
  | { t: 'tag.update'; id: string; p: Patch<Omit<CapabilityTag, 'id'>> }
  | { t: 'tag.delete'; id: string }
  | { t: 'seller.add'; seller: Seller }
  | { t: 'seller.update'; id: string; p: Patch<Omit<Seller, 'id'>> }
  | { t: 'seller.delete'; id: string }
  | { t: 'resource.add'; resource: Resource }
  | { t: 'resource.update'; id: string; p: Patch<Omit<Resource, 'id'>> }
  | { t: 'resource.delete'; id: string }
  | { t: 'project.add'; project: Project }
  | { t: 'project.update'; id: string; p: Patch<Omit<Project, 'id'>>; shift?: { from: WeekKey; weeks: number } }
  | { t: 'project.delete'; id: string }
  | { t: 'role.add'; role: Assignment }
  | { t: 'role.update'; id: string; p: Patch<RoleFields> }
  | { t: 'role.assign'; id: string; resourceId: string | null }
  | { t: 'role.delete'; id: string }
  | { t: 'cells.set'; edits: CellEdit[] }
  | {
      t: 'settings.update';
      set?: Partial<ThresholdFields>;
      /** null resets a level to its default target. */
      targets?: Partial<Record<CareerLevel, number | null>>;
    }
  | { t: 'plan.replace'; plan: PlanData }
  | { t: 'group'; label?: string; ops: Op[] };

export type OpType = Op['t'];

/**
 * Splits a store-style patch (undefined = clear the field) into set/unset.
 * `id` is never part of a patch (callers often pass a whole entity).
 */
export function toPatch<T extends object>(patch: Partial<T>): Patch<T> {
  const set: Partial<T> = {};
  const unset: (keyof T & string)[] = [];
  for (const [k, v] of Object.entries(patch) as [keyof T & string, unknown][]) {
    if (k === 'id') continue;
    if (v === undefined) unset.push(k);
    else (set as Record<string, unknown>)[k] = v;
  }
  return { ...(Object.keys(set).length ? { set } : {}), ...(unset.length ? { unset } : {}) };
}

export function applyPatch<T extends object, P extends object>(obj: T, p: Patch<P>): T {
  const next = { ...obj, ...p.set } as Record<string, unknown>;
  for (const k of p.unset ?? []) delete next[k];
  return next as T;
}

/** Sets `weeks` to `value` (snapped; 0 deletes the week). */
export function fillWeekly(weekly: Record<WeekKey, number>, weeks: WeekKey[], value: number): Record<WeekKey, number> {
  const next = { ...weekly };
  const pct = snapToStep(value);
  for (const w of weeks) {
    if (pct === 0) delete next[w];
    else next[w] = pct;
  }
  return next;
}

const mapIf = <T extends { id: string }>(list: T[], id: string, fn: (x: T) => T): T[] => {
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return list;
  const next = list.slice();
  next[i] = fn(list[i]);
  return next;
};

/** Removes `tagId` from each item's tagIds, keeping untouched items (and the list) as they were. */
const stripTag = <T extends { tagIds: string[] }>(list: T[], tagId: string): T[] =>
  list.some((x) => x.tagIds.includes(tagId))
    ? list.map((x) => (x.tagIds.includes(tagId) ? { ...x, tagIds: x.tagIds.filter((t) => t !== tagId) } : x))
    : list;

/** Adds `item`, or replaces the one with its id (so re-applying an add is harmless). */
const upsert = <T extends { id: string }>(list: T[], item: T): T[] =>
  list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];

/**
 * Applies an op. Pure, and keeps every untouched entity (and array) by
 * reference, so derived data and undo history can compare by identity.
 * References to things that no longer exist are skipped, not thrown: in the
 * browser an op may be replayed on top of newer server state. The server
 * validates ops before applying them.
 */
export function applyOp(plan: PlanData, op: Op): PlanData {
  switch (op.t) {
    case 'tag.add':
      return { ...plan, tags: upsert(plan.tags, op.tag) };
    case 'tag.update':
      return { ...plan, tags: mapIf(plan.tags, op.id, (t) => applyPatch(t, op.p)) };
    case 'tag.delete':
      return {
        ...plan,
        tags: plan.tags.filter((t) => t.id !== op.id),
        resources: stripTag(plan.resources, op.id),
        projects: stripTag(plan.projects, op.id),
        assignments: stripTag(plan.assignments, op.id),
      };

    case 'seller.add':
      return { ...plan, sellers: upsert(plan.sellers, op.seller) };
    case 'seller.update':
      return { ...plan, sellers: mapIf(plan.sellers, op.id, (s) => applyPatch(s, op.p)) };
    case 'seller.delete':
      return {
        ...plan,
        sellers: plan.sellers.filter((s) => s.id !== op.id),
        projects: plan.projects.some((p) => p.sellerId === op.id)
          ? plan.projects.map((p) => (p.sellerId === op.id ? { ...p, sellerId: null } : p))
          : plan.projects,
      };

    case 'resource.add':
      return { ...plan, resources: upsert(plan.resources, op.resource) };
    case 'resource.update':
      return { ...plan, resources: mapIf(plan.resources, op.id, (r) => applyPatch(r, op.p)) };
    case 'resource.delete':
      return {
        ...plan,
        resources: plan.resources.filter((r) => r.id !== op.id),
        // Their roles stay, as open roles.
        assignments: plan.assignments.some((a) => a.resourceId === op.id)
          ? plan.assignments.map((a) => (a.resourceId === op.id ? { ...a, resourceId: null } : a))
          : plan.assignments,
      };

    case 'project.add':
      return { ...plan, projects: upsert(plan.projects, op.project) };
    case 'project.update': {
      const shift = op.shift && op.shift.weeks !== 0 ? op.shift : undefined;
      return {
        ...plan,
        projects: mapIf(plan.projects, op.id, (p) => applyPatch(p, op.p)),
        assignments: shift
          ? plan.assignments.map((a) =>
              a.projectId === op.id ? { ...a, weekly: shiftWeekly(a.weekly, shift.from, shift.weeks) } : a,
            )
          : plan.assignments,
      };
    }
    case 'project.delete':
      return {
        ...plan,
        projects: plan.projects.filter((p) => p.id !== op.id),
        assignments: plan.assignments.filter((a) => a.projectId !== op.id),
      };

    case 'role.add':
      return { ...plan, assignments: upsert(plan.assignments, op.role) };
    case 'role.update':
      return { ...plan, assignments: mapIf(plan.assignments, op.id, (a) => applyPatch(a, op.p)) };
    case 'role.assign':
      return { ...plan, assignments: mapIf(plan.assignments, op.id, (a) => ({ ...a, resourceId: op.resourceId })) };
    case 'role.delete':
      return { ...plan, assignments: plan.assignments.filter((a) => a.id !== op.id) };

    case 'cells.set': {
      if (op.edits.length === 0) return plan;
      const byRole = new Map<string, CellEdit[]>();
      for (const e of op.edits) byRole.set(e.roleId, [...(byRole.get(e.roleId) ?? []), e]);
      return {
        ...plan,
        assignments: plan.assignments.map((a) => {
          const mine = byRole.get(a.id);
          if (!mine) return a;
          let weekly = a.weekly;
          for (const e of mine) weekly = fillWeekly(weekly, e.weeks, e.value);
          return { ...a, weekly };
        }),
      };
    }

    case 'settings.update': {
      const settings: PlanSettings = { ...plan.settings };
      for (const [k, v] of Object.entries(op.set ?? {}) as [keyof ThresholdFields, number][]) {
        settings[k] = Math.max(1, Math.round(v));
      }
      if (op.targets) {
        const targets = { ...plan.settings.utilizationTargets };
        for (const [level, v] of Object.entries(op.targets) as [CareerLevel, number | null][]) {
          if (v === null) delete targets[level];
          else targets[level] = Math.min(100, Math.max(0, Math.round(v)));
        }
        settings.utilizationTargets = targets;
      }
      return { ...plan, settings };
    }

    case 'plan.replace':
      return op.plan;

    case 'group':
      return op.ops.reduce(applyOp, plan);
  }
}

/** Every op in `op`, with groups flattened. */
export function flattenOps(op: Op): Op[] {
  return op.t === 'group' ? op.ops.flatMap(flattenOps) : [op];
}
