import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { ROLE_LABELS, USER_ROLES, type UserRole } from '../domain/permissions';
import { useCollabStore } from '../store/collabStore';
import { when } from './format';

interface UserRow {
  email: string;
  name: string;
  role: UserRole;
  disabled: boolean;
  owner: boolean;
  createdAt: number;
  lastSeenAt: number | null;
}
type DefaultRole = UserRole | 'none';

/** Manage → People & access (admins, shared mode): roles, access, and what newcomers get. */
export function UsersTable() {
  const me = useCollabStore((s) => s.me);
  const toast = useCollabStore((s) => s.toast);
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [defaultRole, setDefaultRole] = useState<DefaultRole>('viewer');
  const [invite, setInvite] = useState({ email: '', role: 'editor' as UserRole });

  const load = () =>
    api<{ users: UserRow[]; defaultRole: DefaultRole }>('/api/users')
      .then((r) => {
        setUsers(r.users);
        setDefaultRole(r.defaultRole);
      })
      .catch((e: Error) => toast(e.message));
  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (p: Promise<unknown>) => {
    try {
      await p;
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section>
      <p className="muted small">
        Everyone who has signed in through Cloudflare Access. <strong>Viewers</strong> see everything and the activity
        log; <strong>editors</strong> also change plans, undo their own changes and set locks; <strong>admins</strong>{' '}
        also manage people, plan settings and plans, and can remove anyone’s lock. Roles apply to every plan. Owners
        (OWNER_EMAILS) are always admins.
      </p>
      <label className="inline-field">
        People signing in for the first time get{' '}
        <select
          value={defaultRole}
          onChange={(e) => void run(api('/api/settings', { method: 'PUT', json: { defaultRole: e.target.value } }))}
        >
          <option value="none">no access (until an admin adds them)</option>
          {USER_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </label>
      <table className="table">
        <thead>
          <tr>
            <th>Person</th>
            <th>Role</th>
            <th>Access</th>
            <th>Last seen</th>
          </tr>
        </thead>
        <tbody>
          {(users ?? []).map((u) => {
            const locked = u.owner || u.email === me?.email;
            return (
              <tr key={u.email} className={u.disabled ? 'archived' : undefined}>
                <td>
                  <strong>{u.name}</strong>
                  <div className="muted small">{u.email}</div>
                </td>
                <td>
                  <select
                    aria-label={`Role for ${u.email}`}
                    value={u.role}
                    disabled={locked}
                    title={u.owner ? 'Owner: always an admin' : u.email === me?.email ? 'You can’t change your own role' : undefined}
                    onChange={(e) =>
                      void run(api(`/api/users/${encodeURIComponent(u.email)}`, { method: 'PATCH', json: { role: e.target.value } }))
                    }
                  >
                    {USER_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                  {u.owner && <span className="badge">owner</span>}
                </td>
                <td>
                  {locked ? (
                    <span className="muted small">Has access</span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() =>
                        void run(api(`/api/users/${encodeURIComponent(u.email)}`, { method: 'PATCH', json: { disabled: !u.disabled } }))
                      }
                    >
                      {u.disabled ? 'Give access' : 'Remove access'}
                    </button>
                  )}
                </td>
                <td className="muted small">{u.lastSeenAt ? when(u.lastSeenAt) : 'Not yet'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!invite.email.trim()) return;
          void run(api('/api/users', { method: 'POST', json: invite })).then(() => setInvite({ ...invite, email: '' }));
        }}
      >
        <strong>Add someone before they sign in:</strong>
        <input
          type="email"
          placeholder="email@company.com"
          aria-label="Email"
          value={invite.email}
          onChange={(e) => setInvite({ ...invite, email: e.target.value })}
        />
        <select aria-label="Role" value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value as UserRole })}>
          {USER_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-small">
          Add
        </button>
        <span className="muted small">They still need to be allowed in by your Cloudflare Access policy.</span>
      </form>
    </section>
  );
}
