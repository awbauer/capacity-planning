import type { WeekTotals } from './aggregate';
import type { AllocationKind, Assignment, PlanData, Project, ProjectStatus, WeekKey } from './types';

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

export interface SplitLoads {
  committed: Map<string, WeekTotals>;
  tentative: Map<string, WeekTotals>;
  /** Class of one week of one assignment. */
  classAt: (a: Assignment, week: WeekKey) => LoadClass;
}

export function splitLoads(plan: Pick<PlanData, 'assignments' | 'projects'>): SplitLoads {
  const projects = new Map(plan.projects.map((p) => [p.id, p]));
  const classAt = (a: Assignment, week: WeekKey) => weekClass(projects.get(a.projectId), week);
  const committed = new Map<string, WeekTotals>();
  const tentative = new Map<string, WeekTotals>();
  for (const a of plan.assignments) {
    for (const [w, pct] of Object.entries(a.weekly)) {
      if (!pct) continue;
      const cls = classAt(a, w);
      if (cls === 'excluded') continue;
      const target = cls === 'committed' ? committed : tentative;
      let totals = target.get(a.resourceId);
      if (!totals) target.set(a.resourceId, (totals = new Map()));
      totals.set(w, (totals.get(w) ?? 0) + pct);
    }
  }
  return { committed, tentative, classAt };
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
