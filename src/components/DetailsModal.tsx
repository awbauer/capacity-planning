import { useMemo, useState } from 'react';
import { slug, workstreamCsv } from '../domain/csv';
import { requiredTags } from '../domain/conflicts';
import { STATUS_LABELS } from '../domain/labels';
import {
  matchingOpenRoles,
  personSummary,
  summarizeRole,
  workstreamChecks,
  type Check,
  type RoleSummary,
} from '../domain/summary';
import type { Assignment, Project, Resource } from '../domain/types';
import { LOOKAHEAD_WEEKS, lookaheadWeeks } from '../domain/utilization';
import { currentWeek, formatWeek, formatWeekRange } from '../domain/weeks';
import { usePlan, usePlanStore } from '../store/planStore';
import { clientGroupKey, levelGroupKey, useUIStore } from '../store/uiStore';
import { useDerived } from '../store/useDerived';
import { TagChips } from './Chips';
import { downloadText, today } from './download';
import { FillRoleDialog } from './FillRoleDialog';
import { Modal } from './Modal';
import { ProjectDialog } from './ProjectDialog';

const pct = (n: number) => `${Math.round(n)}%`;
const PHASE_LABELS = { presales: 'Presales', delivery: 'Delivery', both: 'Presales + delivery', none: '—' } as const;

/** Failing checks first (the warnings), then the ones that pass. */
function Checklist({ checks }: { checks: Check[] }) {
  const failed = checks.filter((c) => !c.ok);
  const passed = checks.filter((c) => c.ok);
  return (
    <section className="details-section">
      <h3>
        Checks{' '}
        <span className={failed.length ? 'count count-warn' : 'count count-ok'}>
          {failed.length ? `${failed.length} warning${failed.length === 1 ? '' : 's'}` : 'All clear'}
        </span>
      </h3>
      <ul className="checklist">
        {[...failed, ...passed].map((c) => (
          <li key={c.id} className={c.ok ? 'check ok' : 'check fail'}>
            <span className="check-icon" aria-label={c.ok ? 'Passed' : 'Warning'}>
              {c.ok ? '✓' : '⚠'}
            </span>
            <span className="check-label">{c.label}</span>
            {c.detail && <span className="check-detail">{c.detail}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stat({ value, label, title, tone }: { value: string; label: string; title?: string; tone?: 'warn' | 'good' }) {
  return (
    <div className={tone ? `stat stat-${tone}` : 'stat'} title={title}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

/** The workstream or person whose details are open, if any. */
export function DetailsModal() {
  const target = useUIStore((s) => s.details);
  const close = useUIStore((s) => s.showDetails);
  const d = useDerived();
  if (!target) return null;
  if (target.kind === 'project') {
    const project = d.projectsById.get(target.id);
    return project ? <WorkstreamDetails key={project.id} project={project} onClose={() => close(null)} /> : null;
  }
  const resource = d.resourcesById.get(target.id);
  return resource ? <PersonDetails key={resource.id} resource={resource} onClose={() => close(null)} /> : null;
}

function WorkstreamDetails({ project, onClose }: { project: Project; onClose: () => void }) {
  const plan = usePlan();
  const d = useDerived();
  const ui = useUIStore();
  const [editing, setEditing] = useState(false);
  const [filling, setFilling] = useState<Assignment | null>(null);
  const thisWeek = currentWeek();
  const window = useMemo(() => lookaheadWeeks(thisWeek), [thisWeek]);

  if (editing) return <ProjectDialog project={project} onClose={() => setEditing(false)} />;
  if (filling) return <FillRoleDialog role={filling} onClose={() => setFilling(null)} />;

  const checks = workstreamChecks(plan, d, project, thisWeek, window);
  const roles = (d.assignmentsByProject.get(project.id) ?? []).map((a) => summarizeRole(a, project, thisWeek, window));
  const filled = roles.filter((r) => r.role.resourceId !== null);
  const open = roles.filter((r) => r.role.resourceId === null);
  const fte = (list: RoleSummary[]) => list.reduce((n, r) => n + r.avg, 0) / 100;
  const seller = project.sellerId ? d.sellersById.get(project.sellerId) : undefined;
  const stage = !project.startWeek
    ? 'No start date'
    : thisWeek < project.startWeek
      ? `Presales until ${formatWeek(project.startWeek)}`
      : project.endWeek && thisWeek > project.endWeek
        ? 'Ended'
        : 'In delivery';
  const person = (id: string | null) => (id ? d.resourcesById.get(id) : undefined);

  const roleRows = (list: RoleSummary[], kind: 'filled' | 'open') =>
    list.length === 0 ? (
      <p className="muted small">{kind === 'filled' ? 'Nobody is in a role yet.' : 'No open roles.'}</p>
    ) : (
      <table className="details-table">
        <thead>
          <tr>
            <th>Role</th>
            <th>{kind === 'filled' ? 'Person' : 'Needs'}</th>
            <th>Phase</th>
            <th>From now</th>
            <th title={`Average over the next ${LOOKAHEAD_WEEKS} weeks`}>Next {LOOKAHEAD_WEEKS}w</th>
            {kind === 'open' && <th />}
          </tr>
        </thead>
        <tbody>
          {[...list]
            .sort((a, b) => (a.first ?? '9999').localeCompare(b.first ?? '9999') || a.role.name.localeCompare(b.role.name))
            .map((r) => {
              const p = person(r.role.resourceId);
              return (
                <tr key={r.role.id} className={r.phase === 'none' ? 'past' : undefined}>
                  <td>
                    {r.role.name || <em className="muted">Unnamed role</em>}
                    {r.role.level && <span className="level-badge">{r.role.level}</span>}
                    {d.mismatchedAssignmentIds.has(r.role.id) && <span className="badge badge-warn">Skill mismatch</span>}
                  </td>
                  <td>
                    {p ? (
                      <button type="button" className="link" onClick={() => ui.showDetails({ kind: 'resource', id: p.id })}>
                        {p.name}
                      </button>
                    ) : (
                      <TagChips tagIds={requiredTags(r.role, project)} tagsById={d.tagsById} />
                    )}
                  </td>
                  <td>{PHASE_LABELS[r.phase]}</td>
                  <td className="nowrap">{r.first && r.last ? formatWeekRange(r.first, r.last) : <span className="muted">Done</span>}</td>
                  <td className="num">{r.avg ? pct(r.avg) : '–'}</td>
                  {kind === 'open' && (
                    <td>
                      <button type="button" className="btn btn-small" onClick={() => setFilling(r.role)}>
                        Fill…
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
        </tbody>
      </table>
    );

  return (
    <Modal
      title={project.name}
      onClose={onClose}
      wide
      footer={
        <>
          <button
            type="button"
            className="btn"
            onClick={() => downloadText(`staffing-${slug(project.name)}-${today()}.csv`, workstreamCsv(plan, project.id), 'text/csv')}
          >
            ⤓ CSV
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              onClose();
              ui.jumpTo('projects', `p:${project.id}`, undefined, [clientGroupKey(project.client)]);
            }}
          >
            Show in grid
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setEditing(true)}>
            Edit workstream
          </button>
        </>
      }
    >
      <p className="details-subtitle">
        <span className={`status-pill status-${project.status}`}>{STATUS_LABELS[project.status]}</span>
        {project.client && <span>{project.client}</span>}
        <span>{seller ? `Seller: ${seller.name}` : 'No seller'}</span>
        <span>
          {project.startWeek && project.endWeek
            ? formatWeekRange(project.startWeek, project.endWeek)
            : project.startWeek
              ? `From ${formatWeek(project.startWeek)}`
              : 'No dates'}
        </span>
        <span className="muted">{stage}</span>
      </p>
      {project.tagIds.length > 0 && (
        <div className="details-tags">
          <span className="muted small">Needs</span> <TagChips tagIds={project.tagIds} tagsById={d.tagsById} />
        </div>
      )}
      {project.notes && <p className="details-notes">{project.notes}</p>}
      <div className="stats">
        <Stat value={`${filled.length}/${roles.length}`} label="Roles filled" tone={open.length ? 'warn' : 'good'} />
        <Stat
          value={fte(filled).toFixed(1)}
          label="Staffed FTE"
          title={`Average FTE in filled roles over the next ${LOOKAHEAD_WEEKS} weeks`}
        />
        <Stat
          value={fte(open).toFixed(1)}
          label="Open FTE"
          title={`Average FTE in open roles over the next ${LOOKAHEAD_WEEKS} weeks`}
          tone={fte(open) > 0 ? 'warn' : undefined}
        />
        <Stat value={String(new Set(filled.map((r) => r.role.resourceId)).size)} label="People" />
      </div>
      <Checklist checks={checks} />
      <section className="details-section">
        <h3>
          Filled roles <span className="count">{filled.length}</span>
        </h3>
        {roleRows(filled, 'filled')}
      </section>
      <section className="details-section">
        <h3>
          Open roles <span className={open.length ? 'count count-warn' : 'count'}>{open.length}</span>
        </h3>
        {roleRows(open, 'open')}
      </section>
    </Modal>
  );
}

function PersonDetails({ resource, onClose }: { resource: Resource; onClose: () => void }) {
  const plan = usePlan();
  const d = useDerived();
  const ui = useUIStore();
  const assignRole = usePlanStore((s) => s.assignRole);
  const thisWeek = currentWeek();
  const window = useMemo(() => lookaheadWeeks(thisWeek), [thisWeek]);

  const summary = personSummary(plan, d, resource, window);
  const roles = (d.assignmentsByResource.get(resource.id) ?? [])
    .map((a) => ({ ...summarizeRole(a, d.projectsById.get(a.projectId), thisWeek, window), project: d.projectsById.get(a.projectId) }))
    .sort((a, b) => (a.first ?? '9999').localeCompare(b.first ?? '9999'));
  const current = roles.filter((r) => r.phase !== 'none');
  const past = roles.length - current.length;
  const openRoles = matchingOpenRoles(d, resource);
  const { util, target } = summary;

  return (
    <Modal
      title={resource.name}
      onClose={onClose}
      wide
      footer={
        <>
          <button
            type="button"
            className="btn"
            onClick={() => {
              onClose();
              ui.jumpTo('resources', `r:${resource.id}`, undefined, [levelGroupKey(resource.level)]);
            }}
          >
            Show in grid
          </button>
          <span className="spacer" />
          <button
            type="button"
            className="btn"
            onClick={() => {
              onClose();
              ui.openManage('resources');
            }}
          >
            Edit in Manage
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <p className="details-subtitle">
        {resource.level && <span className="level-badge">{resource.level}</span>}
        <span>{resource.role ?? <em className="muted">No title</em>}</span>
      </p>
      {resource.tagIds.length > 0 && (
        <div className="details-tags">
          <TagChips tagIds={resource.tagIds} tagsById={d.tagsById} />
        </div>
      )}
      <div className="stats">
        <Stat
          value={pct(util.committed)}
          label={`Committed vs ${target}% target`}
          title={`Presales + won delivery, averaged over the next ${LOOKAHEAD_WEEKS} weeks (each week capped at 100%)`}
          tone={util.committed < target ? 'warn' : 'good'}
        />
        <Stat value={pct(util.delivery)} label="Delivery (won)" />
        <Stat
          value={pct(util.pipeline)}
          label="Pipeline"
          title={`${pct(util.presales)} presales + ${pct(util.pipeline - util.presales)} delivery if won`}
        />
        <Stat
          value={pct(summary.peak)}
          label="Peak week"
          title="Highest committed + pipeline load in a single week of the next 10"
          tone={summary.peak > plan.settings.overallocationThreshold ? 'warn' : undefined}
        />
      </div>
      <Checklist checks={summary.checks} />
      <section className="details-section">
        <h3>
          Roles <span className="count">{current.length}</span>
        </h3>
        {current.length === 0 ? (
          <p className="muted small">No roles from this week on.</p>
        ) : (
          <table className="details-table">
            <thead>
              <tr>
                <th>Workstream</th>
                <th>Role</th>
                <th>Phase</th>
                <th>From now</th>
                <th title={`Average over the next ${LOOKAHEAD_WEEKS} weeks`}>Next {LOOKAHEAD_WEEKS}w</th>
              </tr>
            </thead>
            <tbody>
              {current.map((r) => (
                <tr key={r.role.id}>
                  <td>
                    {r.project ? (
                      <button type="button" className="link" onClick={() => ui.showDetails({ kind: 'project', id: r.project!.id })}>
                        {r.project.name}
                      </button>
                    ) : (
                      '?'
                    )}
                    {r.project && <span className={`status-text status-${r.project.status}`}> · {STATUS_LABELS[r.project.status]}</span>}
                  </td>
                  <td>
                    {r.role.name || <em className="muted">Unnamed role</em>}
                    {d.mismatchedAssignmentIds.has(r.role.id) && <span className="badge badge-warn">Skill mismatch</span>}
                  </td>
                  <td>{PHASE_LABELS[r.phase]}</td>
                  <td className="nowrap">{r.first && r.last ? formatWeekRange(r.first, r.last) : ''}</td>
                  <td className="num">{r.avg ? pct(r.avg) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {past > 0 && <p className="muted small">{past} earlier role(s) not shown.</p>}
      </section>
      <section className="details-section">
        <h3>
          Open roles they could fill <span className="count">{openRoles.length}</span>
        </h3>
        {openRoles.length === 0 ? (
          <p className="muted small">No upcoming open roles need their capabilities.</p>
        ) : (
          <ul className="role-suggestions">
            {openRoles.map((role) => {
              const project = d.projectsById.get(role.projectId);
              const levelOff = role.level && resource.level && role.level !== resource.level;
              return (
                <li key={role.id}>
                  <span>
                    <strong>{role.name || 'Unnamed role'}</strong>
                    {role.level && <span className="level-badge">{role.level}</span>} on{' '}
                    <button type="button" className="link" onClick={() => ui.showDetails({ kind: 'project', id: role.projectId })}>
                      {project?.name ?? '?'}
                    </button>
                    {project && <span className={`status-text status-${project.status}`}> · {STATUS_LABELS[project.status]}</span>}
                    {levelOff && <span className="muted small"> · asks for {role.level}</span>}
                  </span>
                  <button
                    type="button"
                    className="btn btn-small"
                    title={`Put ${resource.name} in this role (undo with Ctrl+Z)`}
                    onClick={() => assignRole(role.id, resource.id)}
                  >
                    Fill
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </Modal>
  );
}
