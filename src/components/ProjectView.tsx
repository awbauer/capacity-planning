import { RowComments } from '../collab/RowComments';
import { initials } from '../collab/format';
import { fte, fteLabel } from '../domain/timeline';
import { MenuItem, Popover } from './Popover';
import { useState } from 'react';
import type { Derived } from '../domain/derive';
import { assignmentFlagWeeks } from '../domain/conflicts';
import { slug, workstreamCsv } from '../domain/csv';
import { weekKind, type Severity } from '../domain/load';
import { isFilled, type Assignment, type Project } from '../domain/types';
import type { Bucket } from '../domain/weeks';
import { usePlan, usePlanStore } from '../store/planStore';
import { useCan } from '../store/useCan';
import { clientGroupKey, isExpanded, useUIStore, type Filters } from '../store/uiStore';
import { useDerived } from '../store/useDerived';
import { AddAssignmentDialog } from './AddAssignmentDialog';
import { downloadText, today } from './download';
import { FillRoleDialog } from './FillRoleDialog';
import { RoleDialog } from './RoleDialog';
import { TimeGrid, type GridRow } from './grid/TimeGrid';
import { Toggle } from './Toggle';
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
  const showDetails = useUIStore((s) => s.showDetails);
  const removeAssignment = usePlanStore((s) => s.removeAssignment);
  const can = useCan();
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

    // Demand over the visible weeks (staffed + open, not counting lost delivery), shown as where it starts and ends.
    const demandAt = (w: string) => (totals?.get(w) ?? 0) + roles.reduce((n, r) => n + (r.weekly[w] ?? 0), 0);
    const demandWeeks = visibleWeeks.map(demandAt).filter((v) => v > 0);
    const demandFrom = demandWeeks[0];
    const demandTo = demandWeeks[demandWeeks.length - 1];
    const demandText =
      demandFrom === undefined ? '' : Math.round(demandFrom) === Math.round(demandTo) ? fteLabel(demandFrom) : `${fte(demandFrom)} → ${fteLabel(demandTo)}`;
    const conflictPeople = overPeople.size + stretchPeople.length;

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
              <button
                type="button"
                className="link ws-name"
                onClick={() => showDetails({ kind: 'project', id: p.id })}
                title={`${p.name}${p.client ? ` · ${p.client}` : ''}${seller ? ` · seller ${seller.name}` : ''}. Open details: checks, filled and open roles`}
              >
                {p.name}
              </button>
            </div>
            <div className="row-meta">
              {p.client && !groupByClient && <span className="client">{p.client}</span>}
              <StatusSelect compact disabled={!can.edit} value={p.status} onChange={(status) => updateProject(p.id, { status })} />
              {demandText && (
                <span className="fte" title="Demand in the visible weeks (filled and open roles), where it starts → where it ends">
                  {demandText}
                </span>
              )}
              {conflictPeople > 0 && (
                <span
                  className={overPeople.size ? 'badge badge-danger' : 'badge badge-stretch'}
                  title={`${conflictPeople} ${conflictPeople === 1 ? 'person' : 'people'} on this workstream over capacity on committed work in the visible weeks`}
                >
                  ⚠ {conflictPeople} over
                </span>
              )}
              {riskPeople.length > 0 && (
                <span className="badge badge-risk" title={`${riskPeople.length} at risk: people who would be over capacity if pipeline work is won`}>
                  {riskPeople.length} at risk
                </span>
              )}
              {roles.length > 0 && (
                <span className="badge badge-open" title={`Open roles: ${roles.map((r) => r.name || 'Unnamed role').join(', ')}`}>
                  {roles.length} open
                </span>
              )}
              {uncovered.length > 0 && (
                <span className="badge badge-warn" title={`Uncovered capabilities: ${uncovered.map((t) => d.tagsById.get(t)?.name).join(', ')} (nobody on the workstream has them)`}>
                  Gap{uncovered.length > 1 ? ` ${uncovered.length}` : ''}
                </span>
              )}
              {assignments.length === 0 && roles.length === 0 && <span className="badge">Unstaffed</span>}
            </div>
          </div>
          <RowComments kind="project" id={p.id} name={p.name} />
          <Popover className="icon-btn row-more" label="•••" ariaLabel={`Actions for ${p.name}`}>
            {can.edit && <MenuItem onClick={() => setAdding(p.id)}>Add a person…</MenuItem>}
            {can.edit && (
              <MenuItem onClick={() => setRoleDialog({ projectId: p.id })} title="Add demand you haven't chosen a person for yet">
                Add an open role…
              </MenuItem>
            )}
            {can.edit && <MenuItem onClick={() => setEditing(p)}>Edit workstream…</MenuItem>}
            <MenuItem onClick={() => showDetails({ kind: 'project', id: p.id })}>Details</MenuItem>
            <MenuItem
              onClick={() => downloadText(`staffing-${slug(p.name)}-${today()}.csv`, workstreamCsv(plan, p.id), 'text/csv')}
              title="Download this workstream's staffing plan as CSV"
            >
              Download CSV
            </MenuItem>
          </Popover>
        </div>
      ),
      summary: (b) => {
        const avg = b.weeks.reduce((s, w) => s + (totals?.get(w) ?? 0), 0) / b.weeks.length;
        const inBucket = (sev: Severity) =>
          assignments.some((a) => flagsByAssignment.get(a.id)![sev].some((w) => b.weeks.includes(w)));
        const worst: Severity | null = inBucket('over') ? 'over' : inBucket('stretch') ? 'stretch' : inBucket('risk') ? 'risk' : null;
        const note =
          worst === 'over' || worst === 'stretch'
            ? ' · someone is over capacity'
            : worst === 'risk'
              ? ' · someone is over capacity if pipeline work is won'
              : '';
        const openFte = b.weeks.reduce((n, w) => n + roles.reduce((m, r) => m + (r.weekly[w] ?? 0), 0), 0) / b.weeks.length;
        const openNote = openFte ? ` · +${fteLabel(openFte)} in open roles` : '';
        return {
          text: avg ? fteLabel(avg) : '',
          extra: openFte ? `+${fte(openFte)} open` : undefined,
          band: avg ? 'staffed' : 'open',
          className: [
            'fte',
            worst ? `has-${worst}` : '',
            assignments.some((a) => b.weeks.some((w) => a.weekly[w] && weekKind(p, w) === 'presales'))
              ? 'has-presales'
              : '',
          ].join(' '),
          title:
            avg || openFte
              ? `${fteLabel(avg)} staffed${b.weeks.length > 1 ? ' (average)' : ''}${openNote}${note}`
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
      const removeRole = () => {
        const weeks = Object.keys(a.weekly).length;
        const who = r ? ` and take ${r.name} off ${p.name}` : '';
        if (weeks === 0 || window.confirm(`Remove the ${roleLabel} role${who}? This clears ${weeks} week(s) of allocation (undo with Ctrl+Z).`)) {
          removeAssignment(a.id);
        }
      };
      rows.push({
        key: `a:${a.id}`,
        depth: 1,
        assignmentId: a.id,
        resourceId: r?.id,
        name: `${r ? r.name : `${roleLabel}, open role`}, ${p.name}`,
        className: r ? 'role-row' : 'role-row open',
        range: { start: p.startWeek, end: p.endWeek },
        label: (
          <div className="row-label">
            <span className={r ? 'avatar-mini' : 'avatar-mini open'} aria-hidden="true">
              {r ? initials(r.name) : '◇'}
            </span>
            <div className="row-main">
              <div className="row-title">
                {r ? (
                  <>
                    <button
                      type="button"
                      className="link person-name"
                      title={`${r.name}${r.role ? `, ${r.role}` : ''}. ${can.edit ? "Change who's in this role" : 'Details'}`}
                      onClick={() => (can.edit ? setFilling(a) : showDetails({ kind: 'resource', id: r.id }))}
                    >
                      {r.name}
                    </button>
                    {r.level && <span className="level-badge">{r.level}</span>}
                    {a.name && (
                      <button
                        type="button"
                        className="link role-name"
                        title={`Role: ${a.name}${a.level ? ` · ${a.level}` : ''}${needs ? ` · needs ${needs}` : ''}${can.edit ? '. Edit role' : ''}`}
                        onClick={() => can.edit && setRoleDialog({ role: a })}
                      >
                        {a.name}
                      </button>
                    )}
                    <AssignmentBadges worst={rowWorst} mismatch={d.mismatchedAssignmentIds.has(a.id)} />
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className={a.name ? 'link role-name' : 'link role-name unnamed'}
                      title={`Open role${a.level ? ` · ${a.level}` : ''}${needs ? ` · needs ${needs}` : ''}${can.edit ? '. Choose the person for it' : ''}`}
                      onClick={() => can.edit && setFilling(a)}
                    >
                      {roleLabel}
                    </button>
                    {a.level && <span className="level-badge">{a.level}</span>}
                    <span className="badge badge-open">Open</span>
                  </>
                )}
              </div>
            </div>
            {!r && (
              <button type="button" className="btn btn-small edit-only" title="Choose the person for this role" onClick={() => setFilling(a)}>
                Fill…
              </button>
            )}
            <RowComments kind="role" id={a.id} name={`${roleLabel}${r ? ` (${r.name})` : ''}`} />
            <Popover className="icon-btn row-more" label="•••" ariaLabel={`Actions for ${roleLabel}${r ? ` (${r.name})` : ''}`}>
              {can.edit && <MenuItem onClick={() => setFilling(a)}>{r ? 'Change person…' : 'Fill role…'}</MenuItem>}
              {can.edit && <MenuItem onClick={() => setRoleDialog({ role: a })}>Edit role…</MenuItem>}
              {r && <MenuItem onClick={() => showDetails({ kind: 'resource', id: r.id })}>{r.name}: details</MenuItem>}
              {can.edit && (
                <MenuItem danger onClick={removeRole} title={r ? 'Remove this role (to keep the role but free the person, use Change person…)' : 'Remove this open role'}>
                  Remove role
                </MenuItem>
              )}
            </Popover>
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
                <span className="badge badge-warn" title={`${issues} of this client's workstreams have an issue`}>
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
          text: avg ? fteLabel(avg) : '',
          band: 'staffed',
          className: 'group-sum',
          title: avg ? `${fteLabel(avg)} staffed across this client's workstreams${b.weeks.length > 1 ? ' (average)' : ''}` : undefined,
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
            <div className="corner-title">
              <strong>Workstreams</strong> <span className="muted">({projects.length})</span>
            </div>
            <div className="corner-actions">
              <button type="button" className="link-small" onClick={() => setAllExpanded([...groupKeys, ...projectKeys], true)}>
                Expand all
              </button>
              <button type="button" className="link-small" onClick={() => setAllExpanded(projectKeys, false)}>
                Collapse all
              </button>
              {groupByClient && (
                <button type="button" className="link-small" onClick={() => setAllExpanded(groupKeys, false)}>
                  Clients only
                </button>
              )}
              <span className="spacer" />
              <Toggle small label="By client" checked={groupByClient} onChange={setGroupByClient} title="Group workstreams by client" />
            </div>
          </div>
        }
        empty={
          plan.projects.length === 0 ? (
            <span>
              No workstreams yet.{' '}
              <button type="button" className="link edit-only" onClick={() => setEditing('new')}>
                Create one
              </button>
            </span>
          ) : filters.conflictsOnly ? (
            'No workstream has an issue in the visible weeks. Turn off Issues only to see them all.'
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
