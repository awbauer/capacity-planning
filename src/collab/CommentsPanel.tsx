import { useEffect, useMemo, useState } from 'react';
import {
  anchorLabel,
  excerpt,
  isEmptyThread,
  isResolved,
  lastActivity,
  liveComments,
  sameAnchor,
  threadMentions,
  threadsOnCell,
  threadsOnRow,
  type CommentAnchor,
  type Thread,
} from '../domain/comments';
import { newId } from '../domain/ids';
import { weeksBetween } from '../domain/weeks';
import { useCollabStore } from '../store/collabStore';
import { usePlan, usePlanMeta } from '../store/planStore';
import { addComment, markThreadRead, showComments, threadRow } from '../store/sharedPlanStore';
import { useUIStore } from '../store/uiStore';
import { useCanComment } from '../store/useCan';
import { when } from './format';
import { MentionInput } from './MentionInput';
import { ThreadView } from './ThreadView';
import { useNameOf } from './useNameOf';

type Status = 'open' | 'resolved' | 'all';

/** Threads on what an anchor points at: overlapping cells, or the same row (a role's cells included). */
function threadsAt(threads: Thread[], a: CommentAnchor): Thread[] {
  if (a.kind === 'cells') return threadsOnCell(threads, a.roleId, weeksBetween(a.from, a.to));
  if (a.kind === 'role') return threads.filter((t) => (t.anchor.kind === 'role' || t.anchor.kind === 'cells') && t.anchor.roleId === a.roleId);
  if (a.kind === 'project') return threadsOnRow(threads, { kind: 'project', id: a.projectId });
  return threadsOnRow(threads, { kind: 'resource', id: a.resourceId });
}

/**
 * Comments side panel (shared mode): one thread, the threads on a cell or
 * row with a box to start one, or every thread in the plan.
 */
export function CommentsPanel() {
  const focus = useCollabStore((s) => s.comments);
  const threadMap = useCollabStore((s) => s.threads);
  const loaded = useCollabStore((s) => s.loaded);
  const me = useCollabStore((s) => s.me);
  const toast = useCollabStore((s) => s.toast);
  const plan = usePlan();
  const planId = usePlanMeta().id;
  const live = useCollabStore((s) => s.status === 'live');
  const jumpTo = useUIStore((s) => s.jumpTo);
  const canComment = useCanComment();
  const nameOf = useNameOf();
  const [status, setStatus] = useState<Status>('open');
  const [mineOnly, setMineOnly] = useState(false);
  const threads = useMemo(() => Object.values(threadMap).filter((t) => !isEmptyThread(t)), [threadMap]);

  const focused = focus?.threadId ? threadMap[focus.threadId] : undefined;

  // Opened from a link or the inbox: scroll the grid to the thread's row once it's here.
  useEffect(() => {
    if (!focus?.jump || !focused) return;
    const target = threadRow(focused, plan);
    if (target) jumpTo(target.view, target.row, target.week, target.parents);
    showComments({ threadId: focused.id });
  }, [focus?.jump, focused, plan, jumpTo]);

  // A thread that mentions you, open in front of you, is read.
  useEffect(() => {
    if (live && focused && me && planId && threadMentions(focused).includes(me.email)) void markThreadRead(planId, focused.id);
  }, [focused, me, planId, live]);

  if (!focus) return null;
  const close = () => useCollabStore.getState().set({ comments: null });
  const header = (title: string, back?: boolean) => (
    <div className="comments-head">
      {back && (
        <button type="button" className="link" onClick={() => showComments({})} title="Every thread in this plan">
          ← All
        </button>
      )}
      <h2>{title}</h2>
      <span className="spacer" />
      <button type="button" className="icon-btn" aria-label="Close comments" onClick={close}>
        ×
      </button>
    </div>
  );

  // One thread.
  if (focus.threadId) {
    return (
      <aside className="comments-panel" aria-label="Comments">
        {header('Comment thread', true)}
        {focused ? (
          <ThreadView thread={focused} label={anchorLabel(plan, focused.anchor)} />
        ) : (
          <p className="muted small">{loaded ? 'This thread no longer exists.' : 'Loading…'}</p>
        )}
      </aside>
    );
  }

  // A cell or row: its threads, and a box to start one.
  if (focus.anchor) {
    const anchor = focus.anchor;
    const here = threadsAt(threads, anchor).sort((a, b) => Number(isResolved(a)) - Number(isResolved(b)) || a.createdAt - b.createdAt);
    return (
      <aside className="comments-panel" aria-label="Comments">
        {header('Comments', true)}
        <p className="comments-where">{anchorLabel(plan, anchor)}</p>
        {here.map((t) => (
          <ThreadView key={t.id} thread={t} label={sameAnchor(t.anchor, anchor) ? undefined : anchorLabel(plan, t.anchor)} />
        ))}
        {canComment ? (
          <div className="thread new-thread">
            <MentionInput
              autoFocus
              submitLabel="Comment"
              placeholder={here.length ? 'Start a new thread…' : 'Add a comment…'}
              onSubmit={(body) =>
                addComment({ threadId: newId(), commentId: newId(), anchor, body }).catch((e: Error) => {
                  toast(e.message);
                  throw e;
                })
              }
            />
          </div>
        ) : (
          <p className="muted small">Reconnecting — comments are paused.</p>
        )}
      </aside>
    );
  }

  // Every thread in the plan.
  const counts = { open: threads.filter((t) => !isResolved(t)).length, resolved: threads.filter(isResolved).length };
  const shown = threads
    .filter((t) => (status === 'all' ? true : status === 'open' ? !isResolved(t) : isResolved(t)))
    .filter((t) => !mineOnly || (me && threadMentions(t).includes(me.email)))
    .sort((a, b) => lastActivity(b).ts - lastActivity(a).ts);
  return (
    <aside className="comments-panel" aria-label="Comments">
      {header('Comments')}
      <div className="comments-filters">
        <nav className="segmented small" aria-label="Thread status">
          {(['open', 'resolved', 'all'] as Status[]).map((s) => (
            <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>
              {s === 'open' ? `Open ${counts.open}` : s === 'resolved' ? `Resolved ${counts.resolved}` : 'All'}
            </button>
          ))}
        </nav>
        <label className="small">
          <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> Mentions me
        </label>
      </div>
      {shown.length === 0 ? (
        <p className="muted small">
          {threads.length === 0
            ? 'No comments in this plan yet. Right-click a cell (or press M) or use a row’s 💬 button to start one.'
            : 'No threads match.'}
        </p>
      ) : (
        <ul className="thread-list">
          {shown.map((t) => {
            const kept = liveComments(t);
            const last = kept[kept.length - 1];
            const act = lastActivity(t);
            return (
              <li key={t.id}>
                <button type="button" onClick={() => showComments({ threadId: t.id, jump: true })}>
                  <span className="conflict-title">
                    {anchorLabel(plan, t.anchor)} {isResolved(t) && <span className="badge">Resolved</span>}
                  </span>
                  {last && (
                    <span className="small">
                      <strong>{nameOf(last.author)}:</strong> {excerpt(last.body, 120, nameOf)}
                    </span>
                  )}
                  <span className="muted small">
                    {kept.length} comment{kept.length === 1 ? '' : 's'} · {when(act.ts)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
