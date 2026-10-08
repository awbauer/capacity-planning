import { useState } from 'react';
import type { Project } from '../domain/types';
import { addWeeks, formatWeek, normalizeWeek, weeksApart } from '../domain/weeks';
import { usePlanStore } from '../store/planStore';
import { useDerived } from '../store/useDerived';
import { Modal } from './Modal';
import { SellerPicker } from './SellerPicker';
import { StatusSelect } from './StatusControls';
import { TagPicker } from './TagPicker';

interface Props {
  /** Omit to create a new project. */
  project?: Project;
  onClose: () => void;
}

export function ProjectDialog({ project, onClose }: Props) {
  const addProject = usePlanStore((s) => s.addProject);
  const updateProject = usePlanStore((s) => s.updateProject);
  const deleteProject = usePlanStore((s) => s.deleteProject);
  const d = useDerived();
  const [draft, setDraft] = useState<Omit<Project, 'id'>>(
    project ?? { name: '', client: '', sellerId: null, status: 'pipeline', tagIds: [], notes: '' },
  );
  const set = (patch: Partial<Omit<Project, 'id'>>) => setDraft((p) => ({ ...p, ...patch }));
  const [moveStaffing, setMoveStaffing] = useState(true);

  // A slipped (or pulled-in) start date: offer to move the delivery staffing with it.
  const oldStart = project?.startWeek;
  const slip = oldStart && draft.startWeek && draft.startWeek !== oldStart ? weeksApart(oldStart, draft.startWeek) : 0;
  const rowsToMove = project
    ? [...(d.assignmentsByProject.get(project.id) ?? []), ...(d.rolesByProject.get(project.id) ?? [])].filter((a) =>
        Object.keys(a.weekly).some((w) => w >= oldStart! && a.weekly[w] > 0),
      )
    : [];
  const offerShift = slip !== 0 && rowsToMove.length > 0;
  const shiftEnd = offerShift && moveStaffing && !!project?.endWeek && draft.endWeek === project.endWeek;
  const effectiveDraft = shiftEnd ? { ...draft, endWeek: addWeeks(project!.endWeek!, slip) } : draft;

  const datesInvalid =
    !!effectiveDraft.startWeek && !!effectiveDraft.endWeek && effectiveDraft.endWeek < effectiveDraft.startWeek;
  const canSave = draft.name.trim() !== '' && !datesInvalid;

  const save = () => {
    if (!canSave) return;
    const clean = {
      ...effectiveDraft,
      name: draft.name.trim(),
      client: draft.client?.trim() || undefined,
      notes: draft.notes?.trim() || undefined,
    };
    if (project) updateProject(project.id, clean, offerShift && moveStaffing ? { from: oldStart!, weeks: slip } : undefined);
    else addProject(clean);
    onClose();
  };

  const remove = () => {
    if (!project) return;
    const n = d.assignmentsByProject.get(project.id)?.length ?? 0;
    const msg = n
      ? `Delete ${project.name} and its ${n} assignment(s)? You can undo with Ctrl+Z.`
      : `Delete ${project.name}?`;
    if (window.confirm(msg)) {
      deleteProject(project.id);
      onClose();
    }
  };

  return (
    <Modal
      title={project ? 'Edit workstream' : 'New workstream'}
      onClose={onClose}
      footer={
        <>
          {project && (
            <button type="button" className="btn btn-danger" onClick={remove}>
              Delete
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="project-form" className="btn btn-primary" disabled={!canSave}>
            {project ? 'Save' : 'Create workstream'}
          </button>
        </>
      }
    >
      <form
        id="project-form"
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label>
          Name
          <input autoFocus required value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label>
          Client
          <input value={draft.client ?? ''} onChange={(e) => set({ client: e.target.value })} />
        </label>
        <div className="form-row">
          <label>
            Seller
            <SellerPicker value={draft.sellerId} onChange={(sellerId) => set({ sellerId })} />
          </label>
          <label>
            Status
            <StatusSelect value={draft.status} onChange={(status) => set({ status })} />
          </label>
        </div>
        <p className="muted small form-note">
          Weeks before the start date are presales and always count toward people&apos;s load. From the start date
          they&apos;re delivery: counted once Won, tentative (“at risk”) while Pipeline, not counted if Lost. With no
          start date, a Pipeline workstream is all presales.
        </p>
        <div className="label-like">
          Required capabilities
          <TagPicker value={draft.tagIds} onChange={(tagIds) => set({ tagIds })} />
        </div>
        <div className="form-row">
          <label>
            Start (week of)
            <input
              type="date"
              value={draft.startWeek ?? ''}
              onChange={(e) => set({ startWeek: e.target.value ? normalizeWeek(e.target.value) : undefined })}
            />
          </label>
          <label>
            End (week of)
            <input
              type="date"
              value={draft.endWeek ?? ''}
              onChange={(e) => set({ endWeek: e.target.value ? normalizeWeek(e.target.value) : undefined })}
            />
          </label>
        </div>
        {offerShift && (
          <label className="checkbox-row shift-offer">
            <input type="checkbox" checked={moveStaffing} onChange={(e) => setMoveStaffing(e.target.checked)} />
            <span>
              Move the delivery staffing too: shift the weeks from {formatWeek(oldStart!)} on for{' '}
              {rowsToMove.length} {rowsToMove.length === 1 ? 'row' : 'rows'} by {slip > 0 ? '+' : '−'}
              {Math.abs(slip)} {Math.abs(slip) === 1 ? 'week' : 'weeks'}
              {shiftEnd && <>, and the end date to {formatWeek(effectiveDraft.endWeek!)}</>}.{' '}
              <span className="muted small">
                Presales weeks before {formatWeek(oldStart!)} stay put. Unticked, only the date moves and staffed weeks
                before the new start count as presales.
              </span>
            </span>
          </label>
        )}
        {datesInvalid && <p className="warn-text">End must be on or after start.</p>}
        <label>
          Notes
          <textarea rows={3} value={draft.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />
        </label>
      </form>
    </Modal>
  );
}
