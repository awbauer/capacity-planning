import { createEmptyPlan } from './sampleData';
import type { Assignment, PlanData, PlanSettings } from './types';

/** The kinds of things a plan is made of, as stored and sent between browser and server. */
export type EntityKind = 'tag' | 'seller' | 'resource' | 'project' | 'role' | 'settings';

/** Plan arrays by entity kind (settings is a single object, not in this list). */
export const LIST_KINDS = [
  ['tag', 'tags'],
  ['seller', 'sellers'],
  ['resource', 'resources'],
  ['project', 'projects'],
  ['role', 'assignments'],
] as const;
type ListKind = (typeof LIST_KINDS)[number][0];
type ListKey = (typeof LIST_KINDS)[number][1];
const KEY_OF = Object.fromEntries(LIST_KINDS) as Record<ListKind, ListKey>;
export const SETTINGS_ID = 'settings';

/**
 * One recorded change. A create has `before: null` and the whole entity in
 * `after`; a delete the reverse. An update is one field (`field`), and for a
 * role's weekly allocation one week (`field: 'weekly'`, `week`), with the
 * value before and after (null = not set).
 */
export interface Change {
  kind: EntityKind;
  id: string;
  /** For roles: the workstream it's on (for filtering history by workstream). */
  projectId?: string;
  field?: string;
  week?: string;
  before: unknown;
  after: unknown;
}

/** A whole entity as it now is (null = deleted), as sent to browsers. */
export interface Put {
  k: EntityKind;
  id: string;
  v: unknown;
}

type Entity = { id: string } & Record<string, unknown>;

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

const nullish = (v: unknown) => (v === undefined ? null : v);

function diffEntity(kind: EntityKind, before: Entity, after: Entity, out: Change[]) {
  const projectId = kind === 'role' ? (after as unknown as Assignment).projectId : undefined;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const field of keys) {
    if (field === 'id') continue;
    const b = before[field];
    const a = after[field];
    if (kind === 'role' && field === 'weekly') {
      const bw = (b ?? {}) as Record<string, number>;
      const aw = (a ?? {}) as Record<string, number>;
      if (bw === aw) continue;
      for (const week of [...new Set([...Object.keys(bw), ...Object.keys(aw)])].sort()) {
        if ((bw[week] ?? 0) !== (aw[week] ?? 0)) {
          out.push({ kind, id: after.id, projectId, field, week, before: bw[week] ?? null, after: aw[week] ?? null });
        }
      }
    } else if (!deepEqual(b, a)) {
      out.push({ kind, id: after.id, ...(projectId ? { projectId } : {}), field, before: nullish(b), after: nullish(a) });
    }
  }
}

/**
 * Every change from `before` to `after`, field by field and (for
 * allocations) week by week. Entities kept by reference are skipped.
 */
export function diffPlans(before: PlanData, after: PlanData): Change[] {
  const out: Change[] = [];
  for (const [kind, key] of LIST_KINDS) {
    const b = before[key] as unknown as Entity[];
    const a = after[key] as unknown as Entity[];
    if (a === b) continue;
    const prev = new Map(b.map((x) => [x.id, x]));
    const next = new Map(a.map((x) => [x.id, x]));
    for (const x of b) {
      if (!next.has(x.id)) {
        const projectId = kind === 'role' ? (x as unknown as Assignment).projectId : undefined;
        out.push({ kind, id: x.id, ...(projectId ? { projectId } : {}), before: x, after: null });
      }
    }
    for (const x of a) {
      const old = prev.get(x.id);
      if (!old) {
        const projectId = kind === 'role' ? (x as unknown as Assignment).projectId : undefined;
        out.push({ kind, id: x.id, ...(projectId ? { projectId } : {}), before: null, after: x });
      } else if (old !== x) diffEntity(kind, old, x, out);
    }
  }
  if (before.settings !== after.settings) {
    diffEntity(
      'settings',
      { id: SETTINGS_ID, ...before.settings },
      { id: SETTINGS_ID, ...after.settings },
      out,
    );
  }
  return out;
}

/** Looks up an entity's current value. */
export function getEntity(plan: PlanData, kind: EntityKind, id: string): unknown {
  if (kind === 'settings') return plan.settings;
  return (plan[KEY_OF[kind]] as unknown as Entity[]).find((x) => x.id === id) ?? null;
}

/** The current value of every entity the changes touched. */
export function toPuts(plan: PlanData, changes: Change[]): Put[] {
  const seen = new Set<string>();
  const out: Put[] = [];
  for (const c of changes) {
    const key = `${c.kind}:${c.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ k: c.kind, id: c.id, v: getEntity(plan, c.kind, c.id) });
  }
  return out;
}

/**
 * Applies whole-entity puts: replaces in place, appends new ones, removes
 * deleted ones. Untouched entities and arrays keep their references, and no
 * puts returns the same plan.
 */
export function applyPuts(plan: PlanData, puts: Put[]): PlanData {
  if (puts.length === 0) return plan;
  const next: PlanData = { ...plan };
  for (const [kind, key] of LIST_KINDS) {
    const mine = puts.filter((p) => p.k === kind);
    if (mine.length === 0) continue;
    const byId = new Map(mine.map((p) => [p.id, p.v as Entity | null]));
    const list = plan[key] as unknown as Entity[];
    const kept: Entity[] = [];
    for (const x of list) {
      if (!byId.has(x.id)) kept.push(x);
      else {
        const v = byId.get(x.id);
        if (v) kept.push(deepEqual(v, x) ? x : v);
        byId.delete(x.id);
      }
    }
    for (const v of byId.values()) if (v) kept.push(v);
    (next as unknown as Record<string, Entity[]>)[key] = kept;
  }
  const settings = puts.find((p) => p.k === 'settings');
  if (settings?.v && !deepEqual(settings.v, plan.settings)) next.settings = settings.v as PlanSettings;
  return next;
}

/** Every entity in a plan as puts, in order (for storing a whole plan). */
export function planEntities(plan: PlanData): Put[] {
  const out: Put[] = [];
  for (const [kind, key] of LIST_KINDS) {
    for (const x of plan[key] as unknown as Entity[]) out.push({ k: kind, id: x.id, v: x });
  }
  out.push({ k: 'settings', id: SETTINGS_ID, v: plan.settings });
  return out;
}

/** Rebuilds a plan from stored entities (in their stored order). */
export function planFromEntities(rows: { k: EntityKind; v: unknown }[]): PlanData {
  const plan = createEmptyPlan();
  for (const r of rows) {
    if (r.k === 'settings') plan.settings = r.v as PlanSettings;
    else (plan[KEY_OF[r.k]] as unknown as unknown[]).push(r.v);
  }
  return plan;
}
