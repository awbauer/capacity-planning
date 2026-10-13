import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, apiDownload } from '../api/client';
import type { Change } from '../domain/diff';
import type { Assignment } from '../domain/types';
import { formatWeek } from '../domain/weeks';
import { today } from '../components/download';
import { useCollabStore } from '../store/collabStore';
import { usePlan, usePlanMeta } from '../store/planStore';
import { openSharedPlan, revertBatch } from '../store/sharedPlanStore';
import { useCan } from '../store/useCan';
import { useUIStore } from '../store/uiStore';
import { when } from './format';

interface Entry {
  batchId: string;
  planId: string;
  planName: string;
  seq: number;
  ts: number;
  actor: string;
  op: string;
  summary: string;
  changeCount: number;
  revertOf: string | null;
}

interface Filters {
  plan: string;
  actor: string;
  ref: string;
  from: string;
  to: string;
  q: string;
}

const NONE: Filters = { plan: '', actor: '', ref: '', from: '', to: '', q: '' };

const OP_LABELS: Record<string, string> = {
  'cells.set': 'Allocation',
  revert: 'Undo',
  'lock.add': 'Lock',
  'lock.remove': 'Unlock',
  'plan.replace': 'Whole plan',
  plan: 'Plan',
  user: 'Access',
  settings: 'Workspace',
};
const opLabel = (op: string) => OP_LABELS[op] ?? op.split('.')[0].replace(/^./, (c) => c.toUpperCase());

function toQuery(f: Filters, cursor?: string): string {
  const p = new URLSearchParams();
  if (f.plan) p.set('plan', f.plan === '(workspace)' ? '' : f.plan);
  if (f.actor) p.set('actor', f.actor.trim().toLowerCase());
  if (f.ref) p.set('ref', f.ref);
  if (f.from) p.set('from', String(new Date(`${f.from}T00:00`).getTime()));
  if (f.to) p.set('to', String(new Date(`${f.to}T00:00`).getTime() + 86_400_000));
  if (f.q) p.set('q', f.q);
  if (cursor) p.set('cursor', cursor);
  return p.toString();
}

/**
 * The consolidated change log: every change in every plan (and, for admins,
 * workspace events like role changes), newest first.
 */
export function ActivityView() {
  const plans = useCollabStore((s) => s.plans);
  const me = useCollabStore((s) => s.me);
  const toast = useCollabStore((s) => s.toast);
  const meta = usePlanMeta();
  const plan = usePlan();
  const [filters, setFilters] = useState<Filters>({ ...NONE, plan: meta.id });
  const [entries, setEntries] = useState<Entry[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      try {
        const r = await api<{ entries: Entry[]; next?: string }>(`/api/activity?${toQuery(filters, cursor)}`);
        setEntries((prev) => (cursor ? [...prev, ...r.entries] : r.entries));
        setNext(r.next);
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [filters, toast],
  );

  // Reload on filter changes, and when the open plan changes (meta.revision), so it stays live.
  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load, meta.revision]);

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const actors = useMemo(() => [...new Set(entries.map((e) => e.actor))].sort(), [entries]);
  const refsAvailable = filters.plan === meta.id;

  return (
    <div className="activity">
      <div className="activity-filters">
        <select aria-label="Plan" value={filters.plan} onChange={(e) => set({ plan: e.target.value, ref: '' })}>
          <option value="">All plans</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          {me?.role === 'admin' && <option value="(workspace)">Workspace (people, plans)</option>}
        </select>
        <input list="activity-actors" placeholder="Who (email)" aria-label="Who" value={filters.actor} onChange={(e) => set({ actor: e.target.value })} />
        <datalist id="activity-actors">
          {actors.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
        <select
          aria-label="Workstream or person"
          value={filters.ref}
          disabled={!refsAvailable}
          title={refsAvailable ? undefined : 'Pick the open plan to filter by its workstreams and people'}
          onChange={(e) => set({ ref: e.target.value })}
        >
          <option value="">Any workstream or person</option>
          <optgroup label="Workstreams">
            {[...plan.projects]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </optgroup>
          <optgroup label="People">
            {[...plan.resources]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </optgroup>
        </select>
        <label className="small">
          From <input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} />
        </label>
        <label className="small">
          To <input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} />
        </label>
        <input type="search" placeholder="Search descriptions" aria-label="Search" value={filters.q} onChange={(e) => set({ q: e.target.value })} />
        <button type="button" className="btn btn-small" onClick={() => setFilters(NONE)}>
          Clear
        </button>
        <span className="spacer" />
        <button
          type="button"
          className="btn btn-small"
          onClick={() => apiDownload(`/api/activity.csv?${toQuery(filters)}`, `activity-${today()}.csv`).catch((e: Error) => toast(e.message))}
        >
          Export CSV
        </button>
      </div>
      {entries.length === 0 && !loading ? (
        <p className="muted">No changes match.</p>
      ) : (
        <table className="table activity-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Plan</th>
              <th>What</th>
              <th className="num">Changes</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <ActivityRow
                key={e.batchId}
                entry={e}
                open={open === e.batchId}
                onToggle={() => setOpen(open === e.batchId ? null : e.batchId)}
                isOpenPlan={e.planId === meta.id}
              />
            ))}
          </tbody>
        </table>
      )}
      {next && (
        <button type="button" className="btn" disabled={loading} onClick={() => void load(next)}>
          {loading ? 'Loading…' : 'Older changes'}
        </button>
      )}
    </div>
  );
}

function ActivityRow({ entry: e, open, onToggle, isOpenPlan }: { entry: Entry; open: boolean; onToggle: () => void; isOpenPlan: boolean }) {
  const can = useCan();
  const toast = useCollabStore((s) => s.toast);
  const jumpTo = useUIStore((s) => s.jumpTo);
  const plan = usePlan();
  const [detail, setDetail] = useState<Change[] | null>(null);
  const expandable = !!e.planId && e.changeCount > 0;

  useEffect(() => {
    if (!open || !expandable || detail) return;
    api<{ changes: Change[] }>(`/api/plans/${e.planId}/batches/${e.batchId}`)
      .then((r) => setDetail(r.changes))
      .catch((err: Error) => toast(err.message));
  }, [open, expandable, detail, e.planId, e.batchId, toast]);

  const name = (kind: string, id: string) => {
    const list =
      kind === 'tag' ? plan.tags : kind === 'seller' ? plan.sellers : kind === 'resource' ? plan.resources : kind === 'project' ? plan.projects : [];
    if (kind === 'role') {
      const a = plan.assignments.find((x) => x.id === id);
      return a ? `${a.name || 'Role'}${a.resourceId ? ` › ${plan.resources.find((r) => r.id === a.resourceId)?.name ?? '?'}` : ''}` : 'a deleted role';
    }
    return (list as { id: string; name: string }[]).find((x) => x.id === id)?.name ?? (kind === 'settings' ? 'Settings' : '(deleted)');
  };
  const val = (v: unknown, week: boolean) =>
    v === null || v === undefined ? (week ? '0%' : '—') : week ? `${v}%` : typeof v === 'object' ? ((v as { name?: string }).name ?? '…') : String(v);
  const projectOf = (c: Change) => c.projectId ?? (c.kind === 'project' ? c.id : (c.after as Assignment | null)?.projectId);
  const firstProject = detail?.map(projectOf).find((p) => p && plan.projects.some((x) => x.id === p));

  return (
    <>
      <tr className={expandable ? 'activity-row clickable' : 'activity-row'} onClick={expandable ? onToggle : undefined}>
        <td className="nowrap small">{when(e.ts)}</td>
        <td className="small">{e.actor}</td>
        <td className="small">{e.planName || <em className="muted">workspace</em>}</td>
        <td>
          <span className="op-chip">{opLabel(e.op)}</span> {e.summary}
        </td>
        <td className="num small">{e.changeCount || ''}</td>
      </tr>
      {open && expandable && (
        <tr className="activity-detail">
          <td colSpan={5}>
            {!detail ? (
              <span className="muted">Loading…</span>
            ) : (
              <>
                <ul className="change-list">
                  {detail.slice(0, 200).map((c, i) => (
                    <li key={i}>
                      <strong>{isOpenPlan ? name(c.kind, c.id) : c.kind}</strong>{' '}
                      {c.week
                        ? `${formatWeek(c.week)}: ${val(c.before, true)} → ${val(c.after, true)}`
                        : c.field
                          ? `${c.field}: ${val(c.before, false)} → ${val(c.after, false)}`
                          : c.before === null
                            ? 'created'
                            : 'deleted'}
                    </li>
                  ))}
                  {detail.length > 200 && <li className="muted">…and {detail.length - 200} more</li>}
                </ul>
                <div className="button-row">
                  {isOpenPlan ? (
                    firstProject && (
                      <button type="button" className="btn btn-small" onClick={() => jumpTo('projects', `p:${firstProject}`)}>
                        Show in grid
                      </button>
                    )
                  ) : (
                    <button type="button" className="btn btn-small" onClick={() => openSharedPlan(e.planId)}>
                      Open this plan
                    </button>
                  )}
                  {isOpenPlan && can.edit && (
                    <button
                      type="button"
                      className="btn btn-small"
                      title="Undo this change where nobody has changed the same things since"
                      onClick={() => revertBatch(e.batchId).then(() => toast('Undone.', 'info'), (err: Error) => toast(err.message))}
                    >
                      Undo this change
                    </button>
                  )}
                </div>
              </>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
