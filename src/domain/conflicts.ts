import { severity, splitLoads, type LoadClass, type Severity, type SplitLoads } from './load';
import type { Assignment, PlanData, Project, Resource, WeekKey } from './types';
import { addWeeks } from './weeks';

export interface Overallocation {
  resourceId: string;
  severity: Severity;
  from: WeekKey;
  to: WeekKey;
  weeks: WeekKey[];
  /** Highest committed load in the run (for 'over') or committed + tentative (for 'risk'). */
  peak: number;
  /** Projects with a counted, non-zero allocation in any of these weeks. */
  projectIds: string[];
}

export type SkillIssue =
  | { kind: 'mismatch'; assignmentId: string; projectId: string; resourceId: string }
  | { kind: 'uncovered'; projectId: string; tagIds: string[] };

export function isOver(total: number, threshold: number): boolean {
  return total > threshold;
}

/**
 * Weeks where a resource is over the threshold, merged into runs of
 * consecutive weeks with the same severity.
 */
export function findOverallocations(plan: PlanData, loads: SplitLoads = splitLoads(plan)): Overallocation[] {
  const threshold = plan.settings.overallocationThreshold;
  const out: Overallocation[] = [];
  const resourceIds = new Set([...loads.committed.keys(), ...loads.tentative.keys()]);

  for (const resourceId of resourceIds) {
    const committed = loads.committed.get(resourceId);
    const tentative = loads.tentative.get(resourceId);
    const c = (w: WeekKey) => committed?.get(w) ?? 0;
    const t = (w: WeekKey) => tentative?.get(w) ?? 0;
    const weeks = [...new Set([...(committed?.keys() ?? []), ...(tentative?.keys() ?? [])])].sort();
    const mine = plan.assignments.filter((a) => a.resourceId === resourceId);

    let run: WeekKey[] = [];
    let runSeverity: Severity | null = null;
    const flush = () => {
      if (!runSeverity || run.length === 0) return;
      const sev = runSeverity;
      const counts = (cls: LoadClass | undefined) =>
        cls === 'committed' || (sev === 'risk' && cls === 'tentative');
      const projectIds = new Set<string>();
      for (const a of mine) {
        if (run.some((w) => a.weekly[w] && counts(loads.classAt(a, w)))) projectIds.add(a.projectId);
      }
      out.push({
        resourceId,
        severity: sev,
        from: run[0],
        to: run[run.length - 1],
        weeks: run,
        peak: Math.max(...run.map((w) => (sev === 'over' ? c(w) : c(w) + t(w)))),
        projectIds: [...projectIds],
      });
      run = [];
      runSeverity = null;
    };

    for (const w of weeks) {
      const sev = severity(c(w), t(w), threshold);
      const continues = sev !== null && sev === runSeverity && addWeeks(run[run.length - 1], 1) === w;
      if (!continues) flush();
      if (sev) {
        run.push(w);
        runSeverity = sev;
      }
    }
    flush();
  }
  return out.sort(
    (a, b) =>
      a.from.localeCompare(b.from) || a.resourceId.localeCompare(b.resourceId) || a.severity.localeCompare(b.severity),
  );
}

/** Of the given weeks, those in which this assignment adds to an 'over' or 'risk' week. */
export function assignmentFlagWeeks(
  a: Assignment,
  weeks: WeekKey[],
  loads: SplitLoads,
  threshold: number,
): Record<Severity, WeekKey[]> {
  const flags: Record<Severity, WeekKey[]> = { over: [], risk: [] };
  const committed = loads.committed.get(a.resourceId);
  const tentative = loads.tentative.get(a.resourceId);
  for (const w of weeks) {
    if (!a.weekly[w] || loads.classAt(a, w) === 'excluded') continue;
    const sev = severity(committed?.get(w) ?? 0, tentative?.get(w) ?? 0, threshold);
    if (sev) flags[sev].push(w);
  }
  return flags;
}

/** True when the project requires capabilities and the resource has none of them. */
export function isSkillMismatch(resource: Resource, project: Project): boolean {
  if (project.tagIds.length === 0) return false;
  return !resource.tagIds.some((t) => project.tagIds.includes(t));
}

/**
 * Required tags that no resource assigned to the project has. Projects with no
 * assignments yet return [] — they're unstaffed, which the grid already shows.
 */
export function uncoveredTags(
  project: Project,
  plan: Pick<PlanData, 'assignments' | 'resources'>,
): string[] {
  const resourcesById = new Map(plan.resources.map((r) => [r.id, r]));
  const covered = new Set<string>();
  let staffed = false;
  for (const a of plan.assignments) {
    if (a.projectId !== project.id) continue;
    staffed = true;
    for (const t of resourcesById.get(a.resourceId)?.tagIds ?? []) covered.add(t);
  }
  if (!staffed) return [];
  return project.tagIds.filter((t) => !covered.has(t));
}

/** Skill problems on live projects (lost projects are ignored). */
export function findSkillIssues(plan: PlanData): SkillIssue[] {
  const resourcesById = new Map(plan.resources.map((r) => [r.id, r]));
  const projectsById = new Map(plan.projects.map((p) => [p.id, p]));
  const issues: SkillIssue[] = [];
  for (const a of plan.assignments) {
    const r = resourcesById.get(a.resourceId);
    const p = projectsById.get(a.projectId);
    if (r && p && p.status !== 'lost' && isSkillMismatch(r, p)) {
      issues.push({ kind: 'mismatch', assignmentId: a.id, projectId: p.id, resourceId: r.id });
    }
  }
  for (const p of plan.projects) {
    if (p.status === 'lost') continue;
    const tagIds = uncoveredTags(p, plan);
    if (tagIds.length) issues.push({ kind: 'uncovered', projectId: p.id, tagIds });
  }
  return issues;
}
