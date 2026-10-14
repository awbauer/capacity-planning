import { useMemo, useState } from 'react';
import { initials } from '../collab/format';
import { capacityByPerson, capacitySummary, issueCounts, openRoleDemand, shareOf } from '../domain/capacity';
import { fte } from '../domain/timeline';
import {
  LOOKAHEAD_WEEKS,
  demandByCapability,
  lookaheadWeeks,
  utilizationByResource,
  utilizationOf,
  utilizationTarget,
} from '../domain/utilization';
import { currentWeek, formatWeek, formatWeekRange, type Bucket } from '../domain/weeks';
import { usePlan } from '../store/planStore';
import { levelGroupKey, useUIStore, workstreamGroupKeys } from '../store/uiStore';
import { useDerived } from '../store/useDerived';

const pct = (n: number) => `${Math.round(n)}%`;
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(Math.round(n))}`;
/** Person bars: 150% fills the track, so 100% sits at two thirds. */
const scale = (n: number) => `${Math.min(100, (n / 150) * 100)}%`;

type Range = 'next' | 'visible';
type Tab = 'people' | 'roles' | 'capabilities';

/**
 * Team capacity in FTE-weeks for a window (next 10 weeks, or the weeks on
 * screen): one denominator for won delivery, pipeline and headroom, then
 * people, open roles and capabilities.
 */
export function CapacityPanel({ buckets }: { buckets: Bucket[] }) {
  const plan = usePlan();
  const d = useDerived();
  const jumpTo = useUIStore((s) => s.jumpTo);
  const highlight = useUIStore((s) => s.highlightResource);
  const setHighlight = useUIStore((s) => s.setHighlightResource);
  const [range, setRange] = useState<Range>('next');
  const [tab, setTab] = useState<Tab>('people');
  const thisWeek = currentWeek();
  const weeks = useMemo(
    () => (range === 'next' ? lookaheadWeeks(thisWeek) : buckets.flatMap((b) => b.weeks)),
    [range, thisWeek, buckets],
  );

  const people = useMemo(() => capacityByPerson(plan, d.loads, d.overallocations, weeks), [plan, d, weeks]);
  const summary = capacitySummary(people, weeks.length);
  const openRoles = useMemo(() => openRoleDemand(plan, weeks), [plan, weeks]);
  const issues = issueCounts(d.overallocations, openRoles, weeks);
  const util = useMemo(() => utilizationByResource(plan, d.loads, weeks), [plan, d.loads, weeks]);
  const capabilities = useMemo(() => demandByCapability(plan, d.loads, weeks), [plan, d.loads, weeks]);

  const demand = summary.delivery + summary.pipeline + summary.other;
  const planned = shareOf(demand, summary);
  // The stack is drawn against whichever is larger, supply or demand, so an overbooked team shows the overflow.
  const total = Math.max(summary.supply, demand) || 1;
  const w = (n: number) => `${(100 * n) / total}%`;
  const sorted = [...people].sort(
    (a, b) =>
      b.conflictWeeks - a.conflictWeeks ||
      b.riskWeeks - a.riskWeeks ||
      b.utilization - a.utilization ||
      (d.resourcesById.get(a.resourceId)?.name ?? '').localeCompare(d.resourcesById.get(b.resourceId)?.name ?? ''),
  );
  const windowLabel = weeks.length ? formatWeekRange(weeks[0], weeks[weeks.length - 1]) : '';

  return (
    <aside className="side-panel capacity" aria-label="Capacity">
      <div className="capacity-top">
        <div className="panel-header">
          <h2>Team capacity</h2>
          <select aria-label="Capacity window" value={range} onChange={(e) => setRange(e.target.value as Range)} title={windowLabel}>
            <option value="next">Next {LOOKAHEAD_WEEKS} weeks</option>
            <option value="visible">Weeks on screen</option>
          </select>
        </div>
        <div className="main-metric" title="Booked FTE-weeks (won + pipeline + other) ÷ available FTE-weeks. Can pass 100%.">
          <span className="metric-big">{summary.supply ? pct(planned) : 'N/A'}</span>
          <span className="muted small">Planned utilization</span>
        </div>
        <div className="metric-row">
          <div title={`${fte(summary.delivery * 100)} FTE-weeks on won workstreams`}>
            <strong className="metric-delivery">{pct(shareOf(summary.delivery, summary))}</strong>
            <span>Won delivery</span>
          </div>
          <div title={`${fte(summary.pipeline * 100)} FTE-weeks on pipeline workstreams (presales + delivery if won), not probability-weighted`}>
            <strong className="metric-pipeline">{pct(shareOf(summary.pipeline, summary))}</strong>
            <span>Pipeline</span>
          </div>
          {summary.overflow > 0 ? (
            <div title={`${fte(summary.overflow * 100)} FTE-weeks more booked than the team has`}>
              <strong className="metric-over">{pct(shareOf(summary.overflow, summary))}</strong>
              <span>Overbooked</span>
            </div>
          ) : (
            <div title={`${fte(summary.headroom * 100)} FTE-weeks unbooked. Not a promise that nobody is over in a given week.`}>
              <strong className="metric-free">{pct(shareOf(summary.headroom, summary))}</strong>
              <span>Headroom</span>
            </div>
          )}
        </div>
        <div className="stack" role="img" aria-label={`Won delivery ${pct(shareOf(summary.delivery, summary))}, pipeline ${pct(shareOf(summary.pipeline, summary))}, ${summary.overflow > 0 ? `overbooked ${pct(shareOf(summary.overflow, summary))}` : `headroom ${pct(shareOf(summary.headroom, summary))}`} of available capacity`}>
          <span className="stack-delivery" style={{ width: w(summary.delivery) }} />
          <span className="stack-pipeline" style={{ width: w(summary.pipeline) }} />
          {summary.other > 0 && <span className="stack-other" style={{ width: w(summary.other) }} title="Presales on lost workstreams" />}
          <span className="stack-free" style={{ width: w(summary.headroom) }} />
          {summary.overflow > 0 && <span className="stack-supply" style={{ left: w(summary.supply) }} title="Available capacity" />}
        </div>
        <p className="metric-caption">
          FTE-weeks as a share of available capacity: {summary.people} {summary.people === 1 ? 'person' : 'people'} × {summary.weeks} weeks
          = {summary.supply} FTE-weeks, everyone at 1.0 FTE. Pipeline is unweighted.
          {summary.other > 0 && ` Includes ${fte(summary.other * 100)} FTE-weeks of presales on lost workstreams.`}
        </p>
        <p className="issue-line">
          {issues.conflicts > 0 ? (
            <span className="danger-text">
              ⚠ {issues.conflicts} {issues.conflicts === 1 ? 'conflict' : 'conflicts'} across {issues.conflictPeople}{' '}
              {issues.conflictPeople === 1 ? 'person' : 'people'}
            </span>
          ) : (
            <span>No conflicts</span>
          )}
          {issues.risks > 0 && <span> · {issues.risks} at risk if pipeline is won</span>}
          {issues.openRoles > 0 && <span> · {issues.openRoles} open {issues.openRoles === 1 ? 'role' : 'roles'}</span>}
        </p>
      </div>

      <div className="side-section">
        <nav className="side-tabs" aria-label="Capacity breakdown">
          {(['people', 'roles', 'capabilities'] as Tab[]).map((t) => (
            <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>
              {t === 'people' ? 'People' : t === 'roles' ? 'Open roles' : 'Capabilities'}
            </button>
          ))}
        </nav>

        {tab === 'people' &&
          (sorted.length === 0 ? (
            <p className="muted small">No people yet.</p>
          ) : (
            <ul className="person-caps">
              {sorted.map((p) => {
                const r = d.resourcesById.get(p.resourceId)!;
                const target = utilizationTarget(plan.settings, r.level);
                const committed = utilizationOf(util, r.id).committed;
                const won = (100 * p.delivery) / (weeks.length || 1);
                const rest = p.utilization - won;
                const lit = highlight === r.id;
                return (
                  <li key={r.id} className={lit ? 'person-cap lit' : 'person-cap'}>
                    <button
                      type="button"
                      className="person-cap-main"
                      aria-pressed={lit}
                      title={`${r.name}: ${pct(p.utilization)} of capacity booked (${pct(won)} won, ${pct(rest)} pipeline/other). Committed ${pct(committed)} vs ${pct(target)} target. Click to highlight their rows.`}
                      onClick={() => setHighlight(lit ? null : r.id)}
                    >
                      <span className="avatar-mini" aria-hidden="true">
                        {initials(r.name)}
                      </span>
                      <span className="person-cap-name">
                        <span className="pname">{r.name}</span>
                        <span className="psub">
                          {r.level ?? 'No level'} · <span title="Committed utilization minus the target for their level">{signed(committed - target)} vs target</span>
                        </span>
                      </span>
                      <span className="cap-track" aria-hidden="true">
                        <span className="cap-won" style={{ width: scale(won) }} />
                        <span className="cap-pipe" style={{ width: scale(Math.max(0, rest)) }} />
                        <span className="cap-full" style={{ left: scale(100) }} />
                      </span>
                      <span className={p.conflictWeeks ? 'cap-pct over' : p.riskWeeks ? 'cap-pct risk' : 'cap-pct'}>
                        {p.conflictWeeks > 0 && <span aria-label="over capacity">⚠ </span>}
                        {pct(p.utilization)}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Show ${r.name} in Resources`}
                      title="Show in Resources"
                      onClick={() => jumpTo('resources', `r:${r.id}`, undefined, [levelGroupKey(r.level)])}
                    >
                      ↗
                    </button>
                  </li>
                );
              })}
            </ul>
          ))}

        {tab === 'roles' &&
          (openRoles.length === 0 ? (
            <p className="muted small">No open roles in this window.</p>
          ) : (
            <ul className="role-caps">
              {openRoles.map((o) => {
                const role = plan.assignments.find((a) => a.id === o.roleId)!;
                const p = d.projectsById.get(o.projectId);
                return (
                  <li key={o.roleId}>
                    <button
                      type="button"
                      className="link"
                      title="Show this role on its workstream"
                      onClick={() => jumpTo('projects', `a:${o.roleId}`, o.from, [`p:${o.projectId}`, ...workstreamGroupKeys(p)])}
                    >
                      {role.name || 'Unnamed role'}
                    </button>
                    <span className="muted small">
                      {p?.name} · from {formatWeek(o.from)}
                    </span>
                    <span className="role-fte" title="Unfilled FTE-weeks in this window">
                      {fte(o.fteWeeks * 100)} FTE-wk
                    </span>
                  </li>
                );
              })}
            </ul>
          ))}

        {tab === 'capabilities' &&
          (capabilities.length === 0 ? (
            <p className="muted small">No open roles in this window.</p>
          ) : (
            <>
              <table className="util-table">
                <thead>
                  <tr>
                    <th>Capability</th>
                    <th title="Average FTE of open roles on won workstreams">Won</th>
                    <th title="Average FTE of open roles on pipeline workstreams">Pipe.</th>
                    <th title="Average free FTE among people with this capability (100% minus committed work)">Free</th>
                  </tr>
                </thead>
                <tbody>
                  {capabilities.map((row) => {
                    const short = row.won + row.pipeline > row.available;
                    return (
                      <tr key={row.tagId ?? 'none'} className={short ? 'util-short' : undefined}>
                        <td>{row.tagId ? (d.tagsById.get(row.tagId)?.name ?? '?') : <em className="muted">Any</em>}</td>
                        <td className="num">{row.won ? fte(row.won * 100) : '–'}</td>
                        <td className="num">{row.pipeline ? fte(row.pipeline * 100) : '–'}</td>
                        <td className="num" title={short ? 'Not enough free capacity with this capability to fill the open roles' : undefined}>
                          {row.available ? fte(row.available * 100) : '–'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="muted small">
                Open demand vs free capacity, average FTE per week. People and roles with several capabilities count under
                each, so rows don&apos;t add up.
              </p>
            </>
          ))}
      </div>
      <p className="panel-footer">
        Red means over capacity. Select a person to highlight their rows. Workstream stage and booking are shown separately;
        tentative bookings are pipeline delivery.
      </p>
    </aside>
  );
}
