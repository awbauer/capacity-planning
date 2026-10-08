import { useState } from 'react';
import { severity, weekClass, worse, type Severity } from '../domain/load';
import { requiredTags } from '../domain/conflicts';
import { CAREER_LEVELS, type Assignment, type CareerLevel } from '../domain/types';
import { formatWeekRange } from '../domain/weeks';
import { usePlan, usePlanStore } from '../store/planStore';
import { useDerived } from '../store/useDerived';
import { TagChips } from './Chips';
import { Modal } from './Modal';

/**
 * Picks the person for a role: fills an open role, or swaps / frees the
 * person in a filled one. Candidates are ranked by matching capabilities,
 * then closeness to the role's level, then free capacity over the role's weeks.
 */
export function FillRoleDialog({ role, onClose }: { role: Assignment; onClose: () => void }) {
  const plan = usePlan();
  const d = useDerived();
  const assignRole = usePlanStore((s) => s.assignRole);
  const current = role.resourceId ? d.resourcesById.get(role.resourceId) : undefined;
  const [picked, setPicked] = useState<string | null>(role.resourceId);
  const [query, setQuery] = useState('');

  const project = d.projectsById.get(role.projectId);
  const weeks = Object.keys(role.weekly).filter((w) => role.weekly[w] > 0).sort();
  const need = new Set(project ? requiredTags(role, project) : role.tagIds);
  const onProject = new Set((d.assignmentsByProject.get(role.projectId) ?? []).map((a) => a.resourceId));

  /** Peak load (committed + pipeline) over the role's weeks, now and with the role added, and the worst flag. */
  const simulate = (rid: string) => {
    const committed = d.loads.committed.get(rid);
    const tentative = d.loads.tentative.get(rid);
    let now = 0;
    let after = 0;
    let worst: Severity | null = null;
    for (const w of weeks) {
      let c = committed?.get(w) ?? 0;
      let t = tentative?.get(w) ?? 0;
      now = Math.max(now, c + t);
      const cls = weekClass(project, w);
      // The person already in the role carries its weeks today.
      const delta = rid === role.resourceId ? 0 : role.weekly[w];
      if (cls === 'committed') c += delta;
      else if (cls === 'tentative') t += delta;
      after = Math.max(after, c + t);
      worst = worse(worst, severity(c, t, plan.settings));
    }
    return { now, after, worst };
  };
  const levelDistance = (level: CareerLevel | undefined) =>
    !role.level ? 0 : !level ? CAREER_LEVELS.length : Math.abs(CAREER_LEVELS.indexOf(role.level) - CAREER_LEVELS.indexOf(level));

  const q = query.trim().toLowerCase();
  const candidates = plan.resources
    .filter((r) => !q || r.name.toLowerCase().includes(q) || (r.role ?? '').toLowerCase().includes(q))
    .map((r) => ({
      r,
      matches: r.tagIds.filter((t) => need.has(t)).length,
      distance: levelDistance(r.level),
      ...simulate(r.id),
    }))
    .sort(
      (a, b) =>
        b.matches - a.matches || a.distance - b.distance || a.now - b.now || a.r.name.localeCompare(b.r.name),
    );
  const chosen = candidates.find((c) => c.r.id === picked);
  const roleLabel = role.name || 'this role';
  const changed = picked !== role.resourceId;

  return (
    <Modal
      title={`${current ? 'Who’s in' : 'Fill'} ${roleLabel}${project ? ` on ${project.name}` : ''}`}
      onClose={onClose}
      wide
      footer={
        <>
          {current && (
            <button
              type="button"
              className="btn"
              title="Keep the role and its weeks as open demand"
              onClick={() => {
                assignRole(role.id, null);
                onClose();
              }}
            >
              Leave open
            </button>
          )}
          <span className="spacer" />
          {changed && chosen?.worst === 'over' && <span className="warn-text danger-text">⚠ {chosen.r.name} would be at {chosen.after}%</span>}
          {changed && chosen?.worst === 'stretch' && <span className="warn-text stretch-text">{chosen.r.name} would be stretched ({chosen.after}%)</span>}
          {changed && chosen?.worst === 'risk' && <span className="warn-text">At risk if pipeline work is won ({chosen.after}%)</span>}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!picked || !changed}
            onClick={() => {
              if (!picked) return;
              assignRole(role.id, picked);
              onClose();
            }}
          >
            {chosen && changed ? `${current ? 'Move to' : 'Fill with'} ${chosen.r.name}` : current ? 'Choose someone else' : 'Fill'}
          </button>
        </>
      }
    >
      <p className="muted small form-note">
        {weeks.length ? `${weeks.length} weeks, ${formatWeekRange(weeks[0], weeks[weeks.length - 1])}. ` : 'No weeks allocated yet. '}
        {current
          ? `${current.name} is in this role. Pick someone else to hand it over with all its weeks, or leave it open.`
          : 'The person takes the role with all its weeks.'}{' '}
        Undo with Ctrl+Z.
      </p>
      <input
        type="search"
        className="search"
        placeholder="Filter people…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      <ul className="candidates">
        {candidates.map(({ r, matches, now, after, worst }) => (
          <li key={r.id}>
            <label className={picked === r.id ? 'candidate picked' : 'candidate'}>
              <input type="radio" name="fill" checked={picked === r.id} onChange={() => setPicked(r.id)} />
              <span className="candidate-main">
                <span className="candidate-name">
                  {r.name}
                  {r.level && <span className="level-badge">{r.level}</span>}
                  {r.role && <span className="muted small"> · {r.role}</span>}
                  {r.id === role.resourceId ? (
                    <span className="badge">In this role</span>
                  ) : (
                    onProject.has(r.id) && <span className="badge">Also on this workstream</span>
                  )}
                  {need.size > 0 && matches === 0 && <span className="badge badge-warn">No matching skill</span>}
                </span>
                <TagChips tagIds={r.tagIds} tagsById={d.tagsById} highlight={need.size ? need : undefined} />
              </span>
              <span
                className={worst ? `load load-${worst}` : 'load'}
                title="Peak weekly load (committed + pipeline) over the role's weeks: now → with this role"
              >
                {now}% → {after}%
              </span>
            </label>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
