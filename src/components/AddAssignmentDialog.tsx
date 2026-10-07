import { useState, type ReactNode } from 'react';
import { STATUS_LABELS } from '../domain/labels';
import { classify, severity, type Severity } from '../domain/load';
import { CLICK_STEPS } from '../domain/steps';
import type { AllocationKind, Project, Resource, WeekKey } from '../domain/types';
import { addWeeks, currentWeek, formatWeekRange, normalizeWeek, weeksBetween } from '../domain/weeks';
import { usePlan, usePlanStore } from '../store/planStore';
import { useDerived } from '../store/useDerived';
import { TagChips } from './Chips';
import { Modal } from './Modal';

type Props = { onClose: () => void } & ({ projectId: string; resourceId?: never } | { resourceId: string; projectId?: never });

function defaultRange(project: Project | undefined): { from: WeekKey; to: WeekKey } {
  const from = project?.startWeek ?? currentWeek();
  return { from, to: project?.endWeek && project.endWeek >= from ? project.endWeek : addWeeks(from, 11) };
}

/**
 * Puts a person on a project and fills a % over a date range in one step.
 * Opened from a project (pick a person) or from a person (pick a project).
 * Candidates are ranked by matching capabilities, then by free capacity.
 */
export function AddAssignmentDialog({ projectId, resourceId, onClose }: Props) {
  const plan = usePlan();
  const d = useDerived();
  const addAssignment = usePlanStore((s) => s.addAssignment);
  const threshold = plan.settings.overallocationThreshold;

  const [pickedId, setPickedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [percent, setPercent] = useState(50);
  const [range, setRange] = useState<{ from: WeekKey; to: WeekKey } | null>(null);
  const [kindChoice, setKindChoice] = useState<AllocationKind | null>(null);

  const project: Project | undefined = projectId
    ? d.projectsById.get(projectId)
    : pickedId
      ? d.projectsById.get(pickedId)
      : undefined;
  const resource: Resource | undefined = resourceId
    ? d.resourcesById.get(resourceId)
    : pickedId
      ? d.resourcesById.get(pickedId)
      : undefined;

  const { from, to } = range ?? defaultRange(project);
  const weeks = weeksBetween(from, to);
  // Pipeline deals default to presales effort; won projects to delivery.
  const kind: AllocationKind = kindChoice ?? (project?.status === 'pipeline' ? 'presales' : 'delivery');

  /**
   * Peak total load (committed + tentative) over the chosen weeks, now and
   * after this change, plus the worst severity it would cause.
   */
  const peaks = (rid: string, p: Project) => {
    const committed = d.loads.committed.get(rid);
    const tentative = d.loads.tentative.get(rid);
    const cls = classify(kind, p.status);
    const existing = d.assignmentsByProject.get(p.id)?.find((a) => a.resourceId === rid && a.kind === kind);
    let now = 0;
    let after = 0;
    let worst: Severity | null = null;
    for (const w of weeks) {
      let c = committed?.get(w) ?? 0;
      let t = tentative?.get(w) ?? 0;
      now = Math.max(now, c + t);
      const delta = percent - (existing?.weekly[w] ?? 0);
      if (cls === 'committed') c += delta;
      else if (cls === 'tentative') t += delta;
      after = Math.max(after, c + t);
      const sev = severity(c, t, threshold);
      if (sev === 'over' || (sev === 'risk' && !worst)) worst = sev;
    }
    return { now, after, worst };
  };
  const loadClass = (worst: Severity | null) => (worst === 'over' ? 'load load-over' : worst === 'risk' ? 'load load-risk' : 'load');

  const q = query.trim().toLowerCase();
  const title = projectId ? `Add person to ${project?.name ?? 'project'}` : `Assign ${resource?.name ?? 'person'} to a project`;

  let list: ReactNode;
  if (projectId && project) {
    const need = new Set(project.tagIds);
    const onProject = new Set(
      (d.assignmentsByProject.get(project.id) ?? []).filter((a) => a.kind === kind).map((a) => a.resourceId),
    );
    const candidates = plan.resources
      .filter((r) => !q || r.name.toLowerCase().includes(q) || (r.role ?? '').toLowerCase().includes(q))
      .map((r) => ({ r, matches: r.tagIds.filter((t) => need.has(t)).length, ...peaks(r.id, project) }))
      .sort((a, b) => b.matches - a.matches || a.now - b.now || a.r.name.localeCompare(b.r.name));
    list = candidates.map(({ r, matches, now, after, worst }) => (
      <li key={r.id}>
        <label className={pickedId === r.id ? 'candidate picked' : 'candidate'}>
          <input type="radio" name="candidate" checked={pickedId === r.id} onChange={() => setPickedId(r.id)} />
          <span className="candidate-main">
            <span className="candidate-name">
              {r.name}
              {r.role && <span className="muted small"> · {r.role}</span>}
              {onProject.has(r.id) && <span className="badge">Has {kind} row</span>}
              {need.size > 0 && matches === 0 && <span className="badge badge-warn">No matching skill</span>}
            </span>
            <TagChips tagIds={r.tagIds} tagsById={d.tagsById} highlight={need.size ? need : undefined} />
          </span>
          <span className={loadClass(worst)} title="Peak weekly load (committed + pipeline) over the chosen dates: now → after this change">
            {now}% → {after}%
          </span>
        </label>
      </li>
    ));
  } else if (resourceId && resource) {
    const has = new Set(resource.tagIds);
    const candidates = plan.projects
      .filter((p) => !q || p.name.toLowerCase().includes(q) || (p.client ?? '').toLowerCase().includes(q))
      .map((p) => ({ p, matches: p.tagIds.filter((t) => has.has(t)).length }))
      .sort((a, b) => b.matches - a.matches || (a.p.startWeek ?? '').localeCompare(b.p.startWeek ?? ''));
    list = candidates.map(({ p, matches }) => (
      <li key={p.id}>
        <label className={pickedId === p.id ? 'candidate picked' : 'candidate'}>
          <input
            type="radio"
            name="candidate"
            checked={pickedId === p.id}
            onChange={() => {
              setPickedId(p.id);
              setRange(null);
              setKindChoice(null);
            }}
          />
          <span className="candidate-main">
            <span className="candidate-name">
              {p.name}
              {p.client && <span className="muted small"> · {p.client}</span>}
              <span className={`status-text status-${p.status}`}> · {STATUS_LABELS[p.status]}</span>
              {p.tagIds.length > 0 && matches === 0 && <span className="badge badge-warn">No matching skill</span>}
            </span>
            <TagChips tagIds={p.tagIds} tagsById={d.tagsById} highlight={has} />
          </span>
          <span className="muted small">
            {p.startWeek && p.endWeek ? formatWeekRange(p.startWeek, p.endWeek) : 'No dates'}
          </span>
        </label>
      </li>
    ));
  }

  const selectedPeaks = resource && project ? peaks(resource.id, project) : null;
  const canSave = !!resource && !!project && weeks.length > 0;

  const save = () => {
    if (!resource || !project) return;
    addAssignment(project.id, resource.id, kind, percent > 0 ? { percent, from, to } : undefined);
    onClose();
  };

  const setDate = (which: 'from' | 'to', value: string) => {
    if (!value) return;
    setRange({ from, to, [which]: normalizeWeek(value) });
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      footer={
        <>
          {selectedPeaks?.worst === 'over' && (
            <span className="warn-text danger-text">
              ⚠ {resource!.name} will be overallocated (peak {selectedPeaks.after}%) in this range
            </span>
          )}
          {selectedPeaks?.worst === 'risk' && (
            <span className="warn-text">
              {resource!.name} will be at risk (peak {selectedPeaks.after}% if pipeline work is won)
            </span>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!canSave} onClick={save}>
            Add{percent > 0 ? ` at ${percent}%` : ''}
          </button>
        </>
      }
    >
      <div className="form-row">
        <div className="label-like">
          Type of work
          <div className="segmented" role="group" aria-label="Type of work">
            {(['presales', 'delivery'] as const).map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKindChoice(k)}>
                {k === 'presales' ? 'Presales' : 'Delivery'}
              </button>
            ))}
          </div>
        </div>
        <div className="label-like">
          Allocation
          <div className="segmented" role="group" aria-label="Allocation">
            {CLICK_STEPS.filter((v) => v > 0).map((v) => (
              <button key={v} type="button" aria-pressed={percent === v} onClick={() => setPercent(v)}>
                {v}%
              </button>
            ))}
          </div>
        </div>
        <label>
          From week of
          <input type="date" value={from} onChange={(e) => setDate('from', e.target.value)} />
        </label>
        <label>
          Through week of
          <input type="date" value={to} onChange={(e) => setDate('to', e.target.value)} />
        </label>
        <span className="muted small form-hint">{weeks.length} week{weeks.length === 1 ? '' : 's'}</span>
      </div>
      {project && (
        <p className="muted small form-note">
          {kind === 'presales'
            ? 'Presales time counts toward load whether or not the deal is won.'
            : project.status === 'won'
              ? 'Delivery on a won project counts toward load.'
              : project.status === 'pipeline'
                ? 'Delivery on a pipeline project is tentative: it shows as “at risk”, not overallocated, until the project is won.'
                : 'Delivery on a lost project is not counted.'}
        </p>
      )}
      <input
        type="search"
        className="search"
        placeholder={projectId ? 'Filter people…' : 'Filter projects…'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      <ul className="candidates">{list}</ul>
    </Modal>
  );
}
