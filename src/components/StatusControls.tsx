import type { AllocationKind, Assignment, ProjectStatus } from '../domain/types';
import type { LoadClass } from '../domain/load';
import { STATUS_LABELS } from '../domain/labels';
import { usePlanStore } from '../store/planStore';


interface StatusSelectProps {
  value: ProjectStatus;
  onChange: (status: ProjectStatus) => void;
  compact?: boolean;
}

export function StatusSelect({ value, onChange, compact }: StatusSelectProps) {
  return (
    <select
      className={`status-select status-${value}${compact ? ' compact' : ''}`}
      aria-label="Project status"
      value={value}
      onChange={(e) => onChange(e.target.value as ProjectStatus)}
    >
      {(Object.keys(STATUS_LABELS) as ProjectStatus[]).map((s) => (
        <option key={s} value={s}>
          {STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  );
}

const KIND_LABELS: Record<AllocationKind, string> = { presales: 'Presales', delivery: 'Delivery' };

/** Chip showing presales/delivery; click to switch. */
export function KindToggle({ assignment }: { assignment: Assignment }) {
  const setAssignmentKind = usePlanStore((s) => s.setAssignmentKind);
  const other: AllocationKind = assignment.kind === 'presales' ? 'delivery' : 'presales';
  return (
    <button
      type="button"
      className={`kind kind-${assignment.kind}`}
      title={`Click to change to ${KIND_LABELS[other]}`}
      onClick={() => {
        if (!setAssignmentKind(assignment.id, other)) {
          window.alert(`This person already has a ${KIND_LABELS[other].toLowerCase()} row on this project.`);
        }
      }}
    >
      {KIND_LABELS[assignment.kind]}
    </button>
  );
}

/** Explains how a row counts when it isn't simply committed. */
export function LoadClassBadge({ cls }: { cls: LoadClass | undefined }) {
  if (cls === 'tentative') {
    return (
      <span className="badge badge-tentative" title="Delivery on a pipeline project: counts toward 'at risk', not 'overallocated'">
        Tentative
      </span>
    );
  }
  if (cls === 'excluded') {
    return (
      <span className="badge" title="Delivery on a lost project: not counted toward load">
        Not counted
      </span>
    );
  }
  return null;
}

interface AssignmentBadgesProps {
  assignment: Assignment;
  cls: LoadClass | undefined;
  over: boolean;
  risk: boolean;
  mismatch: boolean;
}

/** Second line of an allocation row: kind toggle plus any warnings. */
export function AssignmentBadges({ assignment, cls, over, risk, mismatch }: AssignmentBadgesProps) {
  return (
    <div className="row-badges">
      <KindToggle assignment={assignment} />
      <LoadClassBadge cls={cls} />
      {over && <span className="badge badge-danger">⚠ Overallocated</span>}
      {risk && (
        <span className="badge badge-risk" title="Over capacity only if pipeline work is won">
          At risk
        </span>
      )}
      {mismatch && (
        <span className="badge badge-warn" title="This person has none of the project's required capabilities">
          Skill mismatch
        </span>
      )}
    </div>
  );
}
