import type { ProjectStatus } from '../domain/types';
import { STATUS_LABELS } from '../domain/labels';
import { LIKELY_WIN, type Severity } from '../domain/load';


interface StatusSelectProps {
  value: ProjectStatus;
  onChange: (status: ProjectStatus) => void;
  compact?: boolean;
  disabled?: boolean;
}

export function StatusSelect({ value, onChange, compact, disabled }: StatusSelectProps) {
  return (
    <select
      disabled={disabled}
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
  /** At risk only through pipeline work under LIKELY_WIN% likely to be won. */
  lowRisk?: boolean;
}

/** Warnings shown under an allocation row's name. */
export function AssignmentBadges({ worst, mismatch, lowRisk }: AssignmentBadgesProps) {
  if (!worst && !mismatch) return null;
  return (
    <span className="row-badges">
      {worst === 'over' && <span className="badge badge-danger">⚠ Overallocated</span>}
      {worst === 'stretch' && <span className="badge badge-stretch">Stretched</span>}
      {worst === 'risk' && (
        <span
          className={lowRisk ? 'badge badge-risk low' : 'badge badge-risk'}
          title={
            lowRisk
              ? `Over capacity only if pipeline work under ${LIKELY_WIN}% likely to be won comes through`
              : 'Over capacity if pipeline work is won'
          }
        >
          {lowRisk ? 'Low risk' : 'At risk'}
        </span>
      )}
      {mismatch && (
        <span className="badge badge-warn" title="This person has none of the workstream's required capabilities">
          Skill mismatch
        </span>
      )}
    </span>
  );
}
