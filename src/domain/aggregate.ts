import type { Assignment, WeekKey } from './types';

export type WeekTotals = Map<WeekKey, number>;

function addInto(totals: WeekTotals, weekly: Record<WeekKey, number>) {
  for (const [w, pct] of Object.entries(weekly)) {
    if (pct) totals.set(w, (totals.get(w) ?? 0) + pct);
  }
}

/** Total % per week for each resource, across all projects. */
export function resourceLoad(assignments: Assignment[]): Map<string, WeekTotals> {
  const load = new Map<string, WeekTotals>();
  for (const a of assignments) {
    let totals = load.get(a.resourceId);
    if (!totals) load.set(a.resourceId, (totals = new Map()));
    addInto(totals, a.weekly);
  }
  return load;
}

/** Total % per week for each project (sum over its assignments). */
export function projectLoad(assignments: Assignment[]): Map<string, WeekTotals> {
  const load = new Map<string, WeekTotals>();
  for (const a of assignments) {
    let totals = load.get(a.projectId);
    if (!totals) load.set(a.projectId, (totals = new Map()));
    addInto(totals, a.weekly);
  }
  return load;
}

export interface BucketStats {
  /** Mean over every week in the bucket (empty weeks count as 0). */
  avg: number;
  /** Highest single week in the bucket. Use this for conflict flags. */
  peak: number;
  /** True when weeks in the bucket hold different values. */
  mixed: boolean;
}

export function bucketStats(valueOf: (w: WeekKey) => number, weeks: WeekKey[]): BucketStats {
  if (weeks.length === 0) return { avg: 0, peak: 0, mixed: false };
  let sum = 0;
  let peak = 0;
  const first = valueOf(weeks[0]);
  let mixed = false;
  for (const w of weeks) {
    const v = valueOf(w);
    sum += v;
    if (v > peak) peak = v;
    if (v !== first) mixed = true;
  }
  return { avg: sum / weeks.length, peak, mixed };
}

export function totalsGetter(totals: WeekTotals | undefined): (w: WeekKey) => number {
  return (w) => totals?.get(w) ?? 0;
}
