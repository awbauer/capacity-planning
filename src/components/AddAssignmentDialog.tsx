import { useState, type ReactNode } from 'react';
import { STATUS_LABELS } from '../domain/labels';
import { severity, weekClass, weekKind, worse, type Severity } from '../domain/load';
import { CLICK_STEPS } from '../domain/steps';
import type { Project, Resource, WeekKey } from '../domain/types';
import { addWeeks, currentWeek, formatWeekRange, normalizeWeek, weeksBetween } from '../domain/weeks';
import { usePlan, usePlanStore } from '../store/planStore';
import { useDerived } from '../store/useDerived';
import { TagChips } from './Chips';
import { Modal } from './Modal';

type Props = { onClose: () => void } & ({ projectId: string; resourceId?: never } | { resourceId: string; projectId?: never });

/**
 * Pipeline workstreams that haven't started default to the presales period
 * (now until the start date); everything else to the workstream's dates.
 */
function defaultRange(project: Project | undefined): { from: WeekKey; to: WeekKey } {
  const now = currentWeek();
  if (project?.status === 'pipeline' && project.startWeek && project.startWeek > now) {
    return { from: now, to: addWeeks(project.startWeek, -1) };
  }
  const from = project?.startWeek ?? now;
  return { from, to: project?.endWeek && project.endWeek >= from ? project.endWeek : addWeeks(from, 11) };
}

/** Explains how the chosen weeks will count: presales before the start date, delivery from it. */
function rangeNote(project: Project, weeks: WeekKey[]): string {
  const presales = weeks.filter((w) => weekKind(project, w) === 'presales').length;
  const delivery = weeks.length - presales;
  const deliveryCounts =
    project.status === 'won'
      ? 'counted'
      : project.status === 'pipeline'
        ? 'tentative until the workstream is won'
        : 'not counted (workstream lost)';
  const parts: string[] = [];
  if (presales) parts.push(`${presales} presales week${presales === 1 ? '' : 's'} before the start date (always counted)`);
  if (delivery) parts.push(`${delivery} delivery week${delivery === 1 ? '' : 's'} (${deliveryCounts})`);
  return parts.join(' · ');
}

interface Addition {
  project: Project;
  from: WeekKey;
  to: WeekKey;
}

/**
 * Puts people on workstreams and fills a % over a date range in one step.
 * Opened from a workstream (tick one or more people) or from a person (tick
 * one or more workstreams). Candidates are ranked by matching capabilities,
 * then by free capacity.
 */
export function AddAssignmentDialog({ projectId, resourceId, onClose }: Props) {
  const plan = usePlan();
  const d = useDerived();
  const addAssignment = usePlanStore((s) => s.addAssignment);

  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [percent, setPercent] = useState(50);
  // null = use each workstream's own default dates.
  const [range, setRange] = useState<{ from: WeekKey; to: WeekKey } | null>(null);

  const fixedProject = projectId ? d.projectsById.get(projectId) : undefined;
  const fixedResource = resourceId ? d.resourcesById.get(resourceId) : undefined;
  const pickedProjects = fixedProject ? [] : picked.flatMap((id) => d.projectsById.get(id) ?? []);
  const pickedResources = fixedResource ? [] : picked.flatMap((id) => d.resourcesById.get(id) ?? []);

  const rangeFor = (p: Project) => range ?? defaultRange(p);
  // The date inputs show the shared range, or the first ticked workstream's own dates.
  const shown = range ?? defaultRange(fixedProject ?? pickedProjects[0]);
  const shownWeeks = weeksBetween(shown.from, shown.to);

  const toggle = (id: string) =>
    setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  /**
   * Peak total load (committed + tentative) for a person over the weeks being
   * filled, now and after these additions, plus the worst severity caused.
   */
  const simulate = (rid: string, additions: Addition[]) => {
    const committed = d.loads.committed.get(rid);
    const tentative = d.loads.tentative.get(rid);
    const allWeeks = [...new Set(additions.flatMap((a) => weeksBetween(a.from, a.to)))].sort();
    let now = 0;
    let after = 0;
    let worst: Severity | null = null;
    for (const w of allWeeks) {
      let c = committed?.get(w) ?? 0;
      let t = tentative?.get(w) ?? 0;
      now = Math.max(now, c + t);
      for (const add of additions) {
        if (w < add.from || w > add.to) continue;
        const existing = d.assignmentsByProject.get(add.project.id)?.find((a) => a.resourceId === rid);
        const delta = percent - (existing?.weekly[w] ?? 0);
        const cls = weekClass(add.project, w);
        if (cls === 'committed') c += delta;
        else if (cls === 'tentative') t += delta;
      }
      after = Math.max(after, c + t);
      worst = worse(worst, severity(c, t, plan.settings));
    }
    return { now, after, worst };
  };
  const loadClass = (worst: Severity | null) => (worst ? `load load-${worst}` : 'load');

  const q = query.trim().toLowerCase();
  const title = fixedProject
    ? `Add people to ${fixedProject.name}`
    : `Add ${fixedResource?.name ?? 'person'} to workstreams`;

  // Every (person, workstream) pair that Save will create, with its dates.
  const pairs: { resource: Resource; addition: Addition }[] = fixedProject
    ? pickedResources.map((r) => ({ resource: r, addition: { project: fixedProject, ...rangeFor(fixedProject) } }))
    : fixedResource
      ? pickedProjects.map((p) => ({ resource: fixedResource, addition: { project: p, ...rangeFor(p) } }))
      : [];

  let list: ReactNode;
  if (fixedProject) {
    const project = fixedProject;
    const need = new Set(project.tagIds);
    const onProject = new Set((d.assignmentsByProject.get(project.id) ?? []).map((a) => a.resourceId));
    const addition = { project, ...rangeFor(project) };
    const candidates = plan.resources
      .filter((r) => !q || r.name.toLowerCase().includes(q) || (r.role ?? '').toLowerCase().includes(q))
      .map((r) => ({ r, matches: r.tagIds.filter((t) => need.has(t)).length, ...simulate(r.id, [addition]) }))
      .sort((a, b) => b.matches - a.matches || a.now - b.now || a.r.name.localeCompare(b.r.name));
    list = candidates.map(({ r, matches, now, after, worst }) => (
      <li key={r.id}>
        <label className={picked.includes(r.id) ? 'candidate picked' : 'candidate'}>
          <input type="checkbox" checked={picked.includes(r.id)} onChange={() => toggle(r.id)} />
          <span className="candidate-main">
            <span className="candidate-name">
              {r.name}
              {r.role && <span className="muted small"> · {r.role}</span>}
              {onProject.has(r.id) && <span className="badge">Already on it</span>}
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
  } else if (fixedResource) {
    const has = new Set(fixedResource.tagIds);
    const onIt = new Set((d.assignmentsByResource.get(fixedResource.id) ?? []).map((a) => a.projectId));
    const candidates = plan.projects
      .filter((p) => !q || p.name.toLowerCase().includes(q) || (p.client ?? '').toLowerCase().includes(q))
      .map((p) => ({ p, matches: p.tagIds.filter((t) => has.has(t)).length }))
      .sort((a, b) => b.matches - a.matches || (a.p.startWeek ?? '').localeCompare(b.p.startWeek ?? ''));
    list = candidates.map(({ p, matches }) => (
      <li key={p.id}>
        <label className={picked.includes(p.id) ? 'candidate picked' : 'candidate'}>
          <input type="checkbox" checked={picked.includes(p.id)} onChange={() => toggle(p.id)} />
          <span className="candidate-main">
            <span className="candidate-name">
              {p.name}
              {p.client && <span className="muted small"> · {p.client}</span>}
              <span className={`status-text status-${p.status}`}> · {STATUS_LABELS[p.status]}</span>
              {onIt.has(p.id) && <span className="badge">Already on it</span>}
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

  // Warnings: per person when adding several people; combined when adding one person to several workstreams.
  const warnings: { name: string; after: number; worst: Severity }[] = [];
  if (fixedProject) {
    for (const { resource, addition } of pairs) {
      const sim = simulate(resource.id, [addition]);
      if (sim.worst) warnings.push({ name: resource.name, after: sim.after, worst: sim.worst });
    }
  } else if (fixedResource && pairs.length) {
    const sim = simulate(fixedResource.id, pairs.map((p) => p.addition));
    if (sim.worst) warnings.push({ name: fixedResource.name, after: sim.after, worst: sim.worst });
  }
  const over = warnings.filter((w) => w.worst === 'over');
  const stretch = warnings.filter((w) => w.worst === 'stretch');
  const risk = warnings.filter((w) => w.worst === 'risk');
  const describe = (ws: typeof warnings) => ws.map((w) => `${w.name} (${w.after}%)`).join(', ');

  const canSave = pairs.length > 0 && pairs.every((p) => p.addition.from <= p.addition.to);

  const save = () => {
    for (const { resource, addition } of pairs) {
      addAssignment(
        addition.project.id,
        resource.id,
        percent > 0 ? { percent, from: addition.from, to: addition.to } : undefined,
      );
    }
    onClose();
  };

  const setDate = (which: 'from' | 'to', value: string) => {
    if (!value) return;
    setRange({ ...shown, [which]: normalizeWeek(value) });
  };

  const count = pairs.length;
  const saveLabel = fixedProject
    ? `Add ${count || ''} ${count === 1 ? 'person' : 'people'}`
    : `Add to ${count || ''} workstream${count === 1 ? '' : 's'}`;
  const perWorkstreamDates = !fixedProject && !range && pickedProjects.length > 1;
  const noteProject = fixedProject ?? (pickedProjects.length === 1 ? pickedProjects[0] : undefined);

  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      footer={
        <>
          {over.length > 0 && <span className="warn-text danger-text">⚠ Overallocated: {describe(over)}</span>}
          {over.length === 0 && stretch.length > 0 && <span className="warn-text stretch-text">Stretched: {describe(stretch)}</span>}
          {over.length === 0 && stretch.length === 0 && risk.length > 0 && (
            <span className="warn-text">At risk if pipeline work is won: {describe(risk)}</span>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!canSave} onClick={save}>
            {saveLabel.replace(/\s+/g, ' ')}
            {percent > 0 ? ` at ${percent}%` : ''}
          </button>
        </>
      }
    >
      <div className="form-row">
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
          <input type="date" value={shown.from} onChange={(e) => setDate('from', e.target.value)} />
        </label>
        <label>
          Through week of
          <input type="date" value={shown.to} onChange={(e) => setDate('to', e.target.value)} />
        </label>
        <span className="muted small form-hint">
          {perWorkstreamDates
            ? 'Each workstream uses its own dates unless you change these'
            : `${shownWeeks.length} week${shownWeeks.length === 1 ? '' : 's'}`}
        </span>
      </div>
      {noteProject && <p className="muted small form-note">{rangeNote(noteProject, weeksBetween(rangeFor(noteProject).from, rangeFor(noteProject).to))}</p>}
      <input
        type="search"
        className="search"
        placeholder={fixedProject ? 'Filter people…' : 'Filter workstreams…'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      <ul className="candidates">{list}</ul>
    </Modal>
  );
}
