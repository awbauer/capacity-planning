import type { CommentAnchor } from '../domain/comments';
import type { CellMenuTarget } from './CellMenu';

/** What a comment from the cell menu is about: the selected weeks of the clicked role (or just its cell). */
export function cellCommentAnchor(t: CellMenuTarget): CommentAnchor {
  const weeks = t.roles.length === 1 && t.roles[0].id === t.cell.id ? t.weeks : t.cellWeeks;
  return { kind: 'cells', roleId: t.cell.id, from: weeks[0], to: weeks[weeks.length - 1] };
}
