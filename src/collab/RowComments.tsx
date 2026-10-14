import { isOpenThread, type CommentAnchor } from '../domain/comments';
import { useCollabStore } from '../store/collabStore';
import { isShared } from '../store/mode';
import { showComments } from '../store/sharedPlanStore';

type RowKind = 'role' | 'project' | 'resource';

const anchorFor = (kind: RowKind, id: string): CommentAnchor =>
  kind === 'role' ? { kind: 'role', roleId: id } : kind === 'project' ? { kind: 'project', projectId: id } : { kind: 'resource', resourceId: id };

/** Open threads on a row as a whole (for a role, its cells' threads too). */
function useOpenCount(kind: RowKind, id: string): number {
  return useCollabStore((s) => {
    let n = 0;
    for (const t of Object.values(s.threads)) {
      if (!isOpenThread(t)) continue;
      const a = t.anchor;
      if (kind === 'role' ? (a.kind === 'role' || a.kind === 'cells') && a.roleId === id : kind === 'project' ? a.kind === 'project' && a.projectId === id : a.kind === 'resource' && a.resourceId === id) {
        n++;
      }
    }
    return n;
  });
}

/** A row's comment button (shared mode): opens its threads, showing how many are open. */
export function RowComments({ kind, id, name }: { kind: RowKind; id: string; name: string }) {
  if (!isShared()) return null;
  return <RowCommentsButton kind={kind} id={id} name={name} />;
}

function RowCommentsButton({ kind, id, name }: { kind: RowKind; id: string; name: string }) {
  const open = useOpenCount(kind, id);
  return (
    <button
      type="button"
      className={open ? 'row-comment has' : 'row-comment'}
      aria-label={`Comments on ${name}${open ? ` (${open} open)` : ''}`}
      title={open ? `${open} open comment thread${open === 1 ? '' : 's'} on this row` : 'Comment on this row'}
      onClick={() => showComments({ anchor: anchorFor(kind, id) })}
    >
      💬{open > 0 && <span className="count">{open}</span>}
    </button>
  );
}
