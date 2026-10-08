import { weekClass, type SplitLoads } from './load';
import type { CareerLevel, PlanData, PlanSettings, WeekKey } from './types';
import { addWeeks, currentWeek } from './weeks';

/** How far ahead "projected utilization" and "underutilized" look. */
export const LOOKAHEAD_WEEKS = 10;

/** The current week and the following LOOKAHEAD_WEEKS - 1. */
export function lookaheadWeeks(from: WeekKey = currentWeek(), n = LOOKAHEAD_WEEKS): WeekKey[] {
  return Array.from({ length: n }, (_, i) => addWeeks(from, i));
}

export interface Utilization {
  /** Average weekly % on won workstreams. */
  delivery: number;
  /** Average weekly % on pipeline (and lost) workstreams: presales effort plus delivery that's tentative until won. */
  pipeline: number;
  /** Part of `pipeline` that is presales (counts toward load whatever the outcome). */
  presales: number;
  /**
   * Average committed % (presales + won delivery): what underutilization is judged on.
   * Each week is capped at 100% first, so a 150% week can't offset an idle one.
   */
  committed: number;
}

/** A week counts for at most this much toward someone's average committed utilization. */
export const UTILIZATION_CAP = 100;

const ZERO: Utilization = { delivery: 0, pipeline: 0, presales: 0, committed: 0 };

/**
 * Per-person average weekly utilization over the given weeks, split by the
 * status of the workstream the work is on. Delivery on lost workstreams is
 * excluded, as everywhere else. Only `committed` is capped at 100% per week;
 * delivery and pipeline are uncapped breakdowns.
 */
export function utilizationByResource(
  plan: Pick<PlanData, 'assignments' | 'projects'>,
  loads: SplitLoads,
  weeks: WeekKey[],
): Map<string, Utilization> {
  const status = new Map(plan.projects.map((p) => [p.id, p.status]));
  const out = new Map<string, Utilization>();
  if (weeks.length === 0) return out;
  for (const a of plan.assignments) {
    for (const w of weeks) {
      const pct = a.weekly[w];
      if (!pct) continue;
      const cls = loads.classAt(a, w);
      if (cls === 'excluded') continue;
      const u = out.get(a.resourceId) ?? { ...ZERO };
      const share = pct / weeks.length;
      if (status.get(a.projectId) === 'won') u.delivery += share;
      else {
        u.pipeline += share;
        if (cls === 'committed') u.presales += share;
      }
      out.set(a.resourceId, u);
    }
  }
  // Committed is capped per person per week, so it's taken from the weekly totals, not summed per assignment.
  for (const [resourceId, totals] of loads.committed) {
    const u = out.get(resourceId) ?? { ...ZERO };
    u.committed = weeks.reduce((n, w) => n + Math.min(totals.get(w) ?? 0, UTILIZATION_CAP), 0) / weeks.length;
    out.set(resourceId, u);
  }
  return out;
}

export function utilizationOf(map: Map<string, Utilization>, resourceId: string): Utilization {
  return map.get(resourceId) ?? ZERO;
}

/** Team average: the mean of each person's utilization (so it reads as "% of the team's capacity"). */
export function teamUtilization(map: Map<string, Utilization>, resourceIds: string[]): Utilization {
  const n = resourceIds.length;
  const sum = { ...ZERO };
  if (n === 0) return sum;
  for (const id of resourceIds) {
    const u = utilizationOf(map, id);
    sum.delivery += u.delivery / n;
    sum.pipeline += u.pipeline / n;
    sum.presales += u.presales / n;
    sum.committed += u.committed / n;
  }
  return sum;
}

/** Default expected utilization by level: senior people are expected to sell and lead, not just deliver. */
export const DEFAULT_TARGETS: Record<CareerLevel, number> = { D: 40, SM: 60, M: 80, SA: 90, A: 90 };
/** Target for people without a level. */
export const NO_LEVEL_TARGET = 100;

export function utilizationTarget(settings: Pick<PlanSettings, 'utilizationTargets'>, level: CareerLevel | undefined): number {
  if (!level) return NO_LEVEL_TARGET;
  return settings.utilizationTargets?.[level] ?? DEFAULT_TARGETS[level];
}

export interface CapabilityDemand {
  /** Tag id, or null for open roles without capabilities. */
  tagId: string | null;
  /** Average open-role FTE on won workstreams. */
  won: number;
  /** Average open-role FTE on pipeline workstreams (presales + delivery if won). */
  pipeline: number;
  /** Average free FTE among people with the capability: 100% minus committed work, per week. */
  available: number;
}

/**
 * Open demand vs free capacity per capability over the given weeks, for
 * capabilities with open demand. A role needing two capabilities counts
 * under each, and a person with two counts toward each, so rows don't sum.
 */
export function demandByCapability(
  plan: Pick<PlanData, 'roles' | 'projects' | 'resources'>,
  loads: SplitLoads,
  weeks: WeekKey[],
): CapabilityDemand[] {
  if (weeks.length === 0) return [];
  const projects = new Map(plan.projects.map((p) => [p.id, p]));
  const out = new Map<string | null, CapabilityDemand>();
  for (const role of plan.roles) {
    const project = projects.get(role.projectId);
    for (const w of weeks) {
      const pct = role.weekly[w];
      if (!pct || weekClass(project, w) === 'excluded') continue;
      for (const tagId of role.tagIds.length ? role.tagIds : [null]) {
        const row = out.get(tagId) ?? { tagId, won: 0, pipeline: 0, available: 0 };
        if (project?.status === 'won') row.won += pct / 100 / weeks.length;
        else row.pipeline += pct / 100 / weeks.length;
        out.set(tagId, row);
      }
    }
  }
  for (const row of out.values()) {
    const people = plan.resources.filter((r) => row.tagId === null || r.tagIds.includes(row.tagId));
    for (const r of people) {
      const committed = loads.committed.get(r.id);
      for (const w of weeks) row.available += Math.max(0, 100 - (committed?.get(w) ?? 0)) / 100 / weeks.length;
    }
  }
  return [...out.values()].sort((a, b) => b.won + b.pipeline - (a.won + a.pipeline));
}
