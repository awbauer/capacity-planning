import { describe, expect, it } from 'vitest';
import { parseOp } from '../domain/opSchema';
import { applyOp, type Op } from '../domain/ops';
import { createSamplePlan } from '../domain/sampleData';
import { makePlanActions } from './actions';

const NOW = '2026-10-05';

/** Every op the store's actions send must pass the server's validation (as JSON, like over the wire). */
describe('actions send ops the server accepts', () => {
  const sent: Op[] = [];
  let plan = createSamplePlan(NOW);
  const a = makePlanActions(
    () => plan,
    (op) => {
      sent.push(op);
      plan = applyOp(plan, op);
    },
  );
  const project = () => plan.projects.find((p) => p.id === 'proj-contoso')!;
  const resource = () => plan.resources.find((r) => r.id === 'res-alex')!;

  const calls: [string, () => unknown][] = [
    ['addTag', () => a.addTag('Heroku')],
    ['updateTag', () => a.updateTag('tag-dc', { name: 'Data 360' })],
    ['addSeller', () => a.addSeller('Pat')],
    ['updateSeller', () => a.updateSeller('seller-jordan', { email: undefined })],
    ['addResource', () => a.addResource({ name: 'Quinn', tagIds: [] })],
    // ManagePage and ProjectDialog pass whole objects (with id) or undefined to clear.
    ['updateResource (whole object)', () => a.updateResource('res-alex', { ...resource() })],
    ['updateResource (clear)', () => a.updateResource('res-alex', { role: undefined, level: undefined })],
    ['addProject', () => a.addProject({ name: 'Umbrella', sellerId: null, status: 'pipeline', tagIds: [] })],
    ['updateProject (ProjectDialog draft)', () => a.updateProject('proj-contoso', { ...project(), name: 'Contoso 2' })],
    ['updateProject (shift)', () => a.updateProject('proj-contoso', { startWeek: '2026-11-23' }, { from: '2026-11-02', weeks: 3 })],
    ['updateProject (clear dates)', () => a.updateProject('proj-contoso', { startWeek: undefined, endWeek: undefined })],
    ['addAssignment (new)', () => a.addAssignment('proj-acme', 'res-drew', { percent: 50, from: NOW, to: '2026-10-19' })],
    ['addAssignment (existing)', () => a.addAssignment('proj-acme', 'res-drew', { percent: 25, from: '2026-10-26', to: '2026-10-26' })],
    ['setAllocations', () => a.setAllocations([{ assignmentId: 'sample-a1', weeks: [NOW], percent: 62 }])],
    ['addRole', () => a.addRole('proj-acme', { name: ' Architect ', level: 'SM', tagIds: ['tag-af'] }, { percent: 100, from: NOW, to: NOW })],
    ['updateRole', () => a.updateRole('sample-role1', { name: 'Lead', level: undefined })],
    ['assignRole', () => a.assignRole('sample-role1', 'res-morgan')],
    ['setThresholds', () => a.setThresholds({ criticalThreshold: 160 })],
    ['setUtilizationTarget', () => a.setUtilizationTarget('D', null)],
    ['removeAssignment', () => a.removeAssignment('sample-a2')],
    ['deleteTag', () => a.deleteTag('tag-dc')],
    ['deleteSeller', () => a.deleteSeller('seller-jordan')],
    ['deleteResource', () => a.deleteResource('res-sam')],
    ['deleteProject', () => a.deleteProject('proj-globex')],
    ['resetToSample', () => a.resetToSample()],
    ['clearAll', () => a.clearAll()],
  ];

  it.each(calls)('%s', (_name, call) => {
    sent.length = 0;
    call();
    expect(sent.length).toBeGreaterThan(0);
    for (const op of sent) expect(parseOp(JSON.parse(JSON.stringify(op)))).toHaveProperty('op');
  });
});
