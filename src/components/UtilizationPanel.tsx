import { useMemo } from 'react';
import { LOOKAHEAD_WEEKS, lookaheadWeeks, teamUtilization, utilizationByResource, utilizationOf } from '../domain/utilization';
import { currentWeek, formatWeekRange } from '../domain/weeks';
import { usePlan } from '../store/planStore';
import { levelGroupKey, useUIStore } from '../store/uiStore';
import { useDerived } from '../store/useDerived';

const pct = (n: number) => `${Math.round(n)}%`;
/** Bar scale: 150% fills the track. */
const barWidth = (n: number) => `${Math.min(100, (n / 150) * 100)}%`;

/** Workstreams sidebar: everyone's projected utilization over the next 10 weeks. */
export function UtilizationPanel() {
  const plan = usePlan();
  const d = useDerived();
  const jumpTo = useUIStore((s) => s.jumpTo);
  const thisWeek = currentWeek();
  const weeks = useMemo(() => lookaheadWeeks(thisWeek), [thisWeek]);
  const util = useMemo(() => utilizationByResource(plan, d.loads, weeks), [plan, d.loads, weeks]);
  const threshold = plan.settings.overallocationThreshold;
  const team = teamUtilization(util, plan.resources.map((r) => r.id));
  const people = [...plan.resources].sort(
    (a, b) => utilizationOf(util, a.id).committed - utilizationOf(util, b.id).committed || a.name.localeCompare(b.name),
  );

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
        included. Pipeline = presales plus delivery that only happens if won.
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
            </tr>
          </thead>
          <tbody>
            {people.map((r) => {
              const u = utilizationOf(util, r.id);
              const state = u.committed > threshold ? 'over' : u.committed < threshold ? 'under' : '';
              return (
                <tr key={r.id} className={state ? `util-${state}` : undefined}>
                  <td>
                    <button
                      type="button"
                      className="link"
                      title={`${pct(u.committed)} committed (presales + won delivery). Show in Resources`}
                      onClick={() => jumpTo('resources', `r:${r.id}`, undefined, [levelGroupKey(r.level)])}
                    >
                      {r.name}
                    </button>
                    {r.level && <span className="level-badge">{r.level}</span>}
                    <span className="util-bar" aria-hidden>
                      <span className="util-bar-delivery" style={{ width: barWidth(u.delivery) }} />
                      <span className="util-bar-pipeline" style={{ width: barWidth(u.pipeline) }} />
                    </span>
                  </td>
                  <td className="num">{pct(u.delivery)}</td>
                  <td className="num" title={pipelineTitle(u.presales, u.pipeline)}>
                    {pct(u.pipeline)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </aside>
  );
}
