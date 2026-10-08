import { severity, splitLoads, type LoadClass, type Severity, type SplitLoads } from './load';
import type { Assignment, PlanData, Project, Resource, WeekKey } from './types';
import { addWeeks } from './weeks';

export interface Overallocation {
  resourceId: string;
  severity: Severity;
  from: WeekKey;
  to: WeekKey;
  weeks: WeekKey[];
  /** Highest committed load in the run ('over'/'stretch') or committed + tentative ('risk'). */
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
  const settings = plan.settings;
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
        peak: Math.max(...run.map((w) => (sev === 'risk' ? c(w) + t(w) : c(w)))),
        projectIds: [...projectIds],
      });
      run = [];
      runSeverity = null;
    };

    for (const w of weeks) {
      const sev = severity(c(w), t(w), settings);
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

/** Of the given weeks, those in which this assignment adds to a flagged week, by severity. */
export function assignmentFlagWeeks(
  a: Assignment,
  weeks: WeekKey[],
  loads: SplitLoads,
  settings: PlanData['settings'],
): Record<Severity, WeekKey[]> {
  const flags: Record<Severity, WeekKey[]> = { over: [], stretch: [], risk: [] };
  if (a.resourceId === null) return flags; // An open role is nobody's load.
  const committed = loads.committed.get(a.resourceId);
  const tentative = loads.tentative.get(a.resourceId);
  for (const w of weeks) {
    if (!a.weekly[w] || loads.classAt(a, w) === 'excluded') continue;
    const sev = severity(committed?.get(w) ?? 0, tentative?.get(w) ?? 0, settings);
    if (sev) flags[sev].push(w);
  }
  return flags;
}

/** Capabilities a role needs: its own, or else its workstream's. */
export function requiredTags(role: Pick<Assignment, 'tagIds'>, project: Pick<Project, 'tagIds'>): string[] {
  return role.tagIds.length ? role.tagIds : project.tagIds;
}

/** True when the role (or its workstream) requires capabilities and the person has none of them. */
export function isSkillMismatch(resource: Resource, project: Project, role: Pick<Assignment, 'tagIds'> = { tagIds: [] }): boolean {
  const need = requiredTags(role, project);
  if (need.length === 0) return false;
  return !resource.tagIds.some((t) => need.includes(t));
}

/**
 * Required tags that neither a person on the workstream nor an open role has.
 * An open role counts as covering its capabilities: the gap is planned.
 * Projects with no roles yet return [] — they're unstaffed, which the grid
 * already shows.
 */
export function uncoveredTags(project: Project, plan: Pick<PlanData, 'assignments' | 'resources'>): string[] {
  const resourcesById = new Map(plan.resources.map((r) => [r.id, r]));
  const covered = new Set<string>();
  let staffed = false;
  for (const a of plan.assignments) {
    if (a.projectId !== project.id) continue;
    staffed = true;
    const tags = a.resourceId === null ? a.tagIds : (resourcesById.get(a.resourceId)?.tagIds ?? []);
    for (const t of tags) covered.add(t);
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
    const r = a.resourceId === null ? undefined : resourcesById.get(a.resourceId);
    const p = projectsById.get(a.projectId);
    if (r && p && p.status !== 'lost' && isSkillMismatch(r, p, a)) {
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

/** True when the person is over (or at risk of being over) capacity in any of the given weeks. */
export function resourceLoadFlagged(
  resourceId: string,
  weeks: WeekKey[],
  loads: SplitLoads,
  settings: PlanData['settings'],
): boolean {
  const committed = loads.committed.get(resourceId);
  const tentative = loads.tentative.get(resourceId);
  return weeks.some((w) => severity(committed?.get(w) ?? 0, tentative?.get(w) ?? 0, settings) !== null);
}
