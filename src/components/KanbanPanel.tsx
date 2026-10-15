import { useEffect, useMemo, useState } from 'react';
import { initials } from '../collab/format';
import { RowComments } from '../collab/RowComments';
import { teamLoad, workstreamIssues, workstreamStats, type RoleStanding, type TeamWeek } from '../domain/kanban';
import { LIKELY_WIN, weekKind } from '../domain/load';

const fte1 = (pct: number) => (pct / 100).toFixed(1);
import { isFilled, WIN_PROBABILITIES, type Assignment, type Project, type WinProbability } from '../domain/types';
import { lookaheadWeeks, LOOKAHEAD_WEEKS } from '../domain/utilization';
import { currentWeek, formatWeek, formatWeekRange } from '../domain/weeks';
import { usePlan, usePlanStore } from '../store/planStore';
import { useUIStore } from '../store/uiStore';
import { useCan } from '../store/useCan';
import { useDerived } from '../store/useDerived';
import { AddAssignmentDialog } from './AddAssignmentDialog';
import { FillRoleDialog } from './FillRoleDialog';
import { RoleDialog } from './RoleDialog';
import { StatusSelect } from './StatusControls';
import { WorkstreamMenu } from './WorkstreamMenu';

type Tab = 'overview' | 'resourcing';

const STANDING: Record<RoleStanding, { label: string; cls: string } | null> = {
  conflict: { label: 'Conflict', cls: 'st-conflict' },
  risk: { label: 'At risk', cls: 'st-risk' },
  'low-risk': { label: 'Low risk', cls: 'st-risk low' },
  ok: null,
};

/** The selected Kanban card: size, staffing, team and their load, with the workstream's actions. */
export function KanbanPanel({ projectId }: { projectId: string }) {
  const d = useDerived();
  const p = d.projectsById.get(projectId);
  const select = useUIStore((s) => s.selectKanban);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.modal, .popover')) select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [select]);
  return p ? <Panel key={p.id} p={p} /> : null;
}

function Panel({ p }: { p: Project }) {
  const plan = usePlan();
  const d = useDerived();
  const can = useCan();
  const select = useUIStore((s) => s.selectKanban);
  const updateProject = usePlanStore((s) => s.updateProject);
  const [tab, setTab] = useState<Tab>('overview');
  const thisWeek = currentWeek();
  const roles = useMemo(() => d.assignmentsByProject.get(p.id) ?? [], [d, p.id]);
  const stats = useMemo(() => workstreamStats(p, roles), [p, roles]);
  const issues = useMemo(() => workstreamIssues(roles, d.loads, plan.settings, thisWeek), [roles, d.loads, plan.settings, thisWeek]);
  const tags = p.tagIds.map((t) => d.tagsById.get(t)?.name).filter(Boolean) as string[];
  const pct = stats.demand ? Math.round((100 * stats.staffed) / stats.demand) : 0;
  const people = [...new Set(roles.filter(isFilled).map((a) => a.resourceId))];

  return (
    <aside className="side-panel kanban-panel" aria-label={`${p.name} details`}>
      <header className="kp-head">
        <div className="kp-title">
          <h2>{p.name}</h2>
          <div className="muted">{[p.client, tags[0]].filter(Boolean).join(' · ') || 'No client'}</div>
        </div>
        <RowComments kind="project" id={p.id} name={p.name} />
        <WorkstreamMenu project={p} className="icon-btn" />
        <button type="button" className="icon-btn" aria-label="Close details" title="Close (Esc)" onClick={() => select(null)}>
          ×
        </button>
      </header>
      <nav className="kp-tabs" role="tablist" aria-label="Workstream details">
        {(['overview', 'resourcing'] as Tab[]).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t === 'overview' ? 'Overview' : 'Resourcing'}
          </button>
        ))}
      </nav>

      {tab === 'overview' ? (
        <div className="kp-body">
          <div className="kp-pills">
            <StatusSelect compact disabled={!can.edit} value={p.status} onChange={(status) => updateProject(p.id, { status })} />
            {p.status === 'pipeline' && (
              <select
                className={p.winProbability ? 'win-select' : 'win-select unset'}
                aria-label={`Win probability for ${p.name}`}
                title={`Chance of winning it; under ${LIKELY_WIN}%, the risk it puts on people is a low risk`}
                disabled={!can.edit}
                value={p.winProbability ?? ''}
                onChange={(e) =>
                  updateProject(p.id, { winProbability: e.target.value ? (Number(e.target.value) as WinProbability) : undefined })
                }
              >
                <option value="">–%</option>
                {WIN_PROBABILITIES.map((n) => (
                  <option key={n} value={n}>
                    {n}%
                  </option>
                ))}
              </select>
            )}
            <select
              className="kp-seller"
              aria-label={`Seller for ${p.name}`}
              disabled={!can.edit}
              value={p.sellerId ?? ''}
              onChange={(e) => updateProject(p.id, { sellerId: e.target.value || null })}
            >
              <option value="">No seller</option>
              {[...plan.sellers]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </div>

          <dl className="kp-facts">
            <div>
              <dt>
                {fte1(stats.staffed)} / {fte1(stats.demand)} FTE
              </dt>
              <dd>{stats.demand ? `${pct}% staffed` : 'No demand yet'}</dd>
            </div>
            <div>
              <dt>{stats.weeks.length ? `${stats.weeks.length} ${stats.weeks.length === 1 ? 'week' : 'weeks'}` : '–'}</dt>
              <dd>{stats.weeks.length ? formatWeekRange(stats.weeks[0], stats.weeks.at(-1)!).replace(/, \d{4}$/, '') : 'No delivery weeks'}</dd>
            </div>
            <div>
              <dt>{p.client || '–'}</dt>
              <dd>Client</dd>
            </div>
            <div>
              <dt title={tags.join(', ')}>{tags.length ? tags[0] + (tags.length > 1 ? ` +${tags.length - 1}` : '') : '–'}</dt>
              <dd>{tags.length > 1 ? 'Capabilities' : 'Capability'}</dd>
            </div>
          </dl>

          <section className="kp-section">
            <h3>Resourcing</h3>
            <ResourcingBar confirmed={stats.confirmed} tentative={stats.tentative} unfilled={stats.unfilled} lost={p.status === 'lost' ? stats.staffed : 0} />
          </section>

          <section className="kp-section">
            <div className="kp-section-head">
              <h3>
                Team <span className="muted">({roles.length})</span>
              </h3>
              <button type="button" className="btn btn-small" onClick={() => setTab('resourcing')}>
                Manage
              </button>
            </div>
            <TeamTable p={p} roles={roles} standing={issues.standing} />
          </section>

          <section className="kp-section">
            <h3>
              Utilization <span className="muted">(next {LOOKAHEAD_WEEKS} weeks)</span>
            </h3>
            {people.length ? (
              <UtilizationChart
                data={teamLoad(people, lookaheadWeeks(thisWeek), d.loads, plan.settings.overallocationThreshold)}
                names={(id) => d.resourcesById.get(id)?.name ?? '?'}
                team={people.length}
              />
            ) : (
              <p className="muted small">Nobody is on this workstream yet.</p>
            )}
          </section>

          {p.notes?.trim() && (
            <section className="kp-section">
              <h3>Opportunity details</h3>
              <p className="kp-notes">{p.notes}</p>
            </section>
          )}
        </div>
      ) : (
        <div className="kp-body">
          <ResourcingTab p={p} roles={roles} standing={issues.standing} />
        </div>
      )}
    </aside>
  );
}

function ResourcingBar({ confirmed, tentative, unfilled, lost }: { confirmed: number; tentative: number; unfilled: number; lost: number }) {
  const demand = confirmed + tentative + unfilled + lost;
  const w = (v: number) => `${(100 * v) / (demand || 1)}%`;
  const rows = [
    { key: 'confirmed', label: 'Confirmed', v: confirmed, title: 'Filled roles on a won workstream' },
    { key: 'tentative', label: 'Tentative', v: tentative, title: 'Filled roles while it is in the pipeline: they count only if it is won' },
    { key: 'unfilled', label: 'Unfilled', v: unfilled, title: 'Open roles' },
    ...(lost ? [{ key: 'lost', label: 'Lost', v: lost, title: 'Filled roles on a lost workstream (not anyone’s load)' }] : []),
  ];
  return (
    <div className="kp-resourcing">
      <div>
        <div className="kp-bar" aria-hidden>
          {rows.map((r) => r.v > 0 && <span key={r.key} className={`seg-${r.key}`} style={{ width: w(r.v) }} />)}
        </div>
        <div className="kp-bar-caption">
          <strong>
            {fte1(demand - unfilled)} / {fte1(demand)} FTE
          </strong>
          <span className="muted small">average over its delivery weeks</span>
        </div>
      </div>
      <ul className="kp-legend">
        {rows.map((r) => (
          <li key={r.key} title={r.title}>
            <i className={`key seg-${r.key}`} aria-hidden />
            <span>{r.label}</span>
            <strong>{fte1(r.v)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A role's average % over the weeks it's booked, and whether those are presales only. */
function roleSummary(p: Project, a: Assignment) {
  const weeks = Object.keys(a.weekly)
    .filter((w) => a.weekly[w] > 0)
    .sort();
  const avg = weeks.length ? weeks.reduce((n, w) => n + a.weekly[w], 0) / weeks.length : 0;
  return { weeks, avg, presalesOnly: weeks.length > 0 && weeks.every((w) => weekKind(p, w) === 'presales') };
}

function statusOf(p: Project, a: Assignment, standing: RoleStanding | undefined, presalesOnly: boolean) {
  if (!isFilled(a)) return { label: 'Open', cls: 'st-open' };
  const issue = standing && STANDING[standing];
  if (issue) return issue;
  if (p.status === 'lost') return { label: 'Lost', cls: 'st-lost' };
  if (presalesOnly) return { label: 'Presales', cls: 'st-presales' };
  return p.status === 'won' ? { label: 'Confirmed', cls: 'st-confirmed' } : { label: 'Tentative', cls: 'st-tentative' };
}

function sortRoles(roles: Assignment[], name: (a: Assignment) => string) {
  return [...roles].sort((a, b) => Number(!isFilled(a)) - Number(!isFilled(b)) || name(a).localeCompare(name(b)));
}

function TeamTable({ p, roles, standing }: { p: Project; roles: Assignment[]; standing: Map<string, RoleStanding> }) {
  const d = useDerived();
  const can = useCan();
  const [adding, setAdding] = useState(false);
  const name = (a: Assignment) => (a.resourceId ? (d.resourcesById.get(a.resourceId)?.name ?? '?') : '');
  return (
    <>
      <table className="kp-team">
        <thead>
          <tr>
            <th>Person</th>
            <th>Role</th>
            <th>Allocation</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {sortRoles(roles, name).map((a) => {
            const r = a.resourceId ? d.resourcesById.get(a.resourceId) : undefined;
            const s = roleSummary(p, a);
            const st = statusOf(p, a, standing.get(a.id), s.presalesOnly);
            return (
              <tr key={a.id}>
                <td>
                  <span className={r ? 'avatar-mini' : 'avatar-mini open'} aria-hidden>
                    {r ? initials(r.name) : '◇'}
                  </span>{' '}
                  {r ? r.name : <em className="muted">Open role</em>}
                </td>
                <td className="muted">{a.name || r?.role || '–'}</td>
                <td title={s.weeks.length ? `${s.weeks.length} week(s), ${formatWeek(s.weeks[0])} – ${formatWeek(s.weeks.at(-1)!)}` : undefined}>
                  {s.weeks.length ? `${Math.round(s.avg)}%` : '–'}
                  {s.weeks.length > 0 && <span className="muted"> ({s.weeks.length} wk)</span>}
                </td>
                <td>
                  <span className={`kp-status ${st.cls}`}>{st.label}</span>
                </td>
              </tr>
            );
          })}
          {roles.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                Nobody on it yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {can.edit && (
        <button type="button" className="link kp-add" onClick={() => setAdding(true)}>
          + Add person
        </button>
      )}
      {adding && <AddAssignmentDialog projectId={p.id} onClose={() => setAdding(false)} />}
    </>
  );
}

function ResourcingTab({ p, roles, standing }: { p: Project; roles: Assignment[]; standing: Map<string, RoleStanding> }) {
  const d = useDerived();
  const can = useCan();
  const removeAssignment = usePlanStore((s) => s.removeAssignment);
  const [dialog, setDialog] = useState<{ fill: Assignment } | { role: Assignment } | 'person' | 'open' | null>(null);
  const name = (a: Assignment) => (a.resourceId ? (d.resourcesById.get(a.resourceId)?.name ?? '?') : '');
  return (
    <>
      <ul className="kp-roles">
        {sortRoles(roles, name).map((a) => {
          const r = a.resourceId ? d.resourcesById.get(a.resourceId) : undefined;
          const s = roleSummary(p, a);
          const st = statusOf(p, a, standing.get(a.id), s.presalesOnly);
          const label = a.name || 'Unnamed role';
          return (
            <li key={a.id}>
              <span className={r ? 'avatar-mini' : 'avatar-mini open'} aria-hidden>
                {r ? initials(r.name) : '◇'}
              </span>
              <div className="kp-role-main">
                <div>
                  <strong>{r ? r.name : label}</strong>
                  {(r?.level ?? a.level) && <span className="level-badge">{r?.level ?? a.level}</span>}{' '}
                  <span className={`kp-status ${st.cls}`}>{st.label}</span>
                </div>
                <div className="muted small">
                  {r ? label : 'Open role'}
                  {s.weeks.length > 0 && ` · ${Math.round(s.avg)}% · ${formatWeekRange(s.weeks[0], s.weeks.at(-1)!)}`}
                </div>
              </div>
              {can.edit && (
                <span className="kp-role-actions">
                  <button type="button" className="btn btn-small" onClick={() => setDialog({ fill: a })}>
                    {r ? 'Change…' : 'Fill…'}
                  </button>
                  <button type="button" className="btn btn-small" aria-label={`Edit role ${label}`} onClick={() => setDialog({ role: a })}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove role ${label}${r ? ` (${r.name})` : ''}`}
                    title="Remove role"
                    onClick={() => {
                      const n = Object.keys(a.weekly).length;
                      if (n === 0 || window.confirm(`Remove the ${label} role${r ? ` and take ${r.name} off ${p.name}` : ''}? This clears ${n} week(s) of allocation (undo with Ctrl+Z).`)) {
                        removeAssignment(a.id);
                      }
                    }}
                  >
                    ×
                  </button>
                </span>
              )}
            </li>
          );
        })}
        {roles.length === 0 && <li className="muted">No roles yet.</li>}
      </ul>
      {can.edit && (
        <div className="kp-role-add">
          <button type="button" className="btn btn-small" onClick={() => setDialog('person')}>
            + Add person
          </button>
          <button type="button" className="btn btn-small" onClick={() => setDialog('open')}>
            + Add open role
          </button>
        </div>
      )}
      {dialog === 'person' && <AddAssignmentDialog projectId={p.id} onClose={() => setDialog(null)} />}
      {dialog === 'open' && <RoleDialog projectId={p.id} onClose={() => setDialog(null)} />}
      {dialog && typeof dialog === 'object' && 'fill' in dialog && <FillRoleDialog role={dialog.fill} onClose={() => setDialog(null)} />}
      {dialog && typeof dialog === 'object' && 'role' in dialog && <RoleDialog role={dialog.role} onClose={() => setDialog(null)} />}
    </>
  );
}

const CHART = { w: 400, h: 150, left: 34, right: 6, top: 8, bottom: 22 };

/**
 * The team's average load per week, committed (solid) and pipeline (hatched)
 * stacked. An average hides one person at 150%, so a week where anyone is over
 * capacity on committed work is drawn red and named in its tooltip.
 */
function UtilizationChart({ data, names, team }: { data: TeamWeek[]; names: (id: string) => string; team: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const top = Math.max(150, Math.ceil(Math.max(...data.map((x) => x.committed + x.pipeline)) / 50) * 50);
  const plotW = CHART.w - CHART.left - CHART.right;
  const plotH = CHART.h - CHART.top - CHART.bottom;
  const y = (v: number) => CHART.top + plotH - (plotH * v) / top;
  const slot = plotW / data.length;
  const barW = Math.min(26, slot - 8);
  const avg = data.reduce((n, x) => n + x.committed + x.pipeline, 0) / data.length;
  const ticks = Array.from({ length: top / 50 + 1 }, (_, i) => i * 50);
  const short = (w: string) => formatWeek(w).replace(/, \d{4}$/, '');
  const h = hover === null ? null : data[hover];
  return (
    <div className="kp-chart">
      <svg
        viewBox={`0 0 ${CHART.w} ${CHART.h}`}
        role="img"
        aria-label={`Average load of the ${team} people on this workstream across all their work, next ${data.length} weeks; team average ${Math.round(avg)}%`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <pattern id="kp-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" className="hatch-bg" />
            <line x1="0" y1="0" x2="0" y2="5" className="hatch-line" />
          </pattern>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={CHART.left} x2={CHART.w - CHART.right} y1={y(t)} y2={y(t)} className={t === 100 ? 'grid cap' : 'grid'} />
            <text x={CHART.left - 6} y={y(t) + 3} className="tick" textAnchor="end">
              {t}%
            </text>
          </g>
        ))}
        {data.map((x, i) => {
          const cx = CHART.left + slot * i + slot / 2;
          const c = Math.max(0, y(0) - y(x.committed));
          const pl = Math.max(0, y(0) - y(x.pipeline));
          const gap = c > 0 && pl > 0 ? 2 : 0;
          return (
            <g key={x.week} className={hover === i ? 'bar hover' : 'bar'} onMouseEnter={() => setHover(i)}>
              <rect x={cx - slot / 2} y={CHART.top} width={slot} height={plotH} className="hit" />
              {c > 0 && <rect x={cx - barW / 2} y={y(0) - c} width={barW} height={c} rx={pl ? 0 : 3} className={x.over.length ? 'committed over' : 'committed'} />}
              {pl > 0 && <rect x={cx - barW / 2} y={y(0) - c - gap - pl} width={barW} height={pl} rx={3} className="pipeline" fill="url(#kp-hatch)" />}
              {i % 2 === 0 && (
                <text x={cx} y={CHART.h - 6} className="tick" textAnchor="middle">
                  {short(x.week)}
                </text>
              )}
            </g>
          );
        })}
        <line x1={CHART.left} x2={CHART.w - CHART.right} y1={y(avg)} y2={y(avg)} className="avg" />
      </svg>
      {h && (
        <div className="kp-tip" style={{ left: `${((CHART.left + slot * hover! + slot / 2) / CHART.w) * 100}%` }} role="status">
          <strong>Week of {short(h.week)}</strong>
          <div>
            <i className="key seg-confirmed" /> Committed {Math.round(h.committed)}%
          </div>
          <div>
            <i className="key seg-tentative" /> Pipeline {Math.round(h.pipeline)}%
          </div>
          {h.over.length > 0 && <div className="kp-tip-over">⚠ Over capacity: {h.over.map(names).join(', ')}</div>}
        </div>
      )}
      <ul className="kp-legend inline">
        <li>
          <i className="key seg-confirmed" /> Committed
        </li>
        <li>
          <i className="key seg-tentative" /> Pipeline
        </li>
        <li>
          <i className="key seg-over" /> Someone over
        </li>
        <li>
          <i className="key avg-key" /> Team average ({Math.round(avg)}%)
        </li>
      </ul>
      <table className="sr-only">
        <caption>Team load by week</caption>
        <thead>
          <tr>
            <th>Week</th>
            <th>Committed</th>
            <th>Pipeline</th>
            <th>Over capacity</th>
          </tr>
        </thead>
        <tbody>
          {data.map((x) => (
            <tr key={x.week}>
              <td>{short(x.week)}</td>
              <td>{Math.round(x.committed)}%</td>
              <td>{Math.round(x.pipeline)}%</td>
              <td>{x.over.map(names).join(', ') || 'Nobody'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
