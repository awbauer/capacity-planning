import { STATUS_LABELS } from './labels';
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
  const allocated = [...plan.assignments, ...plan.roles]
    .filter((a) => a.projectId === project.id)
    .flatMap((a) => Object.keys(a.weekly).filter((w) => a.weekly[w]));
  const bounds = [...allocated, project.startWeek, project.endWeek].filter((w): w is string => !!w).sort();
  return bounds.length ? weeksBetween(bounds[0], bounds[bounds.length - 1]) : [];
}

/**
 * One workstream's staffing plan, laid out for people to read: a details
 * block, then one row per person with a column per week (% allocation), a
 * Phase row (presales before the start date, delivery from it) and an FTE total.
 * Open roles follow the people as "Open: <role>", with their own FTE total.
 */
export function workstreamCsv(plan: PlanData, projectId: string): string {
  const project = plan.projects.find((p) => p.id === projectId);
  if (!project) throw new Error(`Unknown workstream ${projectId}`);
  const tags = new Map(plan.tags.map((t) => [t.id, t.name]));
  const resources = new Map(plan.resources.map((r) => [r.id, r]));
  const seller = plan.sellers.find((s) => s.id === project.sellerId);
  const weeks = workstreamWeeks(plan, project);
  const rows = plan.assignments
    .filter((a) => a.projectId === project.id)
    .map((a) => ({ a, r: resources.get(a.resourceId) }))
    .sort((x, y) => (x.r?.name ?? '').localeCompare(y.r?.name ?? ''));

  const out: Cell[][] = [
    ['Workstream', project.name],
    ['Client', project.client],
    ['Seller', seller?.name],
    ['Status', STATUS_LABELS[project.status]],
    ['Start (week of)', project.startWeek],
    ['End (week of)', project.endWeek],
    ['Required capabilities', project.tagIds.map((t) => tags.get(t)).filter(Boolean).join('; ')],
    [],
    ['Person', 'Level', 'Role', 'Capabilities', ...weeks],
    ['Phase', '', '', '', ...weeks.map((w) => (weekKind(project, w) === 'presales' ? 'Presales' : 'Delivery'))],
  ];
  for (const { a, r } of rows) {
    out.push([
      r?.name ?? '(deleted)',
      r?.level,
      r?.role,
      (r?.tagIds ?? []).map((t) => tags.get(t)).filter(Boolean).join('; '),
      ...weeks.map((w) => a.weekly[w] ?? 0),
    ]);
  }
  const roles = plan.roles.filter((r) => r.projectId === project.id).sort((x, y) => x.name.localeCompare(y.name));
  for (const role of roles) {
    out.push([
      `Open: ${role.name}`,
      role.level,
      'Open role',
      role.tagIds.map((t) => tags.get(t)).filter(Boolean).join('; '),
      ...weeks.map((w) => role.weekly[w] ?? 0),
    ]);
  }
  out.push([
    'Total FTE',
    '',
    '',
    '',
    ...weeks.map((w) => rows.reduce((sum, { a }) => sum + (a.weekly[w] ?? 0), 0) / 100),
  ]);
  if (roles.length) {
    out.push([
      'Open FTE',
      '',
      '',
      '',
      ...weeks.map((w) => roles.reduce((sum, r) => sum + (r.weekly[w] ?? 0), 0) / 100),
    ]);
  }
  return toCsv(out);
}

/**
 * Every workstream's staffing in one long table (one line per person per
 * allocated week), which pivots cleanly in Excel or Sheets.
 */
export function allWorkstreamsCsv(plan: PlanData): string {
  const resources = new Map(plan.resources.map((r) => [r.id, r]));
  const projects = new Map(plan.projects.map((p) => [p.id, p]));
  const sellers = new Map(plan.sellers.map((s) => [s.id, s.name]));
  const out: Cell[][] = [
    ['Workstream', 'Client', 'Seller', 'Status', 'Person', 'Level', 'Role', 'Week of', 'Phase', 'Allocation %'],
  ];
  const lines: Cell[][] = [];
  for (const a of plan.assignments) {
    const p = projects.get(a.projectId);
    const r = resources.get(a.resourceId);
    if (!p) continue;
    for (const [w, pct] of Object.entries(a.weekly)) {
      if (!pct) continue;
      lines.push([
        p.name,
        p.client,
        p.sellerId ? sellers.get(p.sellerId) : '',
        STATUS_LABELS[p.status],
        r?.name ?? '(deleted)',
        r?.level,
        r?.role,
        w,
        weekKind(p, w) === 'presales' ? 'Presales' : 'Delivery',
        pct,
      ]);
    }
  }
  for (const role of plan.roles) {
    const p = projects.get(role.projectId);
    if (!p) continue;
    for (const [w, pct] of Object.entries(role.weekly)) {
      if (!pct) continue;
      lines.push([
        p.name,
        p.client,
        p.sellerId ? sellers.get(p.sellerId) : '',
        STATUS_LABELS[p.status],
        `Open: ${role.name}`,
        role.level,
        'Open role',
        w,
        weekKind(p, w) === 'presales' ? 'Presales' : 'Delivery',
        pct,
      ]);
    }
  }
  lines.sort((x, y) =>
    String(x[0]).localeCompare(String(y[0])) || String(x[4]).localeCompare(String(y[4])) || String(x[7]).localeCompare(String(y[7])),
  );
  return toCsv([...out, ...lines]);
}
