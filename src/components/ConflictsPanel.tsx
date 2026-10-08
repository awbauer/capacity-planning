import type { Overallocation } from '../domain/conflicts';
import { currentWeek, formatWeek, formatWeekRange } from '../domain/weeks';
import { usePlan } from '../store/planStore';
import { clientGroupKey, levelGroupKey, useUIStore } from '../store/uiStore';
import { useDerived } from '../store/useDerived';

/** Lists current/future overallocations, pipeline risks and skill gaps; clicking one jumps to the row. */
export function ConflictsPanel() {
  const d = useDerived();
  const jumpTo = useUIStore((s) => s.jumpTo);
  const thisWeek = currentWeek();
  const s = usePlan().settings;
  const upcoming = d.overallocations.filter((o) => o.to >= thisWeek);
  const pastCount = d.overallocations.length - upcoming.length;
  const toResource = (id: string, week?: string) =>
    jumpTo('resources', `r:${id}`, week, [levelGroupKey(d.resourcesById.get(id)?.level)]);
  const toProject = (id: string) => jumpTo('projects', `p:${id}`, undefined, [clientGroupKey(d.projectsById.get(id)?.client)]);
  const name = {
    resource: (id: string) => d.resourcesById.get(id)?.name ?? 'Unknown',
    project: (id: string) => d.projectsById.get(id)?.name ?? 'Unknown',
    tag: (id: string) => d.tagsById.get(id)?.name ?? '?',
  };

  const over = upcoming.filter((o) => o.severity === 'over');
  const stretch = upcoming.filter((o) => o.severity === 'stretch');
  const risk = upcoming.filter((o) => o.severity === 'risk');

  const list = (items: Overallocation[], empty: string) =>
    items.length === 0 ? (
      <p className="muted small">{empty}</p>
    ) : (
      <ul>
        {items.map((o) => (
          <li key={`${o.resourceId}-${o.severity}-${o.from}`}>
            <button type="button" onClick={() => toResource(o.resourceId, o.from)}>
              <span className="conflict-title">
                {name.resource(o.resourceId)}{' '}
                <span className={`pill-${o.severity}`}>{o.peak}%</span>
              </span>
              <span className="muted small">
                {formatWeekRange(o.from, o.to)} · {o.weeks.length} wk
              </span>
              <span className="small">{o.projectIds.map(name.project).join(', ')}</span>
            </button>
          </li>
        ))}
      </ul>
    );

  return (
    <aside className="conflicts" aria-label="Conflicts">
      <h2 title={`Committed work (presales + delivery on won workstreams) above ${s.criticalThreshold}%`}>
        Overallocated ({s.criticalThreshold + 1}%+) <span className="count">{over.length}</span>
      </h2>
      {list(over, 'Nobody is overallocated from this week on.')}
      <h2 title={`Committed work above ${s.overallocationThreshold}% but not over ${s.criticalThreshold}%`}>
        Stretched ({s.overallocationThreshold + 1}–{s.criticalThreshold}%) <span className="count">{stretch.length}</span>
      </h2>
      {list(stretch, 'Nobody is stretched from this week on.')}
      <h2 title="Over capacity only if pipeline delivery work is won">
        At risk if pipeline wins <span className="count">{risk.length}</span>
      </h2>
      {list(risk, 'Pipeline delivery work causes no extra conflicts.')}
      {pastCount > 0 && <p className="muted small">{pastCount} past conflict(s) hidden.</p>}

      <h2 title="Demand on workstreams that no one has been chosen for yet, from this week on">
        Open roles <span className="count">{d.upcomingRoles.length}</span>
      </h2>
      {d.upcomingRoles.length === 0 ? (
        <p className="muted small">Every role is filled.</p>
      ) : (
        <ul>
          {d.upcomingRoles.map(({ role, from }) => (
            <li key={role.id}>
              <button type="button" onClick={() => toProject(role.projectId)}>
                <span className="conflict-title">
                  {role.name}
                  {role.level && <span className="level-badge">{role.level}</span>}
                </span>
                <span className="muted small">from {formatWeek(from)}</span>
                <span className="small">
                  {name.project(role.projectId)}
                  {role.tagIds.length > 0 && ` · ${role.tagIds.map(name.tag).join(', ')}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <h2>
        Skill gaps <span className="count">{d.skillIssues.length}</span>
      </h2>
      {d.skillIssues.length === 0 ? (
        <p className="muted small">Every assignment matches its workstream's capabilities.</p>
      ) : (
        <ul>
          {d.skillIssues.map((i) =>
            i.kind === 'mismatch' ? (
              <li key={i.assignmentId}>
                <button type="button" onClick={() => toProject(i.projectId)}>
                  <span className="conflict-title">{name.resource(i.resourceId)}</span>
                  <span className="small">
                    on {name.project(i.projectId)}: has none of{' '}
                    {d.projectsById.get(i.projectId)?.tagIds.map(name.tag).join(', ')}
                  </span>
                </button>
              </li>
            ) : (
              <li key={`u-${i.projectId}`}>
                <button type="button" onClick={() => toProject(i.projectId)}>
                  <span className="conflict-title">{name.project(i.projectId)}</span>
                  <span className="small">Nobody covers {i.tagIds.map(name.tag).join(', ')}</span>
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </aside>
  );
}
