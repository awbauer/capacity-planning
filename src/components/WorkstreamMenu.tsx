import { useState } from 'react';
import { slug, workstreamCsv } from '../domain/csv';
import type { Project } from '../domain/types';
import { usePlan } from '../store/planStore';
import { useUIStore, workstreamGroupKeys } from '../store/uiStore';
import { useCan } from '../store/useCan';
import { AddAssignmentDialog } from './AddAssignmentDialog';
import { downloadText, today } from './download';
import { MenuItem, Popover } from './Popover';
import { ProjectDialog } from './ProjectDialog';
import { RoleDialog } from './RoleDialog';

/** A workstream's ••• menu outside the timeline (Kanban cards and details), with the dialogs it opens. */
export function WorkstreamMenu({ project: p, className }: { project: Project; className: string }) {
  const plan = usePlan();
  const can = useCan();
  const showDetails = useUIStore((s) => s.showDetails);
  const jumpTo = useUIStore((s) => s.jumpTo);
  const [dialog, setDialog] = useState<'edit' | 'person' | 'role' | null>(null);
  return (
    <>
      <Popover className={className} label="•••" ariaLabel={`Actions for ${p.name}`}>
        {can.edit && <MenuItem onClick={() => setDialog('edit')}>Edit workstream…</MenuItem>}
        {can.edit && <MenuItem onClick={() => setDialog('person')}>Add a person…</MenuItem>}
        {can.edit && (
          <MenuItem onClick={() => setDialog('role')} title="Add demand you haven't chosen a person for yet">
            Add an open role…
          </MenuItem>
        )}
        <MenuItem onClick={() => jumpTo('projects', `p:${p.id}`, p.startWeek, workstreamGroupKeys(p))}>Show on timeline</MenuItem>
        <MenuItem onClick={() => showDetails({ kind: 'project', id: p.id })}>Checks and roles</MenuItem>
        <MenuItem
          onClick={() => downloadText(`staffing-${slug(p.name)}-${today()}.csv`, workstreamCsv(plan, p.id), 'text/csv')}
          title="Download this workstream's staffing plan as CSV"
        >
          Download CSV
        </MenuItem>
      </Popover>
      {dialog === 'edit' && <ProjectDialog project={p} onClose={() => setDialog(null)} />}
      {dialog === 'person' && <AddAssignmentDialog projectId={p.id} onClose={() => setDialog(null)} />}
      {dialog === 'role' && <RoleDialog projectId={p.id} onClose={() => setDialog(null)} />}
    </>
  );
}
