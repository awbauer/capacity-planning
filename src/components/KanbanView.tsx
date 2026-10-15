import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { initials } from '../collab/format';
import { RowComments } from '../collab/RowComments';
import type { Derived } from '../domain/derive';
import {
  columnPatch,
  KANBAN_COLUMNS,
  kanbanColumn,
  showsStaffing,
  workstreamIssues,
  workstreamStats,
  type KanbanColumn,
  type PersonFte,
} from '../domain/kanban';
import { LIKELY_WIN } from '../domain/load';
import { fte } from '../domain/timeline';
import type { Project } from '../domain/types';
import { currentWeek } from '../domain/weeks';
import { usePlan, usePlanStore } from '../store/planStore';
import { clientGroupKey, useUIStore, type Filters, type KanbanLanes } from '../store/uiStore';
import { useCan } from '../store/useCan';
import { useDerived } from '../store/useDerived';
import { TagChips } from './Chips';
import { ProjectDialog } from './ProjectDialog';
import { WorkstreamMenu } from './WorkstreamMenu';

/** Pipeline only doesn't apply here: the board's columns are the stages. */
function matches(p: Project, f: Filters, d: Derived, hasIssue: boolean): boolean {
  if (f.tagId && !p.tagIds.includes(f.tagId)) return false;
  if (f.sellerId && p.sellerId !== f.sellerId) return false;
  if (f.conflictsOnly && !hasIssue) return false;
  const q = f.text.trim().toLowerCase();
  if (!q) return true;
  const people = (d.assignmentsByProject.get(p.id) ?? []).flatMap((a) => [
    a.name,
    a.resourceId ? (d.resourcesById.get(a.resourceId)?.name ?? '') : '',
  ]);
  return [p.name, p.externalId ?? '', p.client ?? '', p.sellerId ? (d.sellersById.get(p.sellerId)?.name ?? '') : '', ...people].some((s) =>
    s.toLowerCase().includes(q),
  );
}

interface Lane {
  key: string;
  name: string | undefined;
  /** What dropping a card in this lane sets. */
  patch: Partial<Project>;
}

function lanesFor(mode: KanbanLanes, projects: Project[], d: Derived, showEmpty: boolean): Lane[] {
  if (mode === 'none') return [{ key: 'all', name: undefined, patch: {} }];
  if (mode === 'seller') {
    const used = new Set(projects.map((p) => (p.sellerId && d.sellersById.has(p.sellerId) ? p.sellerId : '')));
    const sellers = [...d.sellersById.values()]
      .filter((s) => showEmpty || used.has(s.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    return [
      ...(used.has('') ? [{ key: 's:', name: undefined, patch: { sellerId: null } }] : []),
      ...sellers.map((s) => ({ key: `s:${s.id}`, name: s.name, patch: { sellerId: s.id } })),
    ];
  }
  const byKey = new Map<string, Lane>();
  for (const p of projects) {
    const key = clientGroupKey(p.client);
    if (!byKey.has(key)) byKey.set(key, { key, name: p.client?.trim() || undefined, patch: { client: p.client?.trim() || undefined } });
  }
  return [...byKey.values()].sort((a, b) => Number(!!a.name) - Number(!!b.name) || (a.name ?? '').localeCompare(b.name ?? ''));
}

function laneOf(mode: KanbanLanes, p: Project, d: Derived): string {
  if (mode === 'none') return 'all';
  if (mode === 'seller') return `s:${p.sellerId && d.sellersById.has(p.sellerId) ? p.sellerId : ''}`;
  return clientGroupKey(p.client);
}

const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0);
/** Totals in FTE to one decimal, as on the board's headers and cards. */
const fte1 = (pct: number) => (pct / 100).toFixed(1);

/**
 * Workstreams as cards: columns by stage and win %, swimlanes by seller or
 * client. Dragging a card to another column or lane changes its stage, win %,
 * seller or client in one undoable edit; clicking one opens its details.
 */
export function KanbanView() {
  const plan = usePlan();
  const d = useDerived();
  const can = useCan();
  const filters = useUIStore((s) => s.filters);
  const lanesMode = useUIStore((s) => s.kanbanLanes);
  const showLost = useUIStore((s) => s.kanbanShowLost);
  const selected = useUIStore((s) => s.kanbanSelected);
  const select = useUIStore((s) => s.selectKanban);
  const updateProject = usePlanStore((s) => s.updateProject);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [creating, setCreating] = useState<Partial<Omit<Project, 'id'>> | null>(null);

  const thisWeek = currentWeek();
  const info = useMemo(() => {
    const out = new Map<string, { stats: ReturnType<typeof workstreamStats>; issues: ReturnType<typeof workstreamIssues> }>();
    for (const p of plan.projects) {
      const roles = d.assignmentsByProject.get(p.id) ?? [];
      out.set(p.id, { stats: workstreamStats(p, roles), issues: workstreamIssues(roles, d.loads, plan.settings, thisWeek) });
    }
    return out;
  }, [plan, d, thisWeek]);

  const hasIssue = (id: string) => {
    const i = info.get(id)!.issues;
    return i.conflictPeople.size + i.riskPeople.size + i.openRoles > 0;
  };
  const projects = plan.projects.filter((p) => matches(p, filters, d, hasIssue(p.id)));
  const filtered = !!(filters.text.trim() || filters.tagId || filters.sellerId || filters.conflictsOnly);
  const columns = KANBAN_COLUMNS.filter((c) => c.id !== 'lost' || showLost);
  const visible = projects.filter((p) => showLost || p.status !== 'lost');
  const lanes = lanesFor(lanesMode, visible, d, !filtered && lanesMode === 'seller');
  const cell = (lane: string, col: KanbanColumn) =>
    visible
      .filter((p) => laneOf(lanesMode, p, d) === lane && kanbanColumn(p) === col)
      .sort((a, b) => (a.startWeek ?? '9999').localeCompare(b.startWeek ?? '9999') || a.name.localeCompare(b.name));
  const demandOf = (ps: Project[]) => sum(ps.map((p) => info.get(p.id)!.stats.demand));

  // The selected card may have been deleted or filtered out.
  useEffect(() => {
    if (selected && !plan.projects.some((p) => p.id === selected)) select(null);
  }, [plan.projects, selected, select]);

  const drop = (lane: Lane, col: KanbanColumn) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData('text/x-workstream') || dragging;
    setDragging(null);
    const p = id ? d.projectsById.get(id) : undefined;
    if (!p || !can.edit) return;
    const patch: Partial<Project> = {};
    const next = { ...columnPatch(col), ...lane.patch } as Partial<Project>;
    for (const [k, v] of Object.entries(next) as [keyof Project, unknown][]) {
      if ((p[k] ?? null) !== (v ?? null)) (patch as Record<string, unknown>)[k] = v;
    }
    if (Object.keys(patch).length) updateProject(p.id, patch);
  };

  const named = lanes.filter((l) => l.name).length;
  const laneNoun = lanesMode === 'seller' ? 'seller' : 'client';
  const style = { gridTemplateColumns: `${lanesMode === 'none' ? '' : 'var(--kanban-lane-w) '}repeat(${columns.length}, minmax(212px, 1fr))` };

  return (
    <div className="kanban" role="region" aria-label="Kanban board">
      <div className="kanban-grid" style={style}>
        {lanesMode !== 'none' && (
          <div className="kanban-corner">
            <strong>{lanesMode === 'seller' ? 'Seller' : 'Client'}</strong>
            <span className="muted small">
              {named} {named === 1 ? laneNoun : `${laneNoun}s`}
            </span>
          </div>
        )}
        {columns.map((c) => {
          const ps = visible.filter((p) => kanbanColumn(p) === c.id);
          return (
            <div key={c.id} className={`kanban-col-head col-${c.id}`} role="columnheader">
              <i className="col-dot" aria-hidden />
              <strong>{c.label}</strong>
              <span className="count" aria-label={`${ps.length} workstreams`}>
                {ps.length}
              </span>
              <span className="spacer" />
              <span className="muted small" title="Delivery demand, filled and open roles, averaged over each workstream's weeks">
                {fte1(demandOf(ps))} FTE
              </span>
            </div>
          );
        })}
        {lanes.map((lane) => {
          const inLane = visible.filter((p) => laneOf(lanesMode, p, d) === lane.key);
          return [
            lanesMode !== 'none' && (
              <div key={`${lane.key}-head`} className="kanban-lane-head" role="rowheader">
                <span className={lane.name ? 'avatar-lane' : 'avatar-lane none'} aria-hidden>
                  {lane.name ? initials(lane.name) : '–'}
                </span>
                <div>
                  <div className="lane-name">{lane.name ?? `No ${laneNoun}`}</div>
                  <div className="muted small">
                    {inLane.length} {inLane.length === 1 ? 'workstream' : 'workstreams'}
                  </div>
                  <div className="muted small">{fte1(demandOf(inLane))} FTE</div>
                </div>
              </div>
            ),
            ...columns.map((c) => {
              const cards = cell(lane.key, c.id);
              const cellKey = `${lane.key}|${c.id}`;
              return (
                <div
                  key={cellKey}
                  className={['kanban-cell', over === cellKey ? 'drop-over' : ''].join(' ')}
                  aria-label={`${lane.name ?? (lanesMode === 'none' ? '' : `No ${laneNoun}`)} ${c.label}`.trim()}
                  onDragOver={(e) => {
                    if (!dragging || !can.edit) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (over !== cellKey) setOver(cellKey);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === cellKey ? null : o));
                  }}
                  onDrop={drop(lane, c.id)}
                >
                  {cards.map((p) => (
                    <Card
                      key={p.id}
                      p={p}
                      d={d}
                      info={info.get(p.id)!}
                      lanesMode={lanesMode}
                      selected={selected === p.id}
                      draggable={can.edit}
                      dragging={dragging === p.id}
                      onSelect={() => select(selected === p.id ? null : p.id)}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/x-workstream', p.id);
                        e.dataTransfer.effectAllowed = 'move';
                        setDragging(p.id);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                    />
                  ))}
                  {cards.length === 0 && can.edit && (
                    <button
                      type="button"
                      className="kanban-add"
                      onClick={() => setCreating({ ...columnPatch(c.id), ...lane.patch })}
                    >
                      + Add workstream
                    </button>
                  )}
                </div>
              );
            }),
          ];
        })}
      </div>
      {visible.length === 0 && (
        <p className="empty kanban-empty">
          {plan.projects.length === 0 ? 'No workstreams yet.' : 'No workstreams match the filters.'}
        </p>
      )}
      {creating && <ProjectDialog defaults={creating} onClose={() => setCreating(null)} />}
    </div>
  );
}

interface CardProps {
  p: Project;
  d: Derived;
  info: { stats: ReturnType<typeof workstreamStats>; issues: ReturnType<typeof workstreamIssues> };
  lanesMode: KanbanLanes;
  selected: boolean;
  draggable: boolean;
  dragging: boolean;
  onSelect: () => void;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
}

function People({ people, d, max, showFte }: { people: PersonFte[]; d: Derived; max: number; showFte: boolean }) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className="kcard-people">
      {shown.map((x) => {
        const name = d.resourcesById.get(x.resourceId)?.name ?? '?';
        return (
          <span key={x.resourceId} className="kcard-person" title={`${name}: ${fte(x.pct)} FTE on average`}>
            <span className="avatar-mini" aria-hidden>
              {initials(name)}
            </span>
            {showFte && (
              <>
                <span className="kcard-person-name">{name.split(/\s+/)[0]}</span>
                <span className="muted">{fte(x.pct)}</span>
              </>
            )}
            {!showFte && <span className="sr-only">{name}</span>}
          </span>
        );
      })}
      {rest > 0 && (
        <span
          className="avatar-mini more"
          title={people
            .slice(max)
            .map((x) => d.resourcesById.get(x.resourceId)?.name ?? '?')
            .join(', ')}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}

function Card({ p, d, info, lanesMode, selected, draggable, dragging, onSelect, onDragStart, onDragEnd }: CardProps) {
  const { stats, issues } = info;
  const staffing = showsStaffing(p);
  const pct = stats.demand ? Math.round((100 * stats.staffed) / stats.demand) : 0;
  const conflict = issues.conflictPeople.size;
  const risk = issues.riskPeople.size;
  const subtitle = [p.client, lanesMode !== 'seller' && p.sellerId ? d.sellersById.get(p.sellerId)?.name : undefined]
    .filter(Boolean)
    .join(' · ');
  return (
    <article
      className={['kcard', selected ? 'selected' : '', conflict ? 'has-conflict' : '', dragging ? 'dragging' : '', p.status === 'lost' ? 'lost' : '']
        .filter(Boolean)
        .join(' ')}
      aria-label={p.name}
      aria-current={selected || undefined}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button:not(.kcard-name), select, a, [role=menuitem]')) return;
        onSelect();
      }}
    >
      <div className="kcard-head">
        <h3>
          <button type="button" className="kcard-name" title={`${p.name}: show details`}>
            {p.name}
          </button>
        </h3>
        <RowComments kind="project" id={p.id} name={p.name} />
        <WorkstreamMenu project={p} className="icon-btn kcard-more" />
      </div>
      {subtitle && <div className="kcard-client muted">{subtitle}</div>}
      <div className="kcard-size">
        {stats.weeks.length ? (
          <>
            {stats.weeks.length} {stats.weeks.length === 1 ? 'week' : 'weeks'} • {fte1(stats.demand)} FTE
          </>
        ) : (
          <span className="muted">No delivery weeks yet</span>
        )}
      </div>
      {p.tagIds.length > 0 && <TagChips tagIds={p.tagIds} tagsById={d.tagsById} />}
      {staffing ? (
        stats.demand > 0 && (
          <div className="kcard-staffing">
            <div
              className="kcard-track"
              role="meter"
              aria-label="Staffed"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(100, pct)}
            >
              <span style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
            <div className="kcard-staffing-text">
              <span>
                {fte1(stats.staffed)} / {fte1(stats.demand)} FTE
              </span>
              <span className={pct >= 100 ? 'staffed-full' : 'staffed-part'}>{pct}% staffed</span>
            </div>
            {stats.delivery.length > 0 && <People people={stats.delivery} d={d} max={3} showFte={false} />}
          </div>
        )
      ) : (
        <div className="kcard-presales">
          <div className="kcard-label muted">Presales support</div>
          {stats.presales.length ? (
            <People people={stats.presales} d={d} max={2} showFte />
          ) : (
            <span className="muted small">Nobody yet</span>
          )}
        </div>
      )}
      {(conflict > 0 || risk > 0 || issues.openRoles > 0) && (
        <div className="kcard-badges">
          {conflict > 0 && (
            <span className="badge badge-danger" title="People on this workstream over capacity on committed work from this week on">
              ⚠ {conflict} over
            </span>
          )}
          {risk > 0 && (
            <span
              className={issues.allRiskLow ? 'badge badge-risk low' : 'badge badge-risk'}
              title={
                issues.allRiskLow
                  ? `Over capacity only if pipeline work under ${LIKELY_WIN}% likely to be won comes through`
                  : 'Over capacity if pipeline work is won'
              }
            >
              {risk} {issues.allRiskLow ? 'low risk' : 'at risk'}
            </span>
          )}
          {issues.openRoles > 0 && <span className="badge badge-open">{issues.openRoles} open</span>}
        </div>
      )}
    </article>
  );
}
