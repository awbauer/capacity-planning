import { useState } from 'react';
import { bodyParts, isResolved, type Comment, type Thread } from '../domain/comments';
import { colorFor } from '../domain/colors';
import { newId } from '../domain/ids';
import { useCollabStore } from '../store/collabStore';
import { addComment, deleteComment, editComment, setThreadResolved } from '../store/sharedPlanStore';
import { useCanComment } from '../store/useCan';
import { MentionInput } from './MentionInput';
import { initials, when } from './format';
import { useNameOf } from './useNameOf';

/** A comment's text with mentions shown as @Name (yours highlighted). */
export function CommentText({ body }: { body: string }) {
  const nameOf = useNameOf();
  const me = useCollabStore((s) => s.me?.email);
  return (
    <span className="comment-text">
      {bodyParts(body).map((p, i) =>
        'mention' in p ? (
          <span key={i} className={p.mention === me ? 'mention mention-me' : 'mention'} title={p.mention}>
            @{nameOf(p.mention)}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  );
}

/** One thread: its comments, a reply box, and resolve/reopen. */
export function ThreadView({ thread, label }: { thread: Thread; label?: string }) {
  const toast = useCollabStore((s) => s.toast);
  const canComment = useCanComment();
  const nameOf = useNameOf();
  const resolved = isResolved(thread);
  const fail = (e: Error) => {
    toast(e.message);
    throw e;
  };

  return (
    <div className={resolved ? 'thread resolved' : 'thread'} data-thread={thread.id}>
      <div className="thread-head">
        {label && <span className="thread-label">{label}</span>}
        {resolved && <span className="badge">Resolved</span>}
        <span className="spacer" />
        {canComment && (
          <button
            type="button"
            className="btn btn-small"
            onClick={() => setThreadResolved(thread.id, !resolved).catch((e: Error) => toast(e.message))}
          >
            {resolved ? 'Reopen' : 'Resolve'}
          </button>
        )}
      </div>
      <ol className="comments">
        {thread.comments.map((c) => (
          <CommentItem key={c.id} thread={thread} comment={c} nameOf={nameOf} />
        ))}
      </ol>
      {resolved && (
        <p className="resolved-by">
          ✓ Resolved by <strong title={thread.resolvedBy}>{thread.resolvedBy ? nameOf(thread.resolvedBy) : 'someone'}</strong> ·{' '}
          <time dateTime={new Date(thread.resolvedAt!).toISOString()}>{when(thread.resolvedAt!)}</time>
        </p>
      )}
      {canComment && (
        <MentionInput
          key={thread.id}
          submitLabel={resolved ? 'Reply and reopen' : 'Reply'}
          placeholder="Reply…"
          onSubmit={(body) => addComment({ threadId: thread.id, commentId: newId(), body }).catch(fail)}
        />
      )}
    </div>
  );
}

function CommentItem({ thread, comment: c, nameOf }: { thread: Thread; comment: Comment; nameOf: (e: string) => string }) {
  const me = useCollabStore((s) => s.me);
  const toast = useCollabStore((s) => s.toast);
  const canComment = useCanComment();
  const [editing, setEditing] = useState(false);
  const mine = c.author === me?.email;
  const canDelete = canComment && !c.deleted && (mine || me?.role === 'admin');

  return (
    <li className={c.deleted ? 'comment deleted' : 'comment'} data-comment={c.id}>
      <span className="avatar" style={{ background: colorFor(c.author) }} title={c.author}>
        {initials(nameOf(c.author))}
      </span>
      <div className="comment-main">
        <div className="comment-head">
          <strong>{nameOf(c.author)}</strong>
          <span className="muted small">{when(c.createdAt)}</span>
          {c.editedAt && !c.deleted && (
            <span className="muted small" title={`Edited ${when(c.editedAt)}`}>
              (edited)
            </span>
          )}
          <span className="spacer" />
          {canComment && mine && !c.deleted && !editing && (
            <button type="button" className="link small" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          {canDelete && !editing && (
            <button
              type="button"
              className="link small"
              onClick={() => {
                if (!window.confirm(mine ? 'Delete your comment?' : `Delete ${nameOf(c.author)}’s comment?`)) return;
                deleteComment(thread.id, c.id).catch((e: Error) => toast(e.message));
              }}
            >
              Delete
            </button>
          )}
        </div>
        {c.deleted ? (
          <p className="muted small">
            Comment deleted{c.deleted.by !== c.author ? ` by ${nameOf(c.deleted.by)}` : ''} · {when(c.deleted.at)}
          </p>
        ) : editing ? (
          <MentionInput
            initial={c.body}
            autoFocus
            submitLabel="Save"
            onCancel={() => setEditing(false)}
            onSubmit={(body) =>
              editComment(thread.id, c.id, body).then(
                () => setEditing(false),
                (e: Error) => {
                  toast(e.message);
                  throw e;
                },
              )
            }
          />
        ) : (
          <p className="comment-body">
            <CommentText body={c.body} />
          </p>
        )}
      </div>
    </li>
  );
}
