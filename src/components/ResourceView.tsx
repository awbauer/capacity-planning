import { useState } from 'react';
import { bucketStats, totalsGetter } from '../domain/aggregate';
import { assignmentFlagWeeks } from '../domain/conflicts';
import type { Derived } from '../domain/derive';
import { STATUS_LABELS } from '../domain/labels';
import { severity } from '../domain/load';
import type { Resource } from '../domain/types';
import type { Bucket } from '../domain/weeks';
import { usePlan, usePlanStore } from '../store/planStore';
import { isExpanded, useUIStore, type Filters } from '../store/uiStore';
import { useDerived } from '../store/useDerived';
import { AddAssignmentDialog } from './AddAssignmentDialog';
import { TagChips } from './Chips';
import { AssignmentBadges } from './StatusControls';
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
  if (f.status && !assignments.some((a) => d.projectsById.get(a.projectId)?.status === f.status)) return false;
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
    const committed = totalsGetter(d.loads.committed.get(r.id));
    const tentative = totalsGetter(d.loads.tentative.get(r.id));
    const sevOf = (w: string) => severity(committed(w), tentative(w), threshold);
    const overCount = visibleWeeks.filter((w) => sevOf(w) === 'over').length;
    const riskCount = visibleWeeks.filter((w) => sevOf(w) === 'risk').length;
    const assignments = [...(d.assignmentsByResource.get(r.id) ?? [])].sort(
      (a, b) =>
        (d.projectsById.get(a.projectId)?.name ?? '').localeCompare(d.projectsById.get(b.projectId)?.name ?? '') ||
        a.kind.localeCompare(b.kind),
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
            {(overCount > 0 || riskCount > 0) && (
              <div className="row-badges">
                {overCount > 0 && (
                  <span className="badge badge-danger" title="Committed work (presales + won delivery) over capacity">
                    ⚠ Over {threshold}% in {overCount} week{overCount === 1 ? '' : 's'}
                  </span>
                )}
                {riskCount > 0 && (
                  <span className="badge badge-risk" title="Over capacity only if pipeline delivery work is won">
                    At risk {riskCount} week{riskCount === 1 ? '' : 's'}
                  </span>
                )}
              </div>
            )}
          </div>
          <button type="button" className="btn btn-small" onClick={() => setAdding(r.id)}>
            + Project
          </button>
        </div>
      ),
      summary: (b) => {
        const c = bucketStats(committed, b.weeks);
        const t = bucketStats(tentative, b.weeks);
        const sevs = b.weeks.map(sevOf);
        let className = 'heat';
        if (sevs.includes('over')) className += ' heat-over';
        else if (sevs.includes('risk')) className += ' heat-risk';
        else if (c.avg >= threshold * 0.8) className += ' heat-full';
        else if (c.avg > 0) className += ' heat-part';
        else if (t.avg > 0) className += ' heat-tentative';
        const multi = b.weeks.length > 1;
        const parts: string[] = [];
        if (c.avg || c.peak) parts.push(multi ? `Committed avg ${Math.round(c.avg)}%, peak ${c.peak}%` : `${c.peak}% committed`);
        if (t.avg || t.peak) parts.push(multi ? `pipeline avg +${Math.round(t.avg)}%` : `+${t.peak}% pipeline (tentative)`);
        return {
          text: c.avg ? String(Math.round(c.avg)) : '',
          extra: t.avg ? `+${Math.round(t.avg)}` : undefined,
          className,
          title: parts.length ? parts.join(' · ') : 'Unallocated',
        };
      },
    });

    if (!open) continue;
    for (const a of assignments) {
      const p = d.projectsById.get(a.projectId);
      if (!p) continue;
      const mismatch = d.mismatchedAssignmentIds.has(a.id);
      const flags = assignmentFlagWeeks(a, visibleWeeks, d.loads, threshold);
      const over = flags.over.length > 0;
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
                <span className={`status-text status-${p.status}`}> · {STATUS_LABELS[p.status]}</span>
              </div>
              <AssignmentBadges
                assignment={a}
                cls={d.loads.classOf.get(a.id)}
                over={over}
                risk={!over && flags.risk.length > 0}
                mismatch={mismatch}
              />
            </div>
            <button
              type="button"
              className="icon-btn"
              aria-label={`Remove ${r.name} from ${p.name}`}
              title="Remove from project"
              onClick={() => {
                const weeks = Object.keys(a.weekly).length;
                if (weeks === 0 || window.confirm(`Remove ${r.name}'s ${a.kind} row from ${p.name}? This clears ${weeks} week(s) of allocation (undo with Ctrl+Z).`)) {
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
