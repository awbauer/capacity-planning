import { useState } from 'react';
import type { Derived } from '../domain/derive';
import { assignmentFlagWeeks } from '../domain/conflicts';
import { slug, workstreamCsv } from '../domain/csv';
import { weekKind, type Severity } from '../domain/load';
import { isFilled, type Assignment, type Project } from '../domain/types';
import type { Bucket } from '../domain/weeks';
import { usePlan, usePlanStore } from '../store/planStore';
import { clientGroupKey, isExpanded, useUIStore, type Filters } from '../store/uiStore';
import { useDerived } from '../store/useDerived';
import { AddAssignmentDialog } from './AddAssignmentDialog';
import { downloadText, today } from './download';
import { FillRoleDialog } from './FillRoleDialog';
import { RoleDialog } from './RoleDialog';
import { TagChips } from './Chips';
import { TimeGrid, type GridRow } from './grid/TimeGrid';
import { ProjectDialog } from './ProjectDialog';
import { AssignmentBadges, StatusSelect } from './StatusControls';

interface Props {
  buckets: Bucket[];
}

function matchesFilters(p: Project, f: Filters, d: Derived, hasConflict: boolean): boolean {
  if (f.conflictsOnly && !hasConflict) return false;
  if (f.tagId && !p.tagIds.includes(f.tagId)) return false;
  if (f.sellerId && p.sellerId !== f.sellerId) return false;
  if (f.status && p.status !== f.status) return false;
  const q = f.text.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    p.name,
    p.client ?? '',
    p.sellerId ? (d.sellersById.get(p.sellerId)?.name ?? '') : '',
    // People and role names, so "architect" finds workstreams with that role, open or filled.
    ...(d.assignmentsByProject.get(p.id) ?? []).flatMap((a) => [
      a.name,
      a.resourceId ? (d.resourcesById.get(a.resourceId)?.name ?? '') : '',
    ]),
  ];
  return haystack.some((s) => s.toLowerCase().includes(q));
}

/** By start date, with lost projects last. */
function sortProjects(projects: Project[]): Project[] {
  return [...projects].sort(
    (a, b) =>
      Number(a.status === 'lost') - Number(b.status === 'lost') ||
      (a.startWeek ?? '9999').localeCompare(b.startWeek ?? '9999') ||
      a.name.localeCompare(b.name),
  );
}

export function ProjectView({ buckets }: Props) {
  const plan = usePlan();
  const d = useDerived();
  const zoom = useUIStore((s) => s.zoom);
  const filters = useUIStore((s) => s.filters);
  const expanded = useUIStore((s) => s.expanded);
  const setExpanded = useUIStore((s) => s.setExpanded);
  const setAllExpanded = useUIStore((s) => s.setAllExpanded);
  const groupByClient = useUIStore((s) => s.groupByClient);
  const setGroupByClient = useUIStore((s) => s.setGroupByClient);
  const removeAssignment = usePlanStore((s) => s.removeAssignment);
  const [roleDialog, setRoleDialog] = useState<{ projectId: string } | { role: Assignment } | null>(null);
  const [filling, setFilling] = useState<Assignment | null>(null);
  const upcomingRoleProjects = new Set(d.upcomingRoles.map((u) => u.role.projectId));
  const updateProject = usePlanStore((s) => s.updateProject);
  const [adding, setAdding] = useState<string | null>(null);
  const [editing, setEditing] = useState<Project | 'new' | null>(null);

  const visibleWeeks = buckets.flatMap((b) => b.weeks);
  // A workstream has a conflict if someone on it is over/at risk in the visible range,
  // someone on it has none of its required skills, a required capability is uncovered,
  // or it has an open role still to fill.
  const hasConflict = (p: Project) =>
    d.uncoveredByProject.has(p.id) ||
    upcomingRoleProjects.has(p.id) ||
    (d.assignmentsByProject.get(p.id) ?? []).some((a) => {
      if (d.mismatchedAssignmentIds.has(a.id)) return true;
      const flags = assignmentFlagWeeks(a, visibleWeeks, d.loads, plan.settings);
      return flags.over.length + flags.stretch.length + flags.risk.length > 0;
    });
  const conflicted = new Set(plan.projects.filter(hasConflict).map((p) => p.id));
  const projects = sortProjects(plan.projects.filter((p) => matchesFilters(p, filters, d, conflicted.has(p.id))));

  const rows: GridRow[] = [];
  const pushProject = (p: Project) => {
    const key = `p:${p.id}`;
    const open = isExpanded(expanded, key);
    const personName = (a: Assignment) => (a.resourceId ? (d.resourcesById.get(a.resourceId)?.name ?? '') : '');
    // Every row is a role: people's roles by role then person, then open roles.
    const all = [...(d.assignmentsByProject.get(p.id) ?? [])].sort(
      (a, b) =>
        Number(!isFilled(a)) - Number(!isFilled(b)) ||
        a.name.localeCompare(b.name) ||
        personName(a).localeCompare(personName(b)),
    );
    const assignments = all.filter(isFilled);
    const roles = all.filter((a) => !isFilled(a));
    const flagsByAssignment = new Map(
      assignments.map((a) => [a.id, assignmentFlagWeeks(a, visibleWeeks, d.loads, plan.settings)]),
    );
    const flagged = (sev: Severity) =>
      new Set(assignments.filter((a) => flagsByAssignment.get(a.id)![sev].length > 0).map((a) => a.resourceId));
    // Each person is counted once, at their worst level.
    const overPeople = flagged('over');
    const stretchPeople = [...flagged('stretch')].filter((id) => !overPeople.has(id));
    const riskPeople = [...flagged('risk')].filter((id) => !overPeople.has(id) && !stretchPeople.includes(id));
    const uncovered = d.uncoveredByProject.get(p.id) ?? [];
    const seller = p.sellerId ? d.sellersById.get(p.sellerId) : undefined;
    const totals = d.projectLoad.get(p.id);

    rows.push({
      key,
      depth: 0,
      className: p.status === 'lost' ? 'project-row lost' : 'project-row',
      range: { start: p.startWeek, end: p.endWeek },
      label: (
        <div className="row-label">
          <button
            type="button"
            className="twisty"
            aria-expanded={open}
            aria-label={open ? 'Collapse' : 'Expand'}
            onClick={() => setExpanded(key, !open)}
          >
            {open ? '▾' : '▸'}
          </button>
          <div className="row-main">
            <div className="row-title">
              <button type="button" className="link" onClick={() => setEditing(p)} title="Edit workstream">
                {p.name}
              </button>
              {p.client && !groupByClient && <span className="muted"> · {p.client}</span>}
            </div>
            <div className="row-meta">
              <StatusSelect compact value={p.status} onChange={(status) => updateProject(p.id, { status })} />
              <span className="seller" title={seller ? `Seller: ${seller.name}` : 'No seller'}>
                {seller ? seller.name : <em className="muted">No seller</em>}
              </span>
            {(overPeople.size > 0 ||
              stretchPeople.length > 0 ||
              riskPeople.length > 0 ||
              uncovered.length > 0 ||
              roles.length > 0 ||
              assignments.length === 0) && (
              <span className="row-badges">
                {overPeople.size > 0 && (
                  <span className="badge badge-danger" title={`${overPeople.size} overallocated: people on this workstream with committed work above ${plan.settings.criticalThreshold}% in the visible range`}>
                    ⚠ {overPeople.size}
                  </span>
                )}
                {stretchPeople.length > 0 && (
                  <span className="badge badge-stretch" title={`${stretchPeople.length} stretched: people on this workstream with committed work above ${plan.settings.overallocationThreshold}% in the visible range`}>
                    {stretchPeople.length}
                  </span>
                )}
                {riskPeople.length > 0 && (
                  <span className="badge badge-risk" title={`${riskPeople.length} at risk: people who would be over capacity if pipeline work is won`}>
                    {riskPeople.length}
                  </span>
                )}
                {uncovered.length > 0 && (
                  <span className="badge badge-warn" title={`Uncovered capabilities: ${uncovered.map((t) => d.tagsById.get(t)?.name).join(', ')} (nobody on the workstream has them)`}>
                    Gap{uncovered.length > 1 ? ` ${uncovered.length}` : ''}
                  </span>
                )}
                {roles.length > 0 && (
                  <span className="badge badge-open" title={`Open roles: ${roles.map((r) => r.name).join(', ')}`}>
                    Open {roles.length}
                  </span>
                )}
                {assignments.length === 0 && roles.length === 0 && <span className="badge">Unstaffed</span>}
              </span>
            )}
              <TagChips tagIds={p.tagIds} tagsById={d.tagsById} />
            </div>
          </div>
          <div className="row-actions">
            <button type="button" className="btn btn-small" onClick={() => setAdding(p.id)}>
              + Person
            </button>
            <button
              type="button"
              className="btn btn-small"
              title="Add demand you haven't chosen a person for yet"
              onClick={() => setRoleDialog({ projectId: p.id })}
            >
              + Role
            </button>
            <button
              type="button"
              className="btn btn-small"
              title="Download this workstream's staffing plan as CSV"
              aria-label="Download CSV"
              onClick={() => downloadText(`staffing-${slug(p.name)}-${today()}.csv`, workstreamCsv(plan, p.id), 'text/csv')}
            >
              ⤓
            </button>
          </div>
        </div>
      ),
      summary: (b) => {
        const avg = b.weeks.reduce((s, w) => s + (totals?.get(w) ?? 0), 0) / b.weeks.length;
        const inBucket = (sev: Severity) =>
          assignments.some((a) => flagsByAssignment.get(a.id)![sev].some((w) => b.weeks.includes(w)));
        const worst: Severity | null = inBucket('over') ? 'over' : inBucket('stretch') ? 'stretch' : inBucket('risk') ? 'risk' : null;
        const note =
          worst === 'over'
            ? ' · someone is overallocated'
            : worst === 'stretch'
              ? ' · someone is stretched'
              : worst === 'risk'
                ? ' · someone is at risk if pipeline work is won'
                : '';
        const openFte = b.weeks.reduce((n, w) => n + roles.reduce((m, r) => m + (r.weekly[w] ?? 0), 0), 0) / b.weeks.length;
        const openNote = openFte ? ` · +${(openFte / 100).toFixed(2)} FTE in open roles` : '';
        return {
          text: avg ? (avg / 100).toFixed(1) : '',
          extra: openFte ? `+${(openFte / 100).toFixed(1)}` : undefined,
          className: [
            'fte',
            worst ? `has-${worst}` : '',
            assignments.some((a) => b.weeks.some((w) => a.weekly[w] && weekKind(p, w) === 'presales'))
              ? 'has-presales'
              : '',
          ].join(' '),
          title:
            avg || openFte
              ? `${(avg / 100).toFixed(2)} FTE staffed${b.weeks.length > 1 ? ' (average)' : ''}${openNote}${note}`
              : undefined,
        };
      },
    });

    if (!open) return;
    for (const a of all) {
      const r = a.resourceId ? d.resourcesById.get(a.resourceId) : undefined;
      const flags = flagsByAssignment.get(a.id);
      const rowWorst: Severity | null = !flags
        ? null
        : flags.over.length
          ? 'over'
          : flags.stretch.length
            ? 'stretch'
            : flags.risk.length
              ? 'risk'
              : null;
      const needs = (a.tagIds.length ? a.tagIds : p.tagIds).map((t) => d.tagsById.get(t)?.name).join(', ');
      const roleLabel = a.name || 'Unnamed role';
      rows.push({
        key: `a:${a.id}`,
        depth: 1,
        assignmentId: a.id,
        className: r ? 'role-row' : 'role-row open',
        range: { start: p.startWeek, end: p.endWeek },
        label: (
          <div className="row-label">
            <div className="row-main">
              <div className="row-title">
                <button
                  type="button"
                  className={a.name ? 'link role-name' : 'link role-name unnamed'}
                  title={`Edit role${a.level ? ` · ${a.level}` : ''}${needs ? ` · needs ${needs}` : ''}`}
                  onClick={() => setRoleDialog({ role: a })}
                >
                  {roleLabel}
                </button>
                {r ? (
                  <>
                    <button
                      type="button"
                      className="link person-name"
                      title={`${r.name}${r.role ? `, ${r.role}` : ''}. Change who's in this role`}
                      onClick={() => setFilling(a)}
                    >
                      {r.name}
                    </button>
                    {r.level && <span className="level-badge">{r.level}</span>}
                    <AssignmentBadges worst={rowWorst} mismatch={d.mismatchedAssignmentIds.has(a.id)} />
                  </>
                ) : (
                  <>
                    <span className="badge badge-open">Open</span>
                    {a.level && <span className="level-badge">{a.level}</span>}
                  </>
                )}
              </div>
            </div>
            {!r && (
              <button type="button" className="btn btn-small" title="Choose the person for this role" onClick={() => setFilling(a)}>
                Fill…
              </button>
            )}
            <button
              type="button"
              className="icon-btn"
              aria-label={`Remove role ${roleLabel}${r ? ` (${r.name})` : ''} from ${p.name}`}
              title={r ? 'Remove this role (to keep the role but free the person, click their name)' : 'Remove this open role'}
              onClick={() => {
                const weeks = Object.keys(a.weekly).length;
                const who = r ? ` and take ${r.name} off ${p.name}` : '';
                if (weeks === 0 || window.confirm(`Remove the ${roleLabel} role${who}? This clears ${weeks} week(s) of allocation (undo with Ctrl+Z).`)) {
                  removeAssignment(a.id);
                }
              }}
            >
              ×
            </button>
          </div>
        ),
      });
    }
  };

  // Client groups: named clients A–Z (case-insensitive), then workstreams without a client.
  const groups: { key: string; client: string | undefined; projects: Project[] }[] = [];
  if (groupByClient) {
    const byKey = new Map<string, (typeof groups)[number]>();
    for (const p of projects) {
      const key = clientGroupKey(p.client);
      const group = byKey.get(key) ?? { key, client: p.client?.trim() || undefined, projects: [] };
      group.projects.push(p);
      byKey.set(key, group);
    }
    groups.push(
      ...[...byKey.values()].sort(
        (a, b) => Number(!a.client) - Number(!b.client) || (a.client ?? '').localeCompare(b.client ?? ''),
      ),
    );
  }

  if (!groupByClient) projects.forEach(pushProject);
  for (const g of groups) {
    const open = isExpanded(expanded, g.key);
    const issues = g.projects.filter((p) => conflicted.has(p.id)).length;
    const fte = (w: string) => g.projects.reduce((n, p) => n + (d.projectLoad.get(p.id)?.get(w) ?? 0), 0);
    rows.push({
      key: g.key,
      depth: 0,
      className: 'group-row',
      label: (
        <div className="row-label">
          <button
            type="button"
            className="twisty"
            aria-expanded={open}
            aria-label={open ? 'Collapse' : 'Expand'}
            onClick={() => setExpanded(g.key, !open)}
          >
            {open ? '▾' : '▸'}
          </button>
          <div className="row-main">
            <div className="row-title">
              {g.client ? <strong>{g.client}</strong> : <em className="muted">No client</em>}{' '}
              <span className="muted small">
                · {g.projects.length} {g.projects.length === 1 ? 'workstream' : 'workstreams'}
              </span>
              {issues > 0 && (
                <span className="badge badge-warn" title={`${issues} of this client's workstreams have a conflict`}>
                  ⚠ {issues}
                </span>
              )}
            </div>
          </div>
        </div>
      ),
      summary: (b) => {
        const avg = b.weeks.reduce((n, w) => n + fte(w), 0) / b.weeks.length;
        return {
          text: avg ? (avg / 100).toFixed(1) : '',
          className: 'group-sum',
          title: avg ? `${(avg / 100).toFixed(2)} FTE across this client's workstreams${b.weeks.length > 1 ? ' (average)' : ''}` : undefined,
        };
      },
    });
    if (open) g.projects.forEach(pushProject);
  }

  const projectKeys = projects.map((p) => `p:${p.id}`);
  const groupKeys = groups.map((g) => g.key);

  return (
    <>
      <TimeGrid
        zoom={zoom}
        buckets={buckets}
        rows={rows}
        corner={
          <div className="corner-content">
            <strong>Workstreams</strong> <span className="muted">({projects.length})</span>
            <div className="corner-actions">
              <button type="button" className="btn btn-small btn-primary" onClick={() => setEditing('new')}>
                + New workstream
              </button>
              <button type="button" className="btn btn-small" onClick={() => setAllExpanded([...groupKeys, ...projectKeys], true)}>
                Expand
              </button>
              <button type="button" className="btn btn-small" onClick={() => setAllExpanded(projectKeys, false)}>
                Collapse
              </button>
              {groupByClient && (
                <button type="button" className="btn btn-small" onClick={() => setAllExpanded(groupKeys, false)}>
                  Clients only
                </button>
              )}
              <button
                type="button"
                className="btn btn-small"
                aria-pressed={groupByClient}
                title="Group workstreams by client"
                onClick={() => setGroupByClient(!groupByClient)}
              >
                By client
              </button>
            </div>
          </div>
        }
        empty={
          plan.projects.length === 0 ? (
            <span>
              No workstreams yet.{' '}
              <button type="button" className="link" onClick={() => setEditing('new')}>
                Create one
              </button>
            </span>
          ) : filters.conflictsOnly ? (
            'No workstream has a conflict in this view. 🎉'
          ) : (
            'No workstreams match the filters.'
          )
        }
      />
      {adding && <AddAssignmentDialog projectId={adding} onClose={() => setAdding(null)} />}
      {roleDialog && <RoleDialog {...roleDialog} onClose={() => setRoleDialog(null)} />}
      {filling && <FillRoleDialog role={filling} onClose={() => setFilling(null)} />}
      {editing && (
        <ProjectDialog project={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}
