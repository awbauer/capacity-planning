import { useState } from 'react';
import { bucketStats, totalsGetter } from '../domain/aggregate';
import { isOver } from '../domain/conflicts';
import type { Derived } from '../domain/derive';
import type { Resource } from '../domain/types';
import type { Bucket } from '../domain/weeks';
import { usePlan, usePlanStore } from '../store/planStore';
import { isExpanded, useUIStore, type Filters } from '../store/uiStore';
import { useDerived } from '../store/useDerived';
import { AddAssignmentDialog } from './AddAssignmentDialog';
import { TagChips } from './Chips';
import { TimeGrid, type GridRow } from './grid/TimeGrid';

interface Props {
  buckets: Bucket[];
}

function matchesFilters(r: Resource, f: Filters, d: Derived): boolean {
  if (f.tagId && !r.tagIds.includes(f.tagId)) return false;
  const assignments = d.assignmentsByResource.get(r.id) ?? [];
  if (f.sellerId && !assignments.some((a) => d.projectsById.get(a.projectId)?.sellerId === f.sellerId)) {
    return false;
  }
  const q = f.text.trim().toLowerCase();
  if (!q) return true;
  return [r.name, r.role ?? ''].some((s) => s.toLowerCase().includes(q));
}

export function ResourceView({ buckets }: Props) {
  const plan = usePlan();
  const d = useDerived();
  const zoom = useUIStore((s) => s.zoom);
  const filters = useUIStore((s) => s.filters);
  const expanded = useUIStore((s) => s.expanded);
  const setExpanded = useUIStore((s) => s.setExpanded);
  const setAllExpanded = useUIStore((s) => s.setAllExpanded);
  const removeAssignment = usePlanStore((s) => s.removeAssignment);
  const [adding, setAdding] = useState<string | null>(null);

  const threshold = plan.settings.overallocationThreshold;
  const visibleWeeks = buckets.flatMap((b) => b.weeks);
  const resources = plan.resources
    .filter((r) => matchesFilters(r, filters, d))
    .sort((a, b) => a.name.localeCompare(b.name));

  const rows: GridRow[] = [];
  for (const r of resources) {
    const key = `r:${r.id}`;
    const open = isExpanded(expanded, key);
    const load = d.resourceLoad.get(r.id);
    const get = totalsGetter(load);
    const overCount = visibleWeeks.filter((w) => isOver(get(w), threshold)).length;
    const assignments = [...(d.assignmentsByResource.get(r.id) ?? [])].sort((a, b) =>
      (d.projectsById.get(a.projectId)?.name ?? '').localeCompare(d.projectsById.get(b.projectId)?.name ?? ''),
    );

    rows.push({
      key,
      depth: 0,
      className: 'resource-row',
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
              {r.name}
              {r.role && <span className="muted small"> · {r.role}</span>}
            </div>
            <div className="row-meta">
              <TagChips tagIds={r.tagIds} tagsById={d.tagsById} />
              <span className="muted small">
                {assignments.length} project{assignments.length === 1 ? '' : 's'}
              </span>
            </div>
            {overCount > 0 && (
              <div className="row-badges">
                <span className="badge badge-danger">
                  ⚠ Over {threshold}% in {overCount} week{overCount === 1 ? '' : 's'}
                </span>
              </div>
            )}
          </div>
          <button type="button" className="btn btn-small" onClick={() => setAdding(r.id)}>
            + Project
          </button>
        </div>
      ),
      summary: (b) => {
        const st = bucketStats(get, b.weeks);
        let className = 'heat';
        if (isOver(st.peak, threshold)) className += ' heat-over';
        else if (st.avg >= threshold * 0.8) className += ' heat-full';
        else if (st.avg > 0) className += ' heat-part';
        const title =
          st.avg || st.peak
            ? b.weeks.length > 1
              ? `Average ${Math.round(st.avg)}%, peak week ${st.peak}%`
              : `${st.peak}% allocated`
            : 'Unallocated';
        return { text: st.avg ? String(Math.round(st.avg)) : '', className, title };
      },
    });

    if (!open) continue;
    for (const a of assignments) {
      const p = d.projectsById.get(a.projectId);
      if (!p) continue;
      const mismatch = d.mismatchedAssignmentIds.has(a.id);
      rows.push({
        key: `a:${a.id}`,
        depth: 1,
        assignmentId: a.id,
        range: { start: p.startWeek, end: p.endWeek },
        label: (
          <div className="row-label">
            <div className="row-main">
              <div className="row-title">
                {p.name}
                {p.client && <span className="muted small"> · {p.client}</span>}
              </div>
              {mismatch && (
                <div className="row-badges">
                  <span className="badge badge-warn" title="This person has none of the project's required capabilities">
                    Skill mismatch
                  </span>
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

  const resourceKeys = resources.map((r) => `r:${r.id}`);

  return (
    <>
      <TimeGrid
        zoom={zoom}
        buckets={buckets}
        rows={rows}
        corner={
          <div className="corner-content">
            <strong>Resources</strong> <span className="muted">({resources.length}) · total % per week</span>
            <div className="corner-actions">
              <button type="button" className="btn btn-small" onClick={() => setAllExpanded(resourceKeys, true)}>
                Expand
              </button>
              <button type="button" className="btn btn-small" onClick={() => setAllExpanded(resourceKeys, false)}>
                Collapse
              </button>
            </div>
          </div>
        }
        empty={
          plan.resources.length === 0
            ? 'No resources yet. Add people under Manage → Resources.'
            : 'No resources match the filters.'
        }
      />
      {adding && <AddAssignmentDialog resourceId={adding} onClose={() => setAdding(null)} />}
    </>
  );
}
