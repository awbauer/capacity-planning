import { useState } from 'react';
import { CLICK_STEPS } from '../domain/steps';
import { CAREER_LEVELS, type Assignment, type CareerLevel, type WeekKey } from '../domain/types';
import { addWeeks, currentWeek, normalizeWeek, weeksBetween } from '../domain/weeks';
import { usePlan, usePlanStore } from '../store/planStore';
import { useDerived } from '../store/useDerived';
import { Modal } from './Modal';
import { TagPicker } from './TagPicker';

type Props = { onClose: () => void } & ({ projectId: string; role?: never } | { role: Assignment; projectId?: never });

/**
 * Adds a role to a workstream (what's needed, at what %, when, and
 * optionally who), or edits an existing role's description. Its weeks are
 * edited in the grid; who's in it is changed from the row.
 */
export function RoleDialog({ projectId, role, onClose }: Props) {
  const plan = usePlan();
  const d = useDerived();
  const addRole = usePlanStore((s) => s.addRole);
  const updateRole = usePlanStore((s) => s.updateRole);
  const project = d.projectsById.get(role?.projectId ?? projectId!);

  const [name, setName] = useState(role?.name ?? '');
  const [level, setLevel] = useState<CareerLevel | undefined>(role?.level);
  const [tagIds, setTagIds] = useState<string[]>(role?.tagIds ?? project?.tagIds ?? []);
  const [percent, setPercent] = useState(50);
  const [resourceId, setResourceId] = useState<string | null>(null);
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
    else addRole(project.id, { name: finalName, level, tagIds, resourceId }, { percent, ...range });
    onClose();
  };

  return (
    <Modal
      title={role ? 'Edit role' : `Add a role to ${project?.name ?? 'workstream'}`}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="role-form" className="btn btn-primary" disabled={!canSave}>
            {role ? 'Save' : resourceId ? 'Add role' : 'Add open role'}
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
          A seat on the workstream. Leave it open to show demand you haven&apos;t picked a person for yet (it isn&apos;t
          anyone&apos;s load until filled), or put someone in it now.
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
          <label>
            Person
            <select aria-label="Person" value={resourceId ?? ''} onChange={(e) => setResourceId(e.target.value || null)}>
              <option value="">Leave open</option>
              {[...plan.resources]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.level ? ` (${r.level})` : ''}
                  </option>
                ))}
            </select>
          </label>
        )}
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
