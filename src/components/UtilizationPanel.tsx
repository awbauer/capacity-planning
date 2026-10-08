import { useMemo } from 'react';
import {
  LOOKAHEAD_WEEKS,
  demandByCapability,
  lookaheadWeeks,
  teamUtilization,
  utilizationByResource,
  utilizationOf,
  utilizationTarget,
} from '../domain/utilization';
import { currentWeek, formatWeekRange } from '../domain/weeks';
import { usePlan } from '../store/planStore';
import { levelGroupKey, useUIStore } from '../store/uiStore';
import { useDerived } from '../store/useDerived';

const pct = (n: number) => `${Math.round(n)}%`;
const fte = (n: number) => (n ? n.toFixed(1) : '–');
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(Math.round(n))}`;
/** Bar scale: 150% fills the track. */
const barWidth = (n: number) => `${Math.min(100, (n / 150) * 100)}%`;

/** Workstreams sidebar: projected utilization against level targets, and open demand vs bench, next 10 weeks. */
export function UtilizationPanel() {
  const plan = usePlan();
  const d = useDerived();
  const jumpTo = useUIStore((s) => s.jumpTo);
  const thisWeek = currentWeek();
  const weeks = useMemo(() => lookaheadWeeks(thisWeek), [thisWeek]);
  const util = useMemo(() => utilizationByResource(plan, d.loads, weeks), [plan, d.loads, weeks]);
  const demand = useMemo(() => demandByCapability(plan, d.loads, weeks), [plan, d.loads, weeks]);
  const team = teamUtilization(util, plan.resources.map((r) => r.id));
  const targetOf = (r: (typeof plan.resources)[number]) => utilizationTarget(plan.settings, r.level);
  const gap = (r: (typeof plan.resources)[number]) => utilizationOf(util, r.id).committed - targetOf(r);
  const teamTarget = plan.resources.length
    ? plan.resources.reduce((n, r) => n + targetOf(r), 0) / plan.resources.length
    : 0;
  // Furthest below target first.
  const people = [...plan.resources].sort((a, b) => gap(a) - gap(b) || a.name.localeCompare(b.name));

  const pipelineTitle = (presales: number, pipeline: number) =>
    `${pct(pipeline)} on pipeline workstreams: ${pct(presales)} presales (counts now) + ${pct(pipeline - presales)} delivery if won`;

  return (
    <aside className="conflicts utilization" aria-label="Utilization">
      <h2 title={`Average weekly allocation, ${formatWeekRange(weeks[0], weeks[weeks.length - 1])}`}>
        Next {LOOKAHEAD_WEEKS} weeks
      </h2>
      <div className="util-team">
        <div title="Average across everyone on won workstreams">
          <span className="util-big">{pct(team.delivery)}</span>
          <span className="muted small">Delivery</span>
        </div>
        <div title={pipelineTitle(team.presales, team.pipeline)}>
          <span className="util-big util-pipeline">{pct(team.pipeline)}</span>
          <span className="muted small">Pipeline</span>
        </div>
      </div>
      <p className="muted small">
        Team average over {plan.resources.length} {plan.resources.length === 1 ? 'person' : 'people'}, idle time
        included. Committed work (presales + won delivery, each week capped at 100%) is{' '}
        <strong className={team.committed < teamTarget ? 'util-under-text' : undefined}>{pct(team.committed)}</strong>{' '}
        against an average target of {pct(teamTarget)}.
      </p>
      {people.length === 0 ? (
        <p className="muted small">No people yet.</p>
      ) : (
        <table className="util-table">
          <thead>
            <tr>
              <th>Person</th>
              <th title="Won workstreams">Deliv.</th>
              <th title="Pipeline workstreams (presales + delivery if won)">Pipe.</th>
              <th title="Committed utilization minus the target for their level (Manage → Settings)">vs tgt</th>
            </tr>
          </thead>
          <tbody>
            {people.map((r) => {
              const u = utilizationOf(util, r.id);
              const target = targetOf(r);
              const under = u.committed < target;
              return (
                <tr key={r.id} className={under ? 'util-under' : undefined}>
                  <td>
                    <button
                      type="button"
                      className="link"
                      title={`${pct(u.committed)} committed (presales + won delivery) vs ${pct(target)} target. Show in Resources`}
                      onClick={() => jumpTo('resources', `r:${r.id}`, undefined, [levelGroupKey(r.level)])}
                    >
                      {r.name}
                    </button>
                    {r.level && <span className="level-badge">{r.level}</span>}
                    <span className="util-bar" aria-hidden>
                      <span className="util-bar-delivery" style={{ width: barWidth(u.delivery) }} />
                      <span className="util-bar-pipeline" style={{ width: barWidth(u.pipeline) }} />
                      <span className="util-bar-target" style={{ left: barWidth(target) }} />
                    </span>
                  </td>
                  <td className="num">{pct(u.delivery)}</td>
                  <td className="num" title={pipelineTitle(u.presales, u.pipeline)}>
                    {pct(u.pipeline)}
                  </td>
                  <td className="num gap" title={`${pct(u.committed)} committed vs ${pct(target)} target`}>
                    {signed(u.committed - target)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h2 title="Open roles (unfilled demand) vs free capacity among people with each capability">
        Open demand vs bench
      </h2>
      {demand.length === 0 ? (
        <p className="muted small">No open roles in the next {LOOKAHEAD_WEEKS} weeks.</p>
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
              {demand.map((row) => {
                const short = row.won + row.pipeline > row.available;
                return (
                  <tr key={row.tagId ?? 'none'} className={short ? 'util-short' : undefined}>
                    <td>{row.tagId ? (d.tagsById.get(row.tagId)?.name ?? '?') : <em className="muted">Any</em>}</td>
                    <td className="num">{fte(row.won)}</td>
                    <td className="num">{fte(row.pipeline)}</td>
                    <td
                      className="num"
                      title={short ? 'Not enough free capacity with this capability to fill the open roles' : undefined}
                    >
                      {fte(row.available)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted small">
            FTE averaged over the {LOOKAHEAD_WEEKS} weeks. People and roles with several capabilities count under each,
            so rows don&apos;t add up.
          </p>
        </>
      )}
    </aside>
  );
}
