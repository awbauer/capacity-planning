import type { WeekTotals } from './aggregate';
import type { AllocationKind, Assignment, PlanData, PlanSettings, Project, ProjectStatus, WeekKey } from './types';

/** How an allocated week counts toward a person's load. */
export type LoadClass = 'committed' | 'tentative' | 'excluded';

/**
 * Whether a week of work on a workstream is presales or delivery, decided by
 * the calendar: weeks before the start date are presales, weeks from it are
 * delivery. Without a start date, a won workstream is all delivery and
 * anything else (pipeline, lost) is all presales.
 */
export function weekKind(project: Pick<Project, 'startWeek' | 'status'> | undefined, week: WeekKey): AllocationKind {
  if (!project) return 'delivery';
  if (project.startWeek) return week < project.startWeek ? 'presales' : 'delivery';
  return project.status === 'won' ? 'delivery' : 'presales';
}

/**
 * Presales effort is real time spent whatever the outcome, so it always
 * counts. Delivery counts once won, is tentative while in the pipeline and
 * drops out if lost.
 */
export function classify(kind: AllocationKind, status: ProjectStatus | undefined): LoadClass {
  if (kind === 'presales') return 'committed';
  if (status === 'won') return 'committed';
  if (status === 'pipeline') return 'tentative';
  return 'excluded';
}

export function weekClass(project: Pick<Project, 'startWeek' | 'status'> | undefined, week: WeekKey): LoadClass {
  return classify(weekKind(project, week), project?.status);
}

/** Pipeline work on a workstream at least this likely to be won (win %) is a likely risk; below it, a low one. */
export const LIKELY_WIN = 75;

export interface SplitLoads {
  committed: Map<string, WeekTotals>;
  tentative: Map<string, WeekTotals>;
  /** The part of `tentative` on pipeline workstreams at least LIKELY_WIN% likely to be won. */
  tentativeLikely: Map<string, WeekTotals>;
  /** Class of one week of one assignment. */
  classAt: (a: Assignment, week: WeekKey) => LoadClass;
}

export function splitLoads(plan: Pick<PlanData, 'assignments' | 'projects'>): SplitLoads {
  const projects = new Map(plan.projects.map((p) => [p.id, p]));
  const classAt = (a: Assignment, week: WeekKey) => weekClass(projects.get(a.projectId), week);
  const committed = new Map<string, WeekTotals>();
  const tentative = new Map<string, WeekTotals>();
  const tentativeLikely = new Map<string, WeekTotals>();
  const add = (target: Map<string, WeekTotals>, resourceId: string, w: WeekKey, pct: number) => {
    let totals = target.get(resourceId);
    if (!totals) target.set(resourceId, (totals = new Map()));
    totals.set(w, (totals.get(w) ?? 0) + pct);
  };
  for (const a of plan.assignments) {
    if (a.resourceId === null) continue; // Open roles are nobody's load.
    const likely = (projects.get(a.projectId)?.winProbability ?? 0) >= LIKELY_WIN;
    for (const [w, pct] of Object.entries(a.weekly)) {
      if (!pct) continue;
      const cls = classAt(a, w);
      if (cls === 'excluded') continue;
      add(cls === 'committed' ? committed : tentative, a.resourceId, w, pct);
      if (cls === 'tentative' && likely) add(tentativeLikely, a.resourceId, w, pct);
    }
  }
  return { committed, tentative, tentativeLikely, classAt };
}

/**
 * 'over' (red): committed work is above the critical threshold (default 149%).
 * 'stretch' (yellow): committed work is above capacity but not critical (101–149%).
 * 'risk' (amber): committed work fits, but not if pipeline delivery is won.
 */
export type Severity = 'over' | 'stretch' | 'risk';

export const SEVERITY_RANK: Record<Severity, number> = { over: 3, stretch: 2, risk: 1 };

export function worse(a: Severity | null, b: Severity | null): Severity | null {
  if (!a) return b;
  if (!b) return a;
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/**
 * True when committed + pipeline load passes the red threshold. At-risk weeks
 * stay "at risk" (pipeline-driven) but are drawn red like an overallocation.
 */
export function totalIsCritical(
  committed: number,
  tentative: number,
  settings: Pick<PlanSettings, 'criticalThreshold'>,
): boolean {
  return committed + tentative > settings.criticalThreshold;
}

/**
 * An at-risk week is a low risk when the person only goes over if a pipeline
 * workstream under LIKELY_WIN% likely (or with no win % set) is won.
 */
export function isLowRisk(
  committed: number,
  likelyTentative: number,
  settings: Pick<PlanSettings, 'overallocationThreshold'>,
): boolean {
  return committed + likelyTentative <= settings.overallocationThreshold;
}

/** Whether a person's at-risk week is a low risk (see isLowRisk). */
export function lowRiskAt(loads: SplitLoads, resourceId: string, week: WeekKey, settings: Pick<PlanSettings, 'overallocationThreshold'>): boolean {
  return isLowRisk(
    loads.committed.get(resourceId)?.get(week) ?? 0,
    loads.tentativeLikely.get(resourceId)?.get(week) ?? 0,
    settings,
  );
}

export function severity(
  committed: number,
  tentative: number,
  settings: Pick<PlanSettings, 'overallocationThreshold' | 'criticalThreshold'>,
): Severity | null {
  if (committed > settings.criticalThreshold) return 'over';
  if (committed > settings.overallocationThreshold) return 'stretch';
  if (committed + tentative > settings.overallocationThreshold) return 'risk';
  return null;
}
