import { useMemo } from 'react';
import { demandSummary, type RoleSummary, type WorkstreamDemand } from '../domain/summary';
import { LOOKAHEAD_WEEKS, lookaheadWeeks } from '../domain/utilization';
import { currentWeek, formatWeek, formatWeekRange, weeksApart } from '../domain/weeks';
import { usePlan } from '../store/planStore';
import { useUIStore } from '../store/uiStore';
import { useDerived } from '../store/useDerived';

const fte = (n: number) => n.toFixed(1);

/**
 * What's being pursued vs sold, from this week on: per workstream, who's
 * supporting the pursuit (presales roles), who's staffed for delivery, and
 * which roles are still open.
 */
export function DemandView() {
  const plan = usePlan();
  const d = useDerived();
  const showDetails = useUIStore((s) => s.showDetails);
  const thisWeek = currentWeek();
  const window = useMemo(() => lookaheadWeeks(thisWeek), [thisWeek]);
  const summary = useMemo(() => demandSummary(plan, d, thisWeek, window), [plan, d, thisWeek, window]);

  const person = (id: string | null) => (id ? d.resourcesById.get(id) : undefined);

  /** "Role › Person" chips for filled roles, or "Role" chips for open ones. */
  const chips = (roles: RoleSummary[], open = false) =>
    roles.length === 0 ? (
      <span className="muted">—</span>
    ) : (
      <span className="role-chips">
        {roles.map((r) => {
          const p = person(r.role.resourceId);
          const title = `${r.role.name || 'Unnamed role'}${p ? ` › ${p.name}` : ' (open)'}${
            r.first && r.last ? ` · ${formatWeekRange(r.first, r.last)}` : ''
          }${r.avg ? ` · ${Math.round(r.avg)}% avg next ${LOOKAHEAD_WEEKS} weeks` : ''}`;
          return (
            <button
              key={r.role.id}
              type="button"
              className={open ? 'role-chip open' : 'role-chip'}
              title={title}
              onClick={() =>
                p ? showDetails({ kind: 'resource', id: p.id }) : showDetails({ kind: 'project', id: r.role.projectId })
              }
            >
              {p ? (
                <>
                  <span className="role-chip-person">{p.name}</span>
                  {r.role.name && <span className="role-chip-role">{r.role.name}</span>}
                </>
              ) : (
                <>
                  <span className="role-chip-person">{r.role.name || 'Unnamed role'}</span>
                  {r.role.level && <span className="role-chip-role">{r.role.level}</span>}
                </>
              )}
            </button>
          );
        })}
      </span>
    );

  const section = (title: string, rows: WorkstreamDemand[], note: string) => {
    const filled = rows.reduce((n, r) => n + r.filledFte, 0);
    const open = rows.reduce((n, r) => n + r.openFte, 0);
    const openRoles = rows.reduce((n, r) => n + r.open.length, 0);
    const people = new Set(rows.flatMap((r) => [...r.supporting, ...r.staffed].map((s) => s.role.resourceId)));
    return (
      <section className="demand-section">
        <header className="demand-header">
          <h2>
            {title} <span className="count">{rows.length}</span>
          </h2>
          <span className="muted small">{note}</span>
        </header>
        <div className="stats">
          <div className="stat">
            <span className="stat-value">{fte(filled + open)}</span>
            <span className="stat-label">FTE demand</span>
          </div>
          <div className="stat stat-good">
            <span className="stat-value">{fte(filled)}</span>
            <span className="stat-label">Staffed FTE</span>
          </div>
          <div className={open ? 'stat stat-warn' : 'stat'}>
            <span className="stat-value">{fte(open)}</span>
            <span className="stat-label">
              Open FTE · {openRoles} {openRoles === 1 ? 'role' : 'roles'}
            </span>
          </div>
          <div className="stat">
            <span className="stat-value">{people.size}</span>
            <span className="stat-label">People involved</span>
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="muted">Nothing here.</p>
        ) : (
          <table className="table demand-table">
            <thead>
              <tr>
                <th>Workstream</th>
                <th>Dates</th>
                <th title="People in roles with presales weeks from now on">Supporting (presales)</th>
                <th title="People in roles with delivery weeks from now on">Staffed (delivery)</th>
                <th>Open roles</th>
                <th className="num" title={`Average FTE over the next ${LOOKAHEAD_WEEKS} weeks: staffed + open`}>
                  FTE
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const p = r.project;
                const seller = p.sellerId ? d.sellersById.get(p.sellerId) : undefined;
                return (
                  <tr key={p.id}>
                    <td>
                      <button type="button" className="link strong" onClick={() => showDetails({ kind: 'project', id: p.id })}>
                        {p.name}
                      </button>
                      <div className="muted small">
                        {[p.client, seller ? `Seller: ${seller.name}` : 'No seller'].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td className="nowrap small">
                      {p.startWeek && p.endWeek ? formatWeekRange(p.startWeek, p.endWeek) : p.startWeek ? `From ${formatWeek(p.startWeek)}` : '—'}
                      {p.startWeek && p.startWeek > thisWeek && <div className="muted">starts in {weeksApart(thisWeek, p.startWeek)} wk</div>}
                    </td>
                    <td>{chips(r.supporting)}</td>
                    <td>{chips(r.staffed)}</td>
                    <td>{chips(r.open, true)}</td>
                    <td className="num nowrap">
                      {fte(r.filledFte)}
                      {r.openFte > 0 && <span className="open-fte"> +{fte(r.openFte)}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    );
  };

  return (
    <div className="demand">
      <p className="muted small demand-intro">
        Live workstreams from this week on. <strong>Supporting</strong> = people with presales time;{' '}
        <strong>staffed</strong> = people in delivery roles; FTE is averaged over the next {LOOKAHEAD_WEEKS} weeks (
        {formatWeekRange(window[0], window[window.length - 1])}). Click a workstream or person for details.
      </p>
      {section('Pipeline', summary.pipeline, 'Not won yet: presales is real effort, delivery is tentative.')}
      {section('Won', summary.won, 'Sold work.')}
      {summary.ended > 0 && (
        <p className="muted small">
          {summary.ended} ended workstream{summary.ended === 1 ? '' : 's'} with nothing from this week on not shown. Lost
          workstreams are left out.
        </p>
      )}
    </div>
  );
}
