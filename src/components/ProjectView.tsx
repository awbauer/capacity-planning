import { useState } from 'react';
import type { Derived } from '../domain/derive';
import { assignmentOverWeeks } from '../domain/conflicts';
import type { Project } from '../domain/types';
import type { Bucket } from '../domain/weeks';
import { usePlan, usePlanStore } from '../store/planStore';
import { isExpanded, useUIStore, type Filters } from '../store/uiStore';
import { useDerived } from '../store/useDerived';
import { AddAssignmentDialog } from './AddAssignmentDialog';
import { TagChips } from './Chips';
import { TimeGrid, type GridRow } from './grid/TimeGrid';
import { ProjectDialog } from './ProjectDialog';

interface Props {
  buckets: Bucket[];
}

function matchesFilters(p: Project, f: Filters, d: Derived): boolean {
  if (f.tagId && !p.tagIds.includes(f.tagId)) return false;
  if (f.sellerId && p.sellerId !== f.sellerId) return false;
  const q = f.text.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    p.name,
    p.client ?? '',
    p.sellerId ? (d.sellersById.get(p.sellerId)?.name ?? '') : '',
    ...(d.assignmentsByProject.get(p.id) ?? []).map((a) => d.resourcesById.get(a.resourceId)?.name ?? ''),
  ];
  return haystack.some((s) => s.toLowerCase().includes(q));
}

function sortProjects(projects: Project[]): Project[] {
  return [...projects].sort(
    (a, b) =>
      (a.startWeek ?? '9999').localeCompare(b.startWeek ?? '9999') || a.name.localeCompare(b.name),
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
  const removeAssignment = usePlanStore((s) => s.removeAssignment);
  const [adding, setAdding] = useState<string | null>(null);
  const [editing, setEditing] = useState<Project | 'new' | null>(null);

  const visibleWeeks = buckets.flatMap((b) => b.weeks);
  const projects = sortProjects(plan.projects.filter((p) => matchesFilters(p, filters, d)));

  const rows: GridRow[] = [];
  for (const p of projects) {
    const key = `p:${p.id}`;
    const open = isExpanded(expanded, key);
    const assignments = [...(d.assignmentsByProject.get(p.id) ?? [])].sort((a, b) =>
      (d.resourcesById.get(a.resourceId)?.name ?? '').localeCompare(d.resourcesById.get(b.resourceId)?.name ?? ''),
    );
    const overByAssignment = new Map(
      assignments.map((a) => [
        a.id,
        assignmentOverWeeks(a, visibleWeeks, d.resourceLoad.get(a.resourceId), plan.settings.overallocationThreshold),
      ]),
    );
    const overPeople = assignments.filter((a) => overByAssignment.get(a.id)!.length > 0).length;
    const uncovered = d.uncoveredByProject.get(p.id) ?? [];
    const seller = p.sellerId ? d.sellersById.get(p.sellerId) : undefined;
    const totals = d.projectLoad.get(p.id);

    rows.push({
      key,
      depth: 0,
      className: 'project-row',
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
              <button type="button" className="link" onClick={() => setEditing(p)} title="Edit project">
                {p.name}
              </button>
              {p.client && <span className="muted"> · {p.client}</span>}
            </div>
            <div className="row-meta">
              <span className="seller" title="Seller">
                {seller ? seller.name : <em className="muted">No seller</em>}
              </span>
              <TagChips tagIds={p.tagIds} tagsById={d.tagsById} />
            </div>
            {(overPeople > 0 || uncovered.length > 0 || assignments.length === 0) && (
              <div className="row-badges">
                {overPeople > 0 && (
                  <span className="badge badge-danger" title="People on this project who are overallocated in the visible range">
                    ⚠ {overPeople} overallocated
                  </span>
                )}
                {uncovered.length > 0 && (
                  <span className="badge badge-warn" title="Required capabilities nobody on the project has">
                    Uncovered: {uncovered.map((t) => d.tagsById.get(t)?.name).join(', ')}
                  </span>
                )}
                {assignments.length === 0 && <span className="badge">Unstaffed</span>}
              </div>
            )}
          </div>
          <button type="button" className="btn btn-small" onClick={() => setAdding(p.id)}>
            + Person
          </button>
        </div>
      ),
      summary: (b) => {
        const avg = b.weeks.reduce((s, w) => s + (totals?.get(w) ?? 0), 0) / b.weeks.length;
        const over = assignments.some((a) => overByAssignment.get(a.id)!.some((w) => b.weeks.includes(w)));
        return {
          text: avg ? (avg / 100).toFixed(1) : '',
          className: over ? 'fte has-over' : 'fte',
          title: avg ? `${(avg / 100).toFixed(2)} FTE${b.weeks.length > 1 ? ' (average)' : ''}${over ? ' · someone is overallocated' : ''}` : undefined,
        };
      },
    });

    if (!open) continue;
    for (const a of assignments) {
      const r = d.resourcesById.get(a.resourceId);
      if (!r) continue;
      const mismatch = d.mismatchedAssignmentIds.has(a.id);
      const over = overByAssignment.get(a.id)!.length > 0;
      rows.push({
        key: `a:${a.id}`,
        depth: 1,
        assignmentId: a.id,
        range: { start: p.startWeek, end: p.endWeek },
        label: (
          <div className="row-label">
            <div className="row-main">
              <div className="row-title">
                {r.name}
                {r.role && <span className="muted small"> · {r.role}</span>}
              </div>
              {(mismatch || over) && (
                <div className="row-badges">
                  {over && <span className="badge badge-danger">⚠ Overallocated</span>}
                  {mismatch && (
                    <span className="badge badge-warn" title="This person has none of the project's required capabilities">
                      Skill mismatch
                    </span>
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              className="icon-btn"
              aria-label={`Remove ${r.name} from ${p.name}`}
              title="Remove from project"
              onClick={() => {
                const weeks = Object.keys(a.weekly).length;
                if (weeks === 0 || window.confirm(`Remove ${r.name} from ${p.name}? This clears ${weeks} week(s) of allocation (undo with Ctrl+Z).`)) {
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
  }

  const projectKeys = projects.map((p) => `p:${p.id}`);

  return (
    <>
      <TimeGrid
        zoom={zoom}
        buckets={buckets}
        rows={rows}
        corner={
          <div className="corner-content">
            <strong>Projects</strong> <span className="muted">({projects.length})</span>
            <div className="corner-actions">
              <button type="button" className="btn btn-small btn-primary" onClick={() => setEditing('new')}>
                + New project
              </button>
              <button type="button" className="btn btn-small" onClick={() => setAllExpanded(projectKeys, true)}>
                Expand
              </button>
              <button type="button" className="btn btn-small" onClick={() => setAllExpanded(projectKeys, false)}>
                Collapse
              </button>
            </div>
          </div>
        }
        empty={
          plan.projects.length === 0 ? (
            <span>
              No projects yet.{' '}
              <button type="button" className="link" onClick={() => setEditing('new')}>
                Create one
              </button>
            </span>
          ) : (
            'No projects match the filters.'
          )
        }
      />
      {adding && <AddAssignmentDialog projectId={adding} onClose={() => setAdding(null)} />}
      {editing && (
        <ProjectDialog project={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}
