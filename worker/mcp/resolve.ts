import type { PlanData } from '../../src/domain/types';
import type { User } from '../roomEngine';
const key = (s: string) => s.trim().toLowerCase();
/** Exact ids win; all other matches must be unique. Errors expose a bounded candidate list. */
export function resolve<T extends { id: string; name: string }>(
  list: T[],
  query: string,
  kind: string,
  aliases: (x: T) => string[] = () => [],
): T {
  const id = list.find((x) => x.id === query);
  if (id) return id;
  const q = key(query);
  const values = (x: T) => [x.id, x.name, ...aliases(x)].map(key).filter(Boolean);
  const exact = list.filter((x) => values(x).includes(q));
  const found = exact.length ? exact : list.filter((x) => values(x).some((v) => v.includes(q)));
  if (found.length === 1) return found[0];
  throw new Error(
    `${found.length ? 'Ambiguous' : 'Unknown'} ${kind} “${query}”. Candidates: ${
      (found.length ? found : list)
        .slice(0, 10)
        .map((x) => `${x.name} (${x.id})`)
        .join(', ') || 'none'
    }`,
  );
}
export function person(plan: PlanData, query: string, user: User) {
  if (key(query) !== 'me') return resolve(plan.resources, query, 'person', (r) => [r.email ?? '']);
  const email = plan.resources.filter((r) => key(r.email ?? '') === key(user.email));
  if (email.length === 1) return email[0];
  const names = plan.resources.filter((r) => !r.email && key(r.name) === key(user.name));
  if (!email.length && names.length === 1) return names[0];
  throw new Error(
    'Cannot uniquely match you to a person. Set their email under Manage → Resources or use a person id.',
  );
}
export const workstream = (plan: PlanData, query: string) =>
  resolve(plan.projects, query, 'workstream', (p) => [p.externalId ?? '']);
export function seller(plan: PlanData, query: string, user: User) {
  return query.toLowerCase() === 'me'
    ? resolve(plan.sellers, user.email, 'seller', (s) => [s.email ?? ''])
    : resolve(plan.sellers, query, 'seller', (s) => [s.email ?? '']);
}
export function role(plan: PlanData, projectId: string, query?: string, resourceId?: string) {
  const rows = plan.assignments.filter(
    (r) => r.projectId === projectId && (!resourceId || r.resourceId === resourceId),
  );
  if (query) return resolve(rows, query, 'role');
  if (rows.length === 1) return rows[0];
  throw new Error(
    `Specify a role id. Candidates: ${
      rows
        .slice(0, 10)
        .map((r) => `${r.name || 'Unnamed'} (${r.id})`)
        .join(', ') || 'none'
    }`,
  );
}
