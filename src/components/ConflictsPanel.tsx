import type { Overallocation } from '../domain/conflicts';
import { currentWeek, formatWeekRange } from '../domain/weeks';
import { useUIStore } from '../store/uiStore';
import { useDerived } from '../store/useDerived';

/** Lists current/future overallocations, pipeline risks and skill gaps; clicking one jumps to the row. */
export function ConflictsPanel() {
  const d = useDerived();
  const jumpTo = useUIStore((s) => s.jumpTo);
  const thisWeek = currentWeek();
  const upcoming = d.overallocations.filter((o) => o.to >= thisWeek);
  const pastCount = d.overallocations.length - upcoming.length;
  const name = {
    resource: (id: string) => d.resourcesById.get(id)?.name ?? 'Unknown',
    project: (id: string) => d.projectsById.get(id)?.name ?? 'Unknown',
    tag: (id: string) => d.tagsById.get(id)?.name ?? '?',
  };

  const over = upcoming.filter((o) => o.severity === 'over');
  const risk = upcoming.filter((o) => o.severity === 'risk');

  const list = (items: Overallocation[], empty: string) =>
    items.length === 0 ? (
      <p className="muted small">{empty}</p>
    ) : (
      <ul>
        {items.map((o) => (
          <li key={`${o.resourceId}-${o.severity}-${o.from}`}>
            <button type="button" onClick={() => jumpTo('resources', `r:${o.resourceId}`, o.from)}>
              <span className="conflict-title">
                {name.resource(o.resourceId)}{' '}
                <span className={o.severity === 'over' ? 'pill-danger' : 'pill-risk'}>{o.peak}%</span>
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
      <h2 title="Committed work (presales + delivery on won workstreams) over capacity">
        Overallocated <span className="count">{over.length}</span>
      </h2>
      {list(over, 'Nobody is over capacity from this week on.')}
      <h2 title="Over capacity only if pipeline delivery work is won">
        At risk if pipeline wins <span className="count">{risk.length}</span>
      </h2>
      {list(risk, 'Pipeline delivery work causes no extra conflicts.')}
      {pastCount > 0 && <p className="muted small">{pastCount} past conflict(s) hidden.</p>}

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
                <button type="button" onClick={() => jumpTo('projects', `p:${i.projectId}`)}>
                  <span className="conflict-title">{name.resource(i.resourceId)}</span>
                  <span className="small">
                    on {name.project(i.projectId)}: has none of{' '}
                    {d.projectsById.get(i.projectId)?.tagIds.map(name.tag).join(', ')}
                  </span>
                </button>
              </li>
            ) : (
              <li key={`u-${i.projectId}`}>
                <button type="button" onClick={() => jumpTo('projects', `p:${i.projectId}`)}>
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
