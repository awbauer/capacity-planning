import { resourceLoad, type WeekTotals } from './aggregate';
import type { AllocationKind, Assignment, PlanData, ProjectStatus, WeekKey } from './types';

/** How an assignment's hours count toward a person's load. */
export type LoadClass = 'committed' | 'tentative' | 'excluded';

export function classify(kind: AllocationKind, status: ProjectStatus | undefined): LoadClass {
  if (kind === 'presales') return 'committed';
  if (status === 'won') return 'committed';
  if (status === 'pipeline') return 'tentative';
  return 'excluded';
}

export interface SplitLoads {
  committed: Map<string, WeekTotals>;
  tentative: Map<string, WeekTotals>;
  classOf: Map<string, LoadClass>;
}

export function splitLoads(plan: Pick<PlanData, 'assignments' | 'projects'>): SplitLoads {
  const status = new Map(plan.projects.map((p) => [p.id, p.status]));
  const classOf = new Map<string, LoadClass>();
  const committed: Assignment[] = [];
  const tentative: Assignment[] = [];
  for (const a of plan.assignments) {
    const cls = classify(a.kind, status.get(a.projectId));
    classOf.set(a.id, cls);
    if (cls === 'committed') committed.push(a);
    else if (cls === 'tentative') tentative.push(a);
  }
  return { committed: resourceLoad(committed), tentative: resourceLoad(tentative), classOf };
}

/**
 * 'over': committed work alone exceeds the threshold — a real conflict.
 * 'risk': it only exceeds it if pipeline delivery work is won as planned.
 */
export type Severity = 'over' | 'risk';

export function severity(committed: number, tentative: number, threshold: number): Severity | null {
  if (committed > threshold) return 'over';
  if (committed + tentative > threshold) return 'risk';
  return null;
}

export function weekSeverity(
  loads: Pick<SplitLoads, 'committed' | 'tentative'>,
  resourceId: string,
  week: WeekKey,
  threshold: number,
): Severity | null {
  return severity(
    loads.committed.get(resourceId)?.get(week) ?? 0,
    loads.tentative.get(resourceId)?.get(week) ?? 0,
    threshold,
  );
}
