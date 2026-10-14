import { useEffect, useRef, useState } from 'react';
import { newId } from '../domain/ids';
import { exempt, lockCoversCell, type Lock, type NewLock } from '../domain/locks';
import type { Assignment, WeekKey } from '../domain/types';
import { formatWeek, formatWeekRange } from '../domain/weeks';
import { Modal } from '../components/Modal';
import { useCollabStore } from '../store/collabStore';
import { addLock, removeLock, showComments } from '../store/sharedPlanStore';
import { useCan } from '../store/useCan';
import { useDerived } from '../store/useDerived';
import { cellCommentAnchor } from './commentAnchors';
import { roleTitle } from './format';
import { HistoryPanel } from './HistoryPanel';

export interface CellMenuTarget {
  /** The cell right-clicked. */
  cell: Assignment;
  cellWeeks: WeekKey[];
  /** The selection it belongs to (or just the cell). */
  roles: Assignment[];
  weeks: WeekKey[];
  /** Where to show the menu; null opens a direct action. */
  at: { x: number; y: number } | null;
  direct?: 'history' | 'comments';
}

/** Right-click menu on a grid cell in shared mode: history, locks. */
export function CellMenu({ target, onClose }: { target: CellMenuTarget; onClose: () => void }) {
  const d = useDerived();
  const can = useCan();
  const me = useCollabStore((s) => s.me);
  const locks = useCollabStore((s) => s.locks);
  const thisWeek = useCollabStore((s) => s.thisWeek);
  const toast = useCollabStore((s) => s.toast);
  const [history, setHistory] = useState(target.direct === 'history');
  const ref = useRef<HTMLDivElement>(null);
  const { cell, roles, weeks } = target;
  const project = d.projectsById.get(cell.projectId);
  const person = cell.resourceId ? d.resourcesById.get(cell.resourceId)?.name : undefined;

  useEffect(() => {
    if (history) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [history, onClose]);

  if (history) {
    const label = `${roleTitle(cell, person)} on ${project?.name ?? '?'}`;
    const span = target.cellWeeks.length > 1 ? formatWeekRange(target.cellWeeks[0], target.cellWeeks.at(-1)!) : formatWeek(target.cellWeeks[0]);
    return (
      <Modal title={`History: ${label}, ${span}`} onClose={onClose} wide>
        <HistoryPanel query={{ roleId: cell.id, weeks: target.cellWeeks }} />
      </Modal>
    );
  }

  const lock = (l: NewLock) => {
    onClose();
    const note = window.prompt('Note for this lock (optional), e.g. “SOW signed”:', '');
    if (note === null) return;
    addLock({ ...l, ...(note.trim() ? { note: note.trim().slice(0, 200) } : {}) } as NewLock).then(
      () => toast('Locked.', 'info'),
      (e: Error) => toast(e.message),
    );
  };
  const user = { email: me?.email ?? '', admin: me?.role === 'admin' };
  const here = locks.filter((l) => target.cellWeeks.some((w) => lockCoversCell(l, cell, w, thisWeek)));
  const canRemove = (l: Lock) => can.edit && (user.admin || (l.scope !== 'past' && l.owner === user.email));
  const lockLabel = (l: Lock) =>
    l.scope === 'past' ? 'past weeks' : l.scope === 'project' ? 'the workstream' : l.scope === 'role' ? 'this role' : 'these cells';
  const span = weeks.length > 1 ? formatWeekRange(weeks[0], weeks.at(-1)!) : formatWeek(weeks[0]);
  const pos = target.at ?? { x: 200, y: 200 };

  return (
    <div
      ref={ref}
      className="cell-menu"
      role="menu"
      style={{ left: Math.min(pos.x, window.innerWidth - 300), top: Math.min(pos.y, window.innerHeight - 260) }}
    >
      <button type="button" role="menuitem" onClick={() => setHistory(true)}>
        History of this cell… <kbd>H</kbd>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onClose();
          showComments({ anchor: cellCommentAnchor(target) });
        }}
      >
        Comment… <kbd>M</kbd>
      </button>
      {can.edit && (
        <>
          <hr />
          <button
            type="button"
            role="menuitem"
            onClick={() => lock({ scope: 'cells', id: newId(), roleIds: roles.map((r) => r.id), from: weeks[0], to: weeks.at(-1)! })}
          >
            Lock {roles.length > 1 ? `${roles.length} roles` : 'cells'}, {span}…
          </button>
          <button type="button" role="menuitem" onClick={() => lock({ scope: 'role', id: newId(), roleId: cell.id })}>
            Lock this role ({roleTitle(cell, person)})…
          </button>
          {project && (
            <button type="button" role="menuitem" onClick={() => lock({ scope: 'project', id: newId(), projectId: project.id })}>
              Lock workstream {project.name}…
            </button>
          )}
        </>
      )}
      {here.length > 0 && <hr />}
      {here.map((l) =>
        canRemove(l) ? (
          <button
            key={l.id}
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              removeLock(l.id).then(
                () => toast('Unlocked.', 'info'),
                (e: Error) => toast(e.message),
              );
            }}
          >
            Unlock {lockLabel(l)}
            {l.owner !== user.email && l.scope !== 'past' ? ` (set by ${l.owner})` : ''}
          </button>
        ) : (
          <div key={l.id} className="cell-menu-note">
            🔒 {lockLabel(l)} locked by {l.scope === 'past' ? 'an admin' : l.owner}
            {exempt(l, user) ? ' (you can edit)' : ''}
            {l.note ? ` — “${l.note}”` : ''}
          </div>
        ),
      )}
    </div>
  );
}
