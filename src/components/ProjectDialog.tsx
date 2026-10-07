import { useState } from 'react';
import type { Project } from '../domain/types';
import { normalizeWeek } from '../domain/weeks';
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
  const datesInvalid = !!draft.startWeek && !!draft.endWeek && draft.endWeek < draft.startWeek;
  const canSave = draft.name.trim() !== '' && !datesInvalid;

  const save = () => {
    if (!canSave) return;
    const clean = { ...draft, name: draft.name.trim(), client: draft.client?.trim() || undefined, notes: draft.notes?.trim() || undefined };
    if (project) updateProject(project.id, clean);
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
      title={project ? 'Edit project' : 'New project'}
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
            {project ? 'Save' : 'Create project'}
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
          Presales time always counts toward people&apos;s load. Delivery time counts once the project is Won, shows as
          tentative (“at risk”) while it&apos;s in Pipeline, and stops counting if it&apos;s Lost.
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
        {datesInvalid && <p className="warn-text">End must be on or after start.</p>}
        <label>
          Notes
          <textarea rows={3} value={draft.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />
        </label>
      </form>
    </Modal>
  );
}
