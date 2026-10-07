import type { ProjectStatus } from '../domain/types';
import { STATUS_LABELS } from '../domain/labels';
import type { Severity } from '../domain/load';


interface StatusSelectProps {
  value: ProjectStatus;
  onChange: (status: ProjectStatus) => void;
  compact?: boolean;
}

export function StatusSelect({ value, onChange, compact }: StatusSelectProps) {
  return (
    <select
      className={`status-select status-${value}${compact ? ' compact' : ''}`}
      aria-label="Workstream status"
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

interface AssignmentBadgesProps {
  worst: Severity | null;
  mismatch: boolean;
}

/** Warnings shown under an allocation row's name. */
export function AssignmentBadges({ worst, mismatch }: AssignmentBadgesProps) {
  if (!worst && !mismatch) return null;
  return (
    <div className="row-badges">
      {worst === 'over' && <span className="badge badge-danger">⚠ Overallocated</span>}
      {worst === 'stretch' && <span className="badge badge-stretch">Stretched</span>}
      {worst === 'risk' && (
        <span className="badge badge-risk" title="Over capacity only if pipeline work is won">
          At risk
        </span>
      )}
      {mismatch && (
        <span className="badge badge-warn" title="This person has none of the workstream's required capabilities">
          Skill mismatch
        </span>
      )}
    </div>
  );
}
