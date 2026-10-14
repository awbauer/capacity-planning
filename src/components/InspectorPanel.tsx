import { useState } from 'react';
import { initials } from '../collab/format';
import { STATUS_LABELS } from '../domain/labels';
import { severity, weekClass, weekKind, type Severity } from '../domain/load';
import { BOOKING_LABELS, bookingState, fteLabel, valueRun } from '../domain/timeline';
import { isFilled, type WeekKey } from '../domain/types';
import { addWeeks, formatWeek, formatWeekRange } from '../domain/weeks';
import { usePlan, usePlanStore } from '../store/planStore';
import { isShared } from '../store/mode';
import { showComments } from '../store/sharedPlanStore';
import { useUIStore } from '../store/uiStore';
import { useCan } from '../store/useCan';
import { useDerived } from '../store/useDerived';
import { FillRoleDialog } from './FillRoleDialog';
import { RoleDialog } from './RoleDialog';

const SEVERITY_TEXT: Record<Severity, string> = {
  over: 'Over capacity (critical)',
  stretch: 'Over capacity',
  risk: 'Over capacity if pipeline work is won',
};

/** Weeks shown in the week-by-week list, from the focused week on. */
const LIST_WEEKS = 8;

/**
 * Details of the grid's focused cell: who, which role and workstream, the
 * bar it belongs to, the person's load that week and why it's flagged, and
 * the actions for the role. Opens with I, follows the focus.
 */
export function InspectorPanel() {
  const plan = usePlan();
  const d = useDerived();
  const can = useCan();
  const cell = useUIStore((s) => s.focusedCell);
  const toggleInspector = useUIStore((s) => s.toggleInspector);
  const showDetails = useUIStore((s) => s.showDetails);
  const removeAssignment = usePlanStore((s) => s.removeAssignment);
  const [dialog, setDialog] = useState<'fill' | 'role' | null>(null);
  const role = cell ? plan.assignments.find((a) => a.id === cell.roleId) : undefined;

  const close = (
    <button type="button" className="icon-btn" aria-label="Close details" title="Close (I)" onClick={() => toggleInspector(false)}>
      ×
    </button>
  );

  if (!cell || !role) {
    return (
      <aside className="side-panel inspector" aria-label="Details">
        <div className="panel-header inspector-head">
          <h2>Details</h2>
          {close}
        </div>
        <p className="muted small inspector-empty">Select a week on a person’s or role’s row to see its booking, load and issues here.</p>
      </aside>
    );
  }

  const week = cell.week;
  const project = d.projectsById.get(role.projectId);
  const person = role.resourceId ? d.resourcesById.get(role.resourceId) : undefined;
  const state = (w: WeekKey) => bookingState(weekClass(project, w), isFilled(role));
  const run = valueRun(role.weekly, week, (w) => state(w) === state(week));
  const weeks = Array.from({ length: LIST_WEEKS }, (_, i) => addWeeks(week, i));

  // The person's whole load in the focused week, across every workstream.
  const committed = person ? (d.loads.committed.get(person.id)?.get(week) ?? 0) : 0;
  const tentative = person ? (d.loads.tentative.get(person.id)?.get(week) ?? 0) : 0;
  const sev = person ? severity(committed, tentative, plan.settings) : null;
  const parts = person
    ? (d.assignmentsByResource.get(person.id) ?? [])
        .filter((a) => a.weekly[week] && d.loads.classAt(a, week) !== 'excluded')
        .map((a) => {
          const p = d.projectsById.get(a.projectId);
          return {
            id: a.id,
            name: p?.name ?? '?',
            pct: a.weekly[week],
            kind: weekKind(p, week) === 'presales' ? 'presales' : d.loads.classAt(a, week) === 'tentative' ? 'tentative' : 'delivery',
          };
        })
    : [];

  return (
    <aside className="side-panel inspector" aria-label="Details">
      <div className="panel-header inspector-head">
        <h2>Details</h2>
        {close}
      </div>
      <div className="inspector-who">
        <span className={person ? 'avatar-mini' : 'avatar-mini open'} aria-hidden="true">
          {person ? initials(person.name) : '◇'}
        </span>
        <div>
          <div className="inspector-name">
            {person ? person.name : 'Open role'}
            {(person?.level ?? role.level) && <span className="level-badge">{person?.level ?? role.level}</span>}
          </div>
          <div className="muted small">{role.name || 'Role unspecified'}</div>
        </div>
      </div>
      <dl className="inspector-facts">
        <dt>Workstream</dt>
        <dd>
          <button type="button" className="link" onClick={() => project && showDetails({ kind: 'project', id: project.id })}>
            {project?.name ?? '?'}
          </button>
          {project?.client && <span className="muted"> · {project.client}</span>}
        </dd>
        <dt>Stage</dt>
        <dd>{project && <span className={`stage-pill status-${project.status}`}>{STATUS_LABELS[project.status]}</span>}</dd>
        <dt>Week of</dt>
        <dd>{formatWeek(week)}</dd>
        <dt>Booking</dt>
        <dd>
          {run ? (
            <>
              <span className={`swatch swatch-${state(week) === 'open' ? 'open' : state(week) === 'tentative' ? 'tentative' : 'confirmed'}`} />{' '}
              {BOOKING_LABELS[state(week)]}
              {weekKind(project, week) === 'presales' && ' (presales)'}, {fteLabel(run.value)}
            </>
          ) : (
            <span className="muted">Nothing booked this week</span>
          )}
        </dd>
        {run && (
          <>
            <dt>This bar</dt>
            <dd>{formatWeekRange(run.from, run.to)}</dd>
          </>
        )}
      </dl>

      {person && (
        <section className="inspector-section">
          <h3>
            {person.name}’s week: {committed}% committed{tentative ? ` + ${tentative}% pipeline` : ''}
          </h3>
          {sev ? (
            <p className={sev === 'risk' ? 'inspector-issue risk' : 'inspector-issue'}>⚠ {SEVERITY_TEXT[sev]}</p>
          ) : (
            <p className="muted small">Within capacity.</p>
          )}
          <ul className="inspector-parts">
            {parts.map((p) => (
              <li key={p.id} className={p.id === role.id ? 'current' : undefined}>
                <span>{p.name}</span>
                <span className="muted small">{p.kind}</span>
                <strong>{p.pct}%</strong>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="inspector-section">
        <h3>Next {LIST_WEEKS} weeks on this row</h3>
        <ol className="inspector-weeks">
          {weeks.map((w) => (
            <li key={w}>
              <span className="muted small">{formatWeek(w).replace(/, \d{4}$/, '')}</span>
              <span className="mini-track" aria-hidden="true">
                <span className={`mini-fill bar-${role.weekly[w] ? state(w) : 'none'}`} style={{ width: `${Math.min(100, role.weekly[w] ?? 0)}%` }} />
              </span>
              <strong>{role.weekly[w] ? `${role.weekly[w]}%` : '–'}</strong>
            </li>
          ))}
        </ol>
      </section>

      <div className="inspector-actions">
        {can.edit && (
          <button type="button" className="btn btn-small" onClick={() => setDialog('fill')}>
            {person ? 'Change person…' : 'Fill role…'}
          </button>
        )}
        {can.edit && (
          <button type="button" className="btn btn-small" onClick={() => setDialog('role')}>
            Edit role…
          </button>
        )}
        {isShared() && (
          <button
            type="button"
            className="btn btn-small"
            onClick={() => {
              toggleInspector(false);
              showComments({ anchor: { kind: 'role', roleId: role.id } });
            }}
          >
            Comment…
          </button>
        )}
        {can.edit && (
          <button
            type="button"
            className="btn btn-small btn-danger"
            onClick={() => {
              const n = Object.keys(role.weekly).length;
              if (n === 0 || window.confirm(`Remove the ${role.name || 'unnamed'} role${person ? ` and take ${person.name} off ${project?.name}` : ''}? This clears ${n} week(s) of allocation (undo with Ctrl+Z).`)) {
                removeAssignment(role.id);
              }
            }}
          >
            Remove role
          </button>
        )}
      </div>
      {dialog === 'fill' && <FillRoleDialog role={role} onClose={() => setDialog(null)} />}
      {dialog === 'role' && <RoleDialog role={role} onClose={() => setDialog(null)} />}
    </aside>
  );
}
