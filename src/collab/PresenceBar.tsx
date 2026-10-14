import { useCollabStore } from '../store/collabStore';
import { ROLE_LABELS } from '../domain/permissions';
import { initials } from './format';


const VIEW_LABELS: Record<string, string> = {
  projects: 'Workstreams',
  resources: 'Resources',
  demand: 'Demand',
  activity: 'Activity',
  manage: 'Manage',
};

/** Shared mode toolbar: connection state, your role, and who else has the plan open. */
export function PresenceBar() {
  const status = useCollabStore((s) => s.status);
  const me = useCollabStore((s) => s.me);
  const presence = useCollabStore((s) => s.presence);
  const people = Object.values(presence);
  const label = status === 'live' ? 'Live' : status === 'offline' ? 'Reconnecting…' : 'Connecting…';
  return (
    <span className="presence-bar">
      <span className="mode-badge mode-shared" title="Plans live in the shared workspace (Manage → Settings to switch)">
        Shared
      </span>
      <span className={`conn-pill conn-${status}`} title={status === 'live' ? 'Connected: changes are saved and shared as you make them' : label}>
        {label}
      </span>
      {me && (
        <span className="avatar me" style={{ background: me.color }} title={`You: ${me.name} (${me.email}), ${ROLE_LABELS[me.role]}`}>
          {initials(me.name)}
        </span>
      )}
      {people.map((p) => (
        <span
          key={p.connId}
          className="avatar"
          style={{ background: p.color }}
          title={`${p.name} (${p.email})${p.view ? ` · ${VIEW_LABELS[p.view] ?? p.view}` : ''}${p.sel ? ' · has cells selected' : ''}`}
        >
          {initials(p.name)}
        </span>
      ))}
    </span>
  );
}
