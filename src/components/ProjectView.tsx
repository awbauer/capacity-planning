import { RowComments } from '../collab/RowComments';
import { bucketStats } from '../domain/aggregate';
import { initials } from '../collab/format';
import { fte, fteLabel } from '../domain/timeline';
import { MenuItem, Popover } from './Popover';
import { useState, type MouseEvent } from 'react';
import type { Derived } from '../domain/derive';
import { assignmentFlagWeeks } from '../domain/conflicts';
import { slug, workstreamCsv } from '../domain/csv';
import { LIKELY_WIN, lowRiskAt, weekKind, type Severity } from '../domain/load';
import { isFilled, WIN_PROBABILITIES, type Assignment, type Project, type ProjectStatus, type WinProbability } from '../domain/types';
import type { Bucket } from '../domain/weeks';
import { usePlan, usePlanStore } from '../store/planStore';
import { useCan } from '../store/useCan';
import { clientGroupKey, isExpanded, sellerGroupKey, stageGroupKey, useUIStore, type Filters, type GroupBy } from '../store/uiStore';
import { STATUS_LABELS } from '../domain/labels';
import { useDerived } from '../store/useDerived';
import { AddAssignmentDialog } from './AddAssignmentDialog';
import { downloadText, today } from './download';
import { FillRoleDialog } from './FillRoleDialog';
import { RoleDialog } from './RoleDialog';
import { TimeGrid, type GridRow } from './grid/TimeGrid';
import { ProjectDialog } from './ProjectDialog';
import { AssignmentBadges, StatusSelect } from './StatusControls';

const STAGE_ORDER: ProjectStatus[] = ['pipeline', 'won', 'lost'];

interface Props {
  buckets: Bucket[];
}

/** Issues only belongs to the Resources view; here Pipeline only takes its place. */
function matchesFilters(p: Project, f: Filters, d: Derived): boolean {
  if (f.pipelineOnly && p.status !== 'pipeline') return false;
  if (f.minWinProbability !== null && p.status === 'pipeline' && (p.winProbability ?? 0) < f.minWinProbability) return false;
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

/** How sure a workstream is: won counts as 100%, a pipeline one its win % (0 if unset), lost last. */
const certainty = (p: Project) => (p.status === 'won' ? 100 : p.status === 'pipeline' ? (p.winProbability ?? 0) : -1);

/** Most likely first (won, then pipeline by win %), then by start date. */
function sortProjects(projects: Project[]): Project[] {
  return [...projects].sort(
    (a, b) =>
      certainty(b) - certainty(a) ||
      (a.startWeek ?? '9999').localeCompare(b.startWeek ?? '9999') ||
      a.name.localeCompare(b.name),
  );
}

export function ProjectView({ buckets }: Props) {
  const plan = usePlan();
  const d = useDerived();
  const zoom = useUIStore((s) => s.zoom);
  const rollup = useUIStore((s) => s.rollup);
  /** A Month/Quarter column's value: the average of its weeks, or the busiest one. */
  const roll = (valueOf: (w: string) => number, weeks: string[]) => {
    const st = bucketStats(valueOf, weeks);
    return zoom === 'week' ? st.avg : st[rollup];
  };
  const rollWord = rollup === 'peak' ? 'peak week' : 'average';
  const filters = useUIStore((s) => s.filters);
  const expanded = useUIStore((s) => s.expanded);
  const setExpanded = useUIStore((s) => s.setExpanded);
  const setAllExpanded = useUIStore((s) => s.setAllExpanded);
  const groupBy = useUIStore((s) => s.groupBy);
  const setGroupBy = useUIStore((s) => s.setGroupBy);
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
  /** Clicking anywhere on a workstream or client row expands or collapses it, except on its own controls. */
  const toggleOnRowClick = (key: string, open: boolean) => (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, select, input, a, [role=menuitem]')) return;
    setExpanded(key, !open);
  };
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
  const projects = sortProjects(plan.projects.filter((p) => matchesFilters(p, filters, d)));

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
    // A person's risk here is low when every at-risk week is only through pipeline work under LIKELY_WIN% likely.
    const lowRiskOf = (a: Assignment) =>
      !!a.resourceId && (flagsByAssignment.get(a.id)?.risk ?? []).every((w) => lowRiskAt(d.loads, a.resourceId!, w, plan.settings));
    const allRiskLow = riskPeople.every((id) => assignments.filter((a) => a.resourceId === id).every(lowRiskOf));
    const uncovered = d.uncoveredByProject.get(p.id) ?? [];
    const seller = p.sellerId ? d.sellersById.get(p.sellerId) : undefined;
    const totals = d.projectLoad.get(p.id);

    const conflictPeople = overPeople.size + stretchPeople.length;

    rows.push({
      key,
      depth: 0,
      className: p.status === 'lost' ? 'project-row lost' : 'project-row',
      range: { start: p.startWeek, end: p.endWeek },
      label: (
        <div className="row-label row-toggle" onClick={toggleOnRowClick(key, open)}>
          <button
            type="button"
            className="twisty"
            aria-expanded={open}
            aria-label={open ? `Collapse ${p.name}` : `Expand ${p.name}`}
            onClick={() => setExpanded(key, !open)}
          >
            {open ? '▾' : '▸'}
          </button>
          <div className="row-main">
            <div
              className="row-title"
              title={`${p.name}${p.client ? ` · ${p.client}` : ''}${seller ? ` · seller ${seller.name}` : ''}. Click to ${open ? 'collapse' : 'expand'}; ••• → Details for checks and roles`}
            >
              <span className="ws-name">{p.name}</span>
              {p.client && groupBy !== 'client' && <span className="client">· {p.client}</span>}
            </div>
            <div className="row-meta">
              <StatusSelect compact disabled={!can.edit} value={p.status} onChange={(status) => updateProject(p.id, { status })} />
              {p.status === 'pipeline' && (
                <select
                  className={p.winProbability ? 'win-select' : 'win-select unset'}
                  aria-label={`Win probability for ${p.name}`}
                  title={`Chance of winning it. Sorts and filters workstreams; under ${LIKELY_WIN}%, the risk it puts on people is a low risk. Loads aren't weighted by it.`}
                  disabled={!can.edit}
                  value={p.winProbability ?? ''}
                  onChange={(e) =>
                    updateProject(p.id, { winProbability: e.target.value ? (Number(e.target.value) as WinProbability) : undefined })
                  }
                >
                  <option value="">–%</option>
                  {WIN_PROBABILITIES.map((n) => (
                    <option key={n} value={n}>
                      {n}%
                    </option>
                  ))}
                </select>
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
                <span
                  className={allRiskLow ? 'badge badge-risk low' : 'badge badge-risk'}
                  title={
                    allRiskLow
                      ? `${riskPeople.length} low risk: over capacity only if pipeline work under ${LIKELY_WIN}% likely to be won comes through`
                      : `${riskPeople.length} at risk: people who would be over capacity if pipeline work is won`
                  }
                >
                  {riskPeople.length} {allRiskLow ? 'low risk' : 'at risk'}
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
        const avg = roll((w) => totals?.get(w) ?? 0, b.weeks);
        const inBucket = (sev: Severity) =>
          assignments.some((a) => flagsByAssignment.get(a.id)![sev].some((w) => b.weeks.includes(w)));
        const worst: Severity | null = inBucket('over') ? 'over' : inBucket('stretch') ? 'stretch' : inBucket('risk') ? 'risk' : null;
        const note =
          worst === 'over' || worst === 'stretch'
            ? ' · someone is over capacity'
            : worst === 'risk'
              ? ' · someone is over capacity if pipeline work is won'
              : '';
        const openFte = roll((w) => roles.reduce((m, r) => m + (r.weekly[w] ?? 0), 0), b.weeks);
        const openNote = openFte ? ` · +${fteLabel(openFte)} in open roles` : '';
        return {
          text: avg ? fteLabel(avg) : '',
          extra: openFte ? `+${fte(openFte)} open` : undefined,
          band: avg ? 'staffed' : 'open',
          short: { text: avg ? fte(avg) : '', extra: openFte ? `+${fte(openFte)}` : undefined },
          className: [
            'fte',
            worst ? `has-${worst}` : '',
            assignments.some((a) => b.weeks.some((w) => a.weekly[w] && weekKind(p, w) === 'presales'))
              ? 'has-presales'
              : '',
          ].join(' '),
          title:
            avg || openFte
              ? `${fteLabel(avg)} staffed${b.weeks.length > 1 ? ` (${rollWord})` : ''}${openNote}${note}`
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
                    <AssignmentBadges worst={rowWorst} mismatch={d.mismatchedAssignmentIds.has(a.id)} lowRisk={lowRiskOf(a)} />
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

  // Groups, when grouping: clients and sellers A–Z (case-insensitive) with "No client" / "No seller" last;
  // stages in pipeline → won → lost order.
  const groups: { key: string; name: string | undefined; projects: Project[]; order: number }[] = [];
  if (groupBy !== 'none') {
    const byKey = new Map<string, (typeof groups)[number]>();
    for (const p of projects) {
      const seller = p.sellerId ? d.sellersById.get(p.sellerId) : undefined;
      const [key, name, order] =
        groupBy === 'client'
          ? [clientGroupKey(p.client), p.client?.trim() || undefined, 0]
          : groupBy === 'seller'
            ? [sellerGroupKey(seller ? p.sellerId : null), seller?.name, 0]
            : [stageGroupKey(p.status), STATUS_LABELS[p.status], STAGE_ORDER.indexOf(p.status)];
      const group = byKey.get(key) ?? { key, name, projects: [], order };
      group.projects.push(p);
      byKey.set(key, group);
    }
    groups.push(
      ...[...byKey.values()].sort(
        (a, b) => a.order - b.order || Number(!a.name) - Number(!b.name) || (a.name ?? '').localeCompare(b.name ?? ''),
      ),
    );
  }
  const groupNoun = groupBy === 'seller' ? 'seller' : groupBy === 'stage' ? 'stage' : 'client';

  if (groupBy === 'none') projects.forEach(pushProject);
  for (const g of groups) {
    const open = isExpanded(expanded, g.key);
    const issues = g.projects.filter((p) => conflicted.has(p.id)).length;
    const fte = (w: string) => g.projects.reduce((n, p) => n + (d.projectLoad.get(p.id)?.get(w) ?? 0), 0);
    rows.push({
      key: g.key,
      depth: 0,
      className: 'group-row',
      label: (
        <div className="row-label row-toggle" onClick={toggleOnRowClick(g.key, open)}>
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
              {g.name ? <strong>{g.name}</strong> : <em className="muted">No {groupNoun}</em>}{' '}
              <span className="muted small">
                · {g.projects.length} {g.projects.length === 1 ? 'workstream' : 'workstreams'}
              </span>
              {issues > 0 && (
                <span className="badge badge-warn" title={`${issues} of these workstreams have an issue`}>
                  ⚠ {issues}
                </span>
              )}
            </div>
          </div>
        </div>
      ),
      summary: (b) => {
        const avg = roll(fte, b.weeks);
        return {
          text: avg ? fteLabel(avg) : '',
          band: 'staffed',
          short: { text: avg ? fteLabel(avg).replace(/ FTE$/, '') : '' },
          className: 'group-sum',
          title: avg ? `${fteLabel(avg)} staffed across these workstreams${b.weeks.length > 1 ? ` (${rollWord})` : ''}` : undefined,
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
              <span className="spacer" />
              <label className="group-by">
                Group by
                <select aria-label="Group by" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
                  <option value="none">None</option>
                  <option value="client">Client</option>
                  <option value="seller">Seller</option>
                  <option value="stage">Stage</option>
                </select>
              </label>
            </div>
            <div className="corner-actions">
              <button type="button" className="link-small" onClick={() => setAllExpanded([...groupKeys, ...projectKeys], true)}>
                Expand all
              </button>
              <button type="button" className="link-small" onClick={() => setAllExpanded(projectKeys, false)}>
                Collapse all
              </button>
              {groupBy !== 'none' && (
                <button type="button" className="link-small" onClick={() => setAllExpanded(groupKeys, false)} title="Collapse to one row per group">
                  Groups only
                </button>
              )}
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
          ) : filters.pipelineOnly && plan.projects.every((p) => p.status !== 'pipeline') ? (
            'No workstreams are in the pipeline. Turn off Pipeline only to see won and lost ones.'
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
