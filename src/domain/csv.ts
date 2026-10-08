import { STATUS_LABELS } from './labels';
import { requiredTags } from './conflicts';
import { weekKind } from './load';
import type { PlanData, Project } from './types';
import { weeksBetween } from './weeks';

type Cell = string | number | null | undefined;

/** RFC 4180 quoting: wrap in quotes when needed, double any embedded quotes. */
export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Cell[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workstream';
}

/**
 * Weeks to show for a workstream: its start–end dates, widened to cover any
 * allocation outside them. Empty if it has neither dates nor allocations.
 */
export function workstreamWeeks(plan: PlanData, project: Project): string[] {
  const allocated = plan.assignments
    .filter((a) => a.projectId === project.id)
    .flatMap((a) => Object.keys(a.weekly).filter((w) => a.weekly[w]));
  const bounds = [...allocated, project.startWeek, project.endWeek].filter((w): w is string => !!w).sort();
  return bounds.length ? weeksBetween(bounds[0], bounds[bounds.length - 1]) : [];
}

/** People's roles first (by role, then person), then open roles. */
function byRole(resources: Map<string, { name: string }>) {
  return (x: PlanData['assignments'][number], y: PlanData['assignments'][number]) =>
    Number(x.resourceId === null) - Number(y.resourceId === null) ||
    x.name.localeCompare(y.name) ||
    (x.resourceId ? (resources.get(x.resourceId)?.name ?? '') : '').localeCompare(
      y.resourceId ? (resources.get(y.resourceId)?.name ?? '') : '',
    );
}

/**
 * One workstream's staffing plan, laid out for people to read: a details
 * block, then one row per role (who's in it, or "Open") with a column per
 * week (% allocation), a Phase row (presales before the start date, delivery
 * from it), and FTE totals for staffed and open roles.
 */
export function workstreamCsv(plan: PlanData, projectId: string): string {
  const project = plan.projects.find((p) => p.id === projectId);
  if (!project) throw new Error(`Unknown workstream ${projectId}`);
  const tags = new Map(plan.tags.map((t) => [t.id, t.name]));
  const resources = new Map(plan.resources.map((r) => [r.id, r]));
  const seller = plan.sellers.find((s) => s.id === project.sellerId);
  const weeks = workstreamWeeks(plan, project);
  const rows = plan.assignments.filter((a) => a.projectId === project.id).sort(byRole(resources));
  const sum = (list: typeof rows, w: string) => list.reduce((n, a) => n + (a.weekly[w] ?? 0), 0) / 100;

  const out: Cell[][] = [
    ['Workstream', project.name],
    ['Client', project.client],
    ['Seller', seller?.name],
    ['Status', STATUS_LABELS[project.status]],
    ['Start (week of)', project.startWeek],
    ['End (week of)', project.endWeek],
    ['Required capabilities', project.tagIds.map((t) => tags.get(t)).filter(Boolean).join('; ')],
    [],
    ['Role', 'Person', 'Level', 'Capabilities needed', ...weeks],
    ['Phase', '', '', '', ...weeks.map((w) => (weekKind(project, w) === 'presales' ? 'Presales' : 'Delivery'))],
  ];
  for (const a of rows) {
    const r = a.resourceId ? resources.get(a.resourceId) : undefined;
    out.push([
      a.name,
      a.resourceId === null ? 'Open' : (r?.name ?? '(deleted)'),
      r?.level ?? a.level,
      requiredTags(a, project).map((t) => tags.get(t)).filter(Boolean).join('; '),
      ...weeks.map((w) => a.weekly[w] ?? 0),
    ]);
  }
  const staffed = rows.filter((a) => a.resourceId !== null);
  const open = rows.filter((a) => a.resourceId === null);
  out.push(['Total FTE', '', '', '', ...weeks.map((w) => sum(staffed, w))]);
  if (open.length) out.push(['Open FTE', '', '', '', ...weeks.map((w) => sum(open, w))]);
  return toCsv(out);
}

/**
 * Every workstream's staffing in one long table (one line per role per
 * allocated week), which pivots cleanly in Excel or Sheets.
 */
export function allWorkstreamsCsv(plan: PlanData): string {
  const resources = new Map(plan.resources.map((r) => [r.id, r]));
  const projects = new Map(plan.projects.map((p) => [p.id, p]));
  const sellers = new Map(plan.sellers.map((s) => [s.id, s.name]));
  const out: Cell[][] = [
    ['Workstream', 'Client', 'Seller', 'Status', 'Role', 'Person', 'Level', 'Week of', 'Phase', 'Allocation %'],
  ];
  const lines: Cell[][] = [];
  for (const a of plan.assignments) {
    const p = projects.get(a.projectId);
    const r = a.resourceId ? resources.get(a.resourceId) : undefined;
    if (!p) continue;
    for (const [w, pct] of Object.entries(a.weekly)) {
      if (!pct) continue;
      lines.push([
        p.name,
        p.client,
        p.sellerId ? sellers.get(p.sellerId) : '',
        STATUS_LABELS[p.status],
        a.name,
        a.resourceId === null ? 'Open' : (r?.name ?? '(deleted)'),
        r?.level ?? a.level,
        w,
        weekKind(p, w) === 'presales' ? 'Presales' : 'Delivery',
        pct,
      ]);
    }
  }
  lines.sort((x, y) =>
    String(x[0]).localeCompare(String(y[0])) ||
    String(x[4]).localeCompare(String(y[4])) ||
    String(x[5]).localeCompare(String(y[5])) ||
    String(x[7]).localeCompare(String(y[7])),
  );
  return toCsv([...out, ...lines]);
}
