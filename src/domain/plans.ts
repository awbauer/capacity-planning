import type { PlanData } from './types';

/** Identity of a saved plan. Kept outside PlanData so undo never rewinds a name or revision. */
export interface PlanMeta {
  id: string;
  /** Unique (case-insensitive) among saved plans; import matches on it. */
  name: string;
  /** Incremented on every export, so files can be told apart. */
  revision: number;
}

export interface StoredPlan {
  meta: PlanMeta;
  plan: PlanData;
}

/** A parsed export file. */
export interface PlanFile {
  name: string;
  revision: number;
  plan: PlanData;
}

export const DEFAULT_PLAN_NAME = 'Default';
/** Id of the plan that existed before multiple plans; fixed so per-plan UI state can be migrated. */
export const DEFAULT_PLAN_ID = 'default';

export const defaultMeta = (): PlanMeta => ({ id: DEFAULT_PLAN_ID, name: DEFAULT_PLAN_NAME, revision: 0 });

export function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** The export file: name and revision first, then the plan itself. */
export function serializePlan(meta: PlanMeta, plan: PlanData): string {
  return JSON.stringify({ name: meta.name, revision: meta.revision, ...plan }, null, 2);
}

/** A name not used by any of `taken`: "Base", "Base 2", "Base 3"… */
export function uniqueName(base: string, taken: string[]): string {
  const name = base.trim() || 'Untitled';
  if (!taken.some((t) => sameName(t, name))) return name;
  for (let i = 2; ; i++) {
    const candidate = `${name} ${i}`;
    if (!taken.some((t) => sameName(t, candidate))) return candidate;
  }
}
