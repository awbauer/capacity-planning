import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { excerpt } from '../domain/comments';
import { useCollabStore } from '../store/collabStore';
import { loadPeople, openThread, refreshMentionCounts, setMentionEmails } from '../store/sharedPlanStore';
import { when } from './format';
import { useNameOf } from './useNameOf';

type Status = 'open' | 'resolved' | 'all';

interface MentionEntry {
  planId: string;
  planName: string;
  threadId: string;
  label: string;
  resolved: boolean;
  lastTs: number;
  lastActor: string;
  lastExcerpt: string;
  commentCount: number;
  unread: boolean;
}

const TABS: { id: Status; label: string }[] = [
  { id: 'open', label: 'Unresolved' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'all', label: 'All' },
];

/** Every comment thread that mentions you, across plans: unresolved first, with what's new. */
export function MentionsView() {
  const counts = useCollabStore((s) => s.mentionCounts);
  const prefs = useCollabStore((s) => s.prefs);
  const toast = useCollabStore((s) => s.toast);
  const nameOf = useNameOf();
  const [status, setStatus] = useState<Status>('open');
  const [entries, setEntries] = useState<MentionEntry[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const requestNo = useRef(0);

  const load = useCallback(
    async (cursor?: string) => {
      const no = ++requestNo.current;
      setLoading(true);
      try {
        const q = new URLSearchParams({ status, ...(cursor ? { cursor } : {}) });
        const r = await api<{ entries: MentionEntry[]; next?: string; counts: { open: number; unreadOpen: number } }>(`/api/mentions?${q}`);
        if (no !== requestNo.current) return;
        setEntries((prev) => (cursor ? [...prev, ...r.entries.filter((e) => !prev.some((p) => p.planId === e.planId && p.threadId === e.threadId))] : r.entries));
        setNext(r.next);
        useCollabStore.getState().set({ mentionCounts: r.counts });
      } catch (e) {
        if (no === requestNo.current) toast(e instanceof Error ? e.message : String(e));
      } finally {
        if (no === requestNo.current) setLoading(false);
      }
    },
    [status, toast],
  );

  useEffect(() => {
    void loadPeople();
  }, []);

  // Reload on a tab change, and when the badge says something changed.
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load, counts.open, counts.unreadOpen]);

  return (
    <div className="activity mentions">
      <div className="activity-filters">
        <nav className="segmented" aria-label="Thread status">
          {TABS.map((t) => (
            <button key={t.id} type="button" aria-pressed={status === t.id} onClick={() => setStatus(t.id)}>
              {t.label}
              {t.id === 'open' && counts.open > 0 && <span className="count">{counts.open}</span>}
            </button>
          ))}
        </nav>
        <button type="button" className="btn" onClick={() => void refreshMentionCounts().then(() => load())}>
          Refresh
        </button>
        <span className="spacer" />
        {prefs?.mail && (
          <label className="small" title="Mentions are emailed about a minute later, unless you've seen the thread by then">
            <input
              type="checkbox"
              checked={prefs.mentionEmails}
              onChange={(e) => setMentionEmails(e.target.checked).catch((err: Error) => toast(err.message))}
            />{' '}
            Email me when I’m mentioned
          </label>
        )}
      </div>
      {entries.length === 0 && !loading ? (
        <p className="muted">
          {status === 'open'
            ? 'Nothing unresolved mentions you.'
            : status === 'resolved'
              ? 'No resolved threads mention you.'
              : 'No comment threads mention you yet. When someone writes @your name in a comment, it shows up here.'}
        </p>
      ) : (
        <table className="table activity-table mentions-table">
          <thead>
            <tr>
              <th aria-label="Unread" />
              <th>Where</th>
              <th>Latest</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr
                key={`${e.planId}/${e.threadId}`}
                className={e.unread ? 'activity-row clickable unread' : 'activity-row clickable'}
                data-thread={e.threadId}
                onClick={() => openThread(e.planId, e.threadId)}
              >
                <td>{e.unread && <span className="unread-dot" title="New since you last looked" />}</td>
                <td>
                  <div>
                    <strong>{e.label}</strong> {e.resolved && <span className="badge">Resolved</span>}
                  </div>
                  <div className="muted small">{e.planName}</div>
                </td>
                <td className="small">
                  <strong>{nameOf(e.lastActor)}:</strong> {excerpt(e.lastExcerpt, 140, nameOf)}
                  <div className="muted small">
                    {e.commentCount} comment{e.commentCount === 1 ? '' : 's'}
                  </div>
                </td>
                <td className="nowrap small">{when(e.lastTs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {next && (
        <button type="button" className="btn" disabled={loading} onClick={() => void load(next)}>
          {loading ? 'Loading…' : 'Older threads'}
        </button>
      )}
    </div>
  );
}
