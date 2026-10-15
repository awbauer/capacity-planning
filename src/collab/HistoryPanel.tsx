import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { EntityKind } from '../domain/diff';
import { formatWeek } from '../domain/weeks';
import { useCollabStore } from '../store/collabStore';
import { usePlanMeta, usePlanStore } from '../store/planStore';
import { revertBatch } from '../store/sharedPlanStore';
import { useCan } from '../store/useCan';
import { when } from './format';

interface Entry {
  seq: number;
  batchId: string;
  ts: number;
  actor: string;
  summary: string;
  kind: EntityKind;
  id: string;
  field: string | null;
  week: string | null;
  before: unknown;
  after: unknown;
}

export type HistoryQuery = { roleId: string; weeks: string[] } | { kind: EntityKind; id: string };


const show = (v: unknown, pct = false): string => {
  if (v === null || v === undefined) return pct ? '0%' : '—';
  if (pct) return `${v}%`;
  if (Array.isArray(v)) return v.length ? `${v.length} item${v.length === 1 ? '' : 's'}` : 'none';
  if (typeof v === 'object') return (v as { name?: string }).name ?? 'set';
  return String(v);
};

const FIELD_LABELS: Record<string, string> = {
  externalId: 'Project ID',
  email: 'email',
  resourceId: 'person',
  sellerId: 'seller',
  tagIds: 'capabilities',
  startWeek: 'start',
  endWeek: 'end',
  winProbability: 'win %',
};

/** Every recorded change to some cells, a workstream or a person, newest first (shared mode). */
export function HistoryPanel({ query }: { query: HistoryQuery }) {
  const meta = usePlanMeta();
  const can = useCan();
  const setAllocations = usePlanStore((s) => s.setAllocations);
  const toast = useCollabStore((s) => s.toast);
  const seq = meta.revision;
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const qs = 'roleId' in query ? `roleId=${encodeURIComponent(query.roleId)}&weeks=${query.weeks.join(',')}` : `kind=${query.kind}&id=${encodeURIComponent(query.id)}`;

  useEffect(() => {
    let live = true;
    api<{ history: Entry[] }>(`/api/plans/${encodeURIComponent(meta.id)}/history?${qs}`)
      .then((r) => live && setEntries(r.history))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
    // Reload when the plan changes (seq), so the list stays current.
  }, [meta.id, qs, seq]);

  if (error) return <p className="error">{error}</p>;
  if (!entries) return <p className="muted">Loading history…</p>;
  if (entries.length === 0) return <p className="muted">No recorded changes yet.</p>;

  const describe = (e: Entry) => {
    if (e.week) return `${formatWeek(e.week)}: ${show(e.before, true)} → ${show(e.after, true)}`;
    if (e.field === null) return e.before === null ? `Created ${e.kind === 'role' ? 'role' : e.kind}` : `Deleted ${e.kind === 'role' ? 'role' : e.kind}`;
    if (e.field === 'weekly') return 'Allocation changed';
    return `${FIELD_LABELS[e.field] ?? e.field}: ${show(e.before)} → ${show(e.after)}`;
  };

  return (
    <ul className="history-list">
      {entries.map((e, i) => (
        <li key={`${e.seq}-${i}`} className="history-item">
          <div className="history-head">
            <strong>{e.actor}</strong>
            <span className="muted small">{when(e.ts)}</span>
          </div>
          <div className="history-change">{describe(e)}</div>
          <div className="muted small">{e.summary}</div>
          {can.edit && (
            <div className="history-actions">
              {e.week && 'roleId' in query && (
                <button
                  type="button"
                  className="link"
                  title="Set this week back to the value before this change"
                  onClick={() =>
                    setAllocations([{ assignmentId: query.roleId, weeks: [e.week!], percent: (e.before as number | null) ?? 0 }])
                  }
                >
                  Restore {show(e.before, true)}
                </button>
              )}
              <button
                type="button"
                className="link"
                title="Undo this whole change, where nobody has changed it since"
                onClick={() => revertBatch(e.batchId).then(() => toast('Undone.', 'info'), (err: Error) => toast(err.message))}
              >
                Undo this change
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
