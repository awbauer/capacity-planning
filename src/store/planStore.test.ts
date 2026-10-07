import { beforeEach, describe, expect, it } from 'vitest';
import { createSamplePlan } from '../domain/sampleData';
import { redo, undo, usePlanStore } from './planStore';

const store = () => usePlanStore.getState();

describe('planStore', () => {
  beforeEach(() => {
    store().importPlan(createSamplePlan('2026-10-05'));
    usePlanStore.temporal.getState().clear();
  });

  it('removes a deleted tag from resources and projects', () => {
    store().deleteTag('tag-dc');
    const { plan } = store();
    expect(plan.tags.some((t) => t.id === 'tag-dc')).toBe(false);
    expect(plan.resources.some((r) => r.tagIds.includes('tag-dc'))).toBe(false);
    expect(plan.projects.some((p) => p.tagIds.includes('tag-dc'))).toBe(false);
  });

  it('removes assignments with their resource or project, and unsets deleted sellers', () => {
    store().deleteResource('res-alex');
    expect(store().plan.assignments.some((a) => a.resourceId === 'res-alex')).toBe(false);
    store().deleteProject('proj-acme');
    expect(store().plan.assignments.some((a) => a.projectId === 'proj-acme')).toBe(false);
    store().deleteSeller('seller-jordan');
    expect(store().plan.projects.find((p) => p.id === 'proj-globex')?.sellerId).toBeNull();
  });

  it('reuses an existing tag with the same name', () => {
    const before = store().plan.tags.length;
    expect(store().addTag('  data cloud ').id).toBe('tag-dc');
    expect(store().addTag('Heroku').name).toBe('Heroku');
    expect(store().plan.tags).toHaveLength(before + 1);
  });

  it('fills every week of a bucket in one undoable step', () => {
    const weeks = ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'];
    store().setAllocations([{ assignmentId: 'sample-a1', weeks, percent: 25 }]);
    const weekly = () => store().plan.assignments.find((a) => a.id === 'sample-a1')!.weekly;
    expect(weeks.map((w) => weekly()[w])).toEqual([25, 25, 25, 25]);
    undo();
    expect(weeks.map((w) => weekly()[w])).toEqual([50, 50, 50, 50]);
    redo();
    expect(weekly()['2026-10-05']).toBe(25);
  });

  it('clears weeks set to 0 and clamps bad input', () => {
    store().setAllocations([
      { assignmentId: 'sample-a1', weeks: ['2026-10-05'], percent: 0 },
      { assignmentId: 'sample-a1', weeks: ['2026-10-12'], percent: -5 },
      { assignmentId: 'sample-a1', weeks: ['2026-10-19'], percent: 62.6 },
    ]);
    const weekly = store().plan.assignments.find((a) => a.id === 'sample-a1')!.weekly;
    expect('2026-10-05' in weekly).toBe(false);
    expect('2026-10-12' in weekly).toBe(false);
    expect(weekly['2026-10-19']).toBe(63);
  });

  it('adds an assignment with a filled range, reusing an existing row', () => {
    const a = store().addAssignment('proj-acme', 'res-drew', { percent: 40, from: '2026-10-05', to: '2026-10-19' });
    expect(Object.keys(a.weekly)).toEqual(['2026-10-05', '2026-10-12', '2026-10-19']);
    const again = store().addAssignment('proj-acme', 'res-drew', { percent: 20, from: '2026-10-26', to: '2026-10-26' });
    expect(again.id).toBe(a.id);
    expect(store().plan.assignments.filter((x) => x.resourceId === 'res-drew' && x.projectId === 'proj-acme')).toHaveLength(1);
    expect(again.weekly).toMatchObject({ '2026-10-05': 40, '2026-10-26': 20 });
  });
});
