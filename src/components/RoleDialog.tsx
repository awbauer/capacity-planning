import { useState } from 'react';
import { CLICK_STEPS } from '../domain/steps';
import { CAREER_LEVELS, type CareerLevel, type OpenRole, type WeekKey } from '../domain/types';
import { addWeeks, currentWeek, normalizeWeek, weeksBetween } from '../domain/weeks';
import { usePlanStore } from '../store/planStore';
import { useDerived } from '../store/useDerived';
import { Modal } from './Modal';
import { TagPicker } from './TagPicker';

type Props = { onClose: () => void } & ({ projectId: string; role?: never } | { role: OpenRole; projectId?: never });

/**
 * Adds an open role to a workstream (what's needed, at what %, when), or
 * edits an existing role's description. Its weeks are edited in the grid.
 */
export function RoleDialog({ projectId, role, onClose }: Props) {
  const d = useDerived();
  const addRole = usePlanStore((s) => s.addRole);
  const updateRole = usePlanStore((s) => s.updateRole);
  const project = d.projectsById.get(role?.projectId ?? projectId!);

  const [name, setName] = useState(role?.name ?? '');
  const [level, setLevel] = useState<CareerLevel | undefined>(role?.level);
  const [tagIds, setTagIds] = useState<string[]>(role?.tagIds ?? project?.tagIds ?? []);
  const [percent, setPercent] = useState(50);
  const defaultFrom = project?.startWeek ?? currentWeek();
  const [range, setRange] = useState<{ from: WeekKey; to: WeekKey }>({
    from: defaultFrom,
    to: project?.endWeek && project.endWeek >= defaultFrom ? project.endWeek : addWeeks(defaultFrom, 11),
  });

  const suggestion = tagIds.length ? `${d.tagsById.get(tagIds[0])?.name ?? ''} consultant` : 'Consultant';
  const finalName = name.trim() || suggestion;
  const canSave = range.from <= range.to;

  const save = () => {
    if (!canSave || !project) return;
    if (role) updateRole(role.id, { name: finalName, level, tagIds });
    else addRole(project.id, { name: finalName, level, tagIds }, { percent, ...range });
    onClose();
  };

  return (
    <Modal
      title={role ? 'Edit open role' : `Add an open role to ${project?.name ?? 'workstream'}`}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="role-form" className="btn btn-primary" disabled={!canSave}>
            {role ? 'Save' : 'Add role'}
          </button>
        </>
      }
    >
      <form
        id="role-form"
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <p className="muted small form-note">
          Demand you haven&apos;t picked a person for yet. It shows on the workstream and in demand vs bench, but isn&apos;t
          anyone&apos;s load until you fill it.
        </p>
        <div className="form-row">
          <label>
            Role
            <input autoFocus value={name} placeholder={suggestion} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Level
            <select
              aria-label="Career level"
              value={level ?? ''}
              onChange={(e) => setLevel((e.target.value || undefined) as CareerLevel | undefined)}
            >
              <option value="">Any</option>
              {CAREER_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="label-like">
          Capabilities needed
          <TagPicker value={tagIds} onChange={setTagIds} />
        </div>
        {!role && (
          <div className="form-row">
            <div className="label-like">
              Allocation
              <div className="segmented" role="group" aria-label="Allocation">
                {CLICK_STEPS.filter((v) => v > 0).map((v) => (
                  <button key={v} type="button" aria-pressed={percent === v} onClick={() => setPercent(v)}>
                    {v}%
                  </button>
                ))}
              </div>
            </div>
            <label>
              From week of
              <input
                type="date"
                value={range.from}
                onChange={(e) => e.target.value && setRange({ ...range, from: normalizeWeek(e.target.value) })}
              />
            </label>
            <label>
              Through week of
              <input
                type="date"
                value={range.to}
                onChange={(e) => e.target.value && setRange({ ...range, to: normalizeWeek(e.target.value) })}
              />
            </label>
            <span className="muted small form-hint">{weeksBetween(range.from, range.to).length} weeks</span>
          </div>
        )}
        {!canSave && <p className="warn-text">The end must be on or after the start.</p>}
      </form>
    </Modal>
  );
}
