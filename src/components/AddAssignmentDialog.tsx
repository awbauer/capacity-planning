import { useState, type ReactNode } from 'react';
import { isOver } from '../domain/conflicts';
import type { Project, Resource, WeekKey } from '../domain/types';
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
  const [percentText, setPercentText] = useState('50');
  const [range, setRange] = useState<{ from: WeekKey; to: WeekKey } | null>(null);

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
  const percent = Math.max(0, Math.round(Number(percentText) || 0));

  /** Current and resulting peak load for a resource over the chosen weeks. */
  const peaks = (rid: string, pid: string | undefined) => {
    const load = d.resourceLoad.get(rid);
    const existing = d.assignmentsByProject.get(pid ?? '')?.find((a) => a.resourceId === rid);
    let now = 0;
    let after = 0;
    for (const w of weeks) {
      const total = load?.get(w) ?? 0;
      now = Math.max(now, total);
      after = Math.max(after, total - (existing?.weekly[w] ?? 0) + percent);
    }
    return { now, after };
  };

  const q = query.trim().toLowerCase();
  const title = projectId ? `Add person to ${project?.name ?? 'project'}` : `Assign ${resource?.name ?? 'person'} to a project`;

  let list: ReactNode;
  if (projectId && project) {
    const need = new Set(project.tagIds);
    const onProject = new Set((d.assignmentsByProject.get(project.id) ?? []).map((a) => a.resourceId));
    const candidates = plan.resources
      .filter((r) => !q || r.name.toLowerCase().includes(q) || (r.role ?? '').toLowerCase().includes(q))
      .map((r) => ({ r, matches: r.tagIds.filter((t) => need.has(t)).length, ...peaks(r.id, project.id) }))
      .sort((a, b) => b.matches - a.matches || a.now - b.now || a.r.name.localeCompare(b.r.name));
    list = candidates.map(({ r, matches, now, after }) => (
      <li key={r.id}>
        <label className={pickedId === r.id ? 'candidate picked' : 'candidate'}>
          <input type="radio" name="candidate" checked={pickedId === r.id} onChange={() => setPickedId(r.id)} />
          <span className="candidate-main">
            <span className="candidate-name">
              {r.name}
              {r.role && <span className="muted small"> · {r.role}</span>}
              {onProject.has(r.id) && <span className="badge">On project</span>}
              {need.size > 0 && matches === 0 && <span className="badge badge-warn">No matching skill</span>}
            </span>
            <TagChips tagIds={r.tagIds} tagsById={d.tagsById} highlight={need.size ? need : undefined} />
          </span>
          <span className={isOver(after, threshold) ? 'load load-over' : 'load'} title="Peak weekly load over the chosen dates: now → after this change">
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
            }}
          />
          <span className="candidate-main">
            <span className="candidate-name">
              {p.name}
              {p.client && <span className="muted small"> · {p.client}</span>}
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

  const selectedPeaks = resource && project ? peaks(resource.id, project.id) : null;
  const canSave = !!resource && !!project && weeks.length > 0;

  const save = () => {
    if (!resource || !project) return;
    addAssignment(project.id, resource.id, percent > 0 ? { percent, from, to } : undefined);
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
          {selectedPeaks && isOver(selectedPeaks.after, threshold) && (
            <span className="warn-text">
              ⚠ {resource!.name} will peak at {selectedPeaks.after}% in this range
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
        <label>
          Allocation %
          <input
            type="number"
            min={0}
            max={999}
            step={5}
            value={percentText}
            onChange={(e) => setPercentText(e.target.value)}
          />
        </label>
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
