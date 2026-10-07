import { useState } from 'react';
import { bucketStats, totalsGetter } from '../domain/aggregate';
import { assignmentFlagWeeks } from '../domain/conflicts';
import type { Derived } from '../domain/derive';
import { STATUS_LABELS } from '../domain/labels';
import { severity, totalIsCritical } from '../domain/load';
import { CAREER_LEVELS, type CareerLevel, type Resource } from '../domain/types';
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
  const pushResource = (r: Resource) => {
    const key = `r:${r.id}`;
    const open = isExpanded(expanded, key);
    const committed = totalsGetter(d.loads.committed.get(r.id));
    const tentative = totalsGetter(d.loads.tentative.get(r.id));
    const sevOf = (w: string) => severity(committed(w), tentative(w), plan.settings);
    const overCount = visibleWeeks.filter((w) => sevOf(w) === 'over').length;
    const stretchCount = visibleWeeks.filter((w) => sevOf(w) === 'stretch').length;
    const riskCount = visibleWeeks.filter((w) => sevOf(w) === 'risk').length;
    const weeksText = (n: number) => `${n}w`;
    const assignments = [...(d.assignmentsByResource.get(r.id) ?? [])].sort(
      (a, b) =>
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
              {r.level && <span className="level-badge">{r.level}</span>}
              {r.role && <span className="muted small"> · {r.role}</span>}
            </div>
            <div className="row-meta">
            {(overCount > 0 || stretchCount > 0 || riskCount > 0) && (
              <span className="row-badges">
                {overCount > 0 && (
                  <span className="badge badge-danger" title={`Committed work above ${plan.settings.criticalThreshold}%`}>
                    ⚠ Overallocated {weeksText(overCount)}
                  </span>
                )}
                {stretchCount > 0 && (
                  <span className="badge badge-stretch" title={`Committed work above ${threshold}%`}>
                    Stretched {weeksText(stretchCount)}
                  </span>
                )}
                {riskCount > 0 && (
                  <span className="badge badge-risk" title="Over capacity only if pipeline delivery work is won">
                    At risk {weeksText(riskCount)}
                  </span>
                )}
              </span>
            )}
              <TagChips tagIds={r.tagIds} tagsById={d.tagsById} />
            </div>
          </div>
          <button type="button" className="btn btn-small" onClick={() => setAdding(r.id)}>
            + Workstream
          </button>
        </div>
      ),
      summary: (b) => {
        const c = bucketStats(committed, b.weeks);
        const t = bucketStats(tentative, b.weeks);
        const sevs = b.weeks.map(sevOf);
        let className = 'heat';
        if (sevs.includes('over')) className += ' heat-over';
        else if (sevs.includes('stretch')) className += ' heat-stretch';
        else if (sevs.includes('risk')) {
          className += ' heat-risk';
          if (b.weeks.some((w) => sevOf(w) === 'risk' && totalIsCritical(committed(w), tentative(w), plan.settings))) {
            className += ' heat-risk-critical';
          }
        }
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

    if (!open) return;
    for (const a of assignments) {
      const p = d.projectsById.get(a.projectId);
      if (!p) continue;
      const mismatch = d.mismatchedAssignmentIds.has(a.id);
      const flags = assignmentFlagWeeks(a, visibleWeeks, d.loads, plan.settings);
      rows.push({
        key: `a:${a.id}`,
        depth: 1,
        assignmentId: a.id,
        range: { start: p.startWeek, end: p.endWeek },
        label: (
          <div className="row-label">
            <div className="row-main">
              <div className="row-title">
                <span className="row-name">
                  {p.name}
                  {p.client && <span className="muted small"> · {p.client}</span>}
                  <span className={`status-text status-${p.status}`}> · {STATUS_LABELS[p.status]}</span>
                </span>
                <AssignmentBadges
                  worst={flags.over.length ? 'over' : flags.stretch.length ? 'stretch' : flags.risk.length ? 'risk' : null}
                  mismatch={mismatch}
                />
              </div>
            </div>
            <button
              type="button"
              className="icon-btn"
              aria-label={`Remove ${r.name} from ${p.name}`}
              title="Remove from workstream"
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
  };

  // Group by career level (most senior first); people without a level go last.
  const groups: { level: CareerLevel | undefined; people: Resource[] }[] = [...CAREER_LEVELS, undefined]
    .map((level) => ({ level, people: resources.filter((r) => r.level === level) }))
    .filter((g) => g.people.length > 0);
  for (const { level, people } of groups) {
    const key = `g:${level ?? 'none'}`;
    const open = isExpanded(expanded, key);
    const committedOf = (w: string) => people.reduce((n, r) => n + (d.loads.committed.get(r.id)?.get(w) ?? 0), 0);
    const tentativeOf = (w: string) => people.reduce((n, r) => n + (d.loads.tentative.get(r.id)?.get(w) ?? 0), 0);
    rows.push({
      key,
      depth: 0,
      className: 'group-row',
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
              <strong>{level ?? 'No level'}</strong>{' '}
              <span className="muted small">
                · {people.length} {people.length === 1 ? 'person' : 'people'}
              </span>
            </div>
          </div>
        </div>
      ),
      summary: (b) => {
        // Average utilisation of the level's people (%), so groups of any size compare directly.
        const c = bucketStats(committedOf, b.weeks).avg / 100;
        const t = bucketStats(tentativeOf, b.weeks).avg / 100;
        const util = (c / people.length) * 100;
        const extra = (t / people.length) * 100;
        const ppl = `${people.length} ${people.length === 1 ? 'person' : 'people'}`;
        return {
          text: util ? String(Math.round(util)) : '',
          extra: extra ? `+${Math.round(extra)}` : undefined,
          className: util > plan.settings.overallocationThreshold ? 'group-sum over-capacity' : 'group-sum',
          title: `Average ${Math.round(util)}% committed: ${c.toFixed(2)} FTE across ${ppl}${t ? ` · +${t.toFixed(2)} FTE pipeline` : ''}`,
        };
      },
    });
    if (open) people.forEach(pushResource);
  }

  const resourceKeys = resources.map((r) => `r:${r.id}`);
  const groupKeys = groups.map((g) => `g:${g.level ?? 'none'}`);

  return (
    <>
      <TimeGrid
        zoom={zoom}
        buckets={buckets}
        rows={rows}
        corner={
          <div className="corner-content">
            <strong>Resources</strong> <span className="muted">({resources.length}) · % per week (levels: average)</span>
            <div className="corner-actions">
              <button type="button" className="btn btn-small" onClick={() => setAllExpanded([...groupKeys, ...resourceKeys], true)}>
                Expand
              </button>
              <button type="button" className="btn btn-small" onClick={() => setAllExpanded(resourceKeys, false)}>
                Collapse
              </button>
              <button type="button" className="btn btn-small" onClick={() => setAllExpanded(groupKeys, false)}>
                Levels only
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
