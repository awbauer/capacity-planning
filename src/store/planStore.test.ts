import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyPlan, createSamplePlan } from '../domain/sampleData';
import { defaultMeta, serializePlan } from '../domain/plans';
import { parsePlan, parsePlanFile } from '../domain/schema';
import { allPlans, redo, undo, usePlanStore } from './planStore';

const store = () => usePlanStore.getState();

describe('planStore', () => {
  beforeEach(() => {
    usePlanStore.setState({ meta: defaultMeta(), library: [] });
    store().importPlan(createSamplePlan('2026-10-05'));
    usePlanStore.temporal.getState().clear();
  });

  it('starts with a valid blank plan', () => {
    const initial = usePlanStore.getInitialState().plan;
    expect(initial).toEqual(createEmptyPlan());
    expect(parsePlan(initial)).toEqual(initial);
  });

  it('loads the sample plan on demand and can undo back to blank', () => {
    store().clearAll();
    usePlanStore.temporal.getState().clear();
    store().resetToSample();
    expect(store().plan.resources.length).toBeGreaterThan(0);
    expect(store().plan.projects.length).toBeGreaterThan(0);
    expect(store().plan.assignments.length).toBeGreaterThan(0);
    expect(parsePlan(store().plan)).toEqual(store().plan);
    undo();
    expect(store().plan).toEqual(createEmptyPlan());
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

  it('clears weeks set to 0 and snaps other values to 0/25/50/100', () => {
    store().setAllocations([
      { assignmentId: 'sample-a1', weeks: ['2026-10-05'], percent: 0 },
      { assignmentId: 'sample-a1', weeks: ['2026-10-12'], percent: -5 },
      { assignmentId: 'sample-a1', weeks: ['2026-10-19'], percent: 62.6 },
    ]);
    const weekly = store().plan.assignments.find((a) => a.id === 'sample-a1')!.weekly;
    expect('2026-10-05' in weekly).toBe(false);
    expect('2026-10-12' in weekly).toBe(false);
    expect(weekly['2026-10-19']).toBe(50);
  });

  it('adds an assignment with a filled range, reusing an existing row', () => {
    const a = store().addAssignment('proj-acme', 'res-drew', { percent: 50, from: '2026-10-05', to: '2026-10-19' });
    expect(Object.keys(a.weekly)).toEqual(['2026-10-05', '2026-10-12', '2026-10-19']);
    const again = store().addAssignment('proj-acme', 'res-drew', { percent: 25, from: '2026-10-26', to: '2026-10-26' });
    expect(again.id).toBe(a.id);
    expect(store().plan.assignments.filter((x) => x.resourceId === 'res-drew' && x.projectId === 'proj-acme')).toHaveLength(1);
    expect(again.weekly).toMatchObject({ '2026-10-05': 50, '2026-10-26': 25 });
  });

  it('keeps one row per person per workstream', () => {
    const contoso = store().plan.assignments.filter((a) => a.projectId === 'proj-contoso' && a.resourceId === 'res-alex');
    expect(contoso).toHaveLength(1);
    // The sample's presales weeks and delivery weeks for Alex on Contoso share that row.
    expect(Object.values(contoso[0].weekly)).toEqual(expect.arrayContaining([25, 100]));
  });

  describe('plans', () => {
    const names = () => allPlans(store()).map((p) => p.meta.name);

    it('starts as "Default"', () => {
      expect(store().meta).toEqual({ id: 'default', name: 'Default', revision: 0 });
    });

    it('creates, switches and keeps each plan separate', () => {
      const sampleProjects = store().plan.projects.length;
      const scenario = store().newPlan('Scenario B');
      expect(store().plan.projects).toHaveLength(0);
      expect(names()).toEqual(['Default', 'Scenario B']);
      expect(usePlanStore.temporal.getState().pastStates).toHaveLength(0);

      store().switchPlan('default');
      expect(store().plan.projects).toHaveLength(sampleProjects);
      store().switchPlan(scenario.id);
      expect(store().meta.name).toBe('Scenario B');
    });

    it('refuses duplicate names (case-insensitive)', () => {
      const b = store().newPlan('B');
      expect(store().renamePlan(b.id, 'default')).toBe(false);
      expect(store().renamePlan('default', 'Base')).toBe(true);
      expect(names()).toEqual(['B', 'Base']);
    });

    it('deletes plans but never the last one', () => {
      store().deletePlan('default');
      expect(store().meta.id).toBe('default');
      store().newPlan('B');
      store().deletePlan(store().meta.id);
      expect(names()).toEqual(['Default']);
    });

    it('bumps the revision without an undo step', () => {
      expect(store().bumpRevision().revision).toBe(1);
      expect(usePlanStore.temporal.getState().pastStates).toHaveLength(0);
    });

    it('imports over the plan with the same name, else as a new plan', () => {
      const exported = parsePlanFile(JSON.parse(serializePlan({ ...store().meta, revision: 4 }, createEmptyPlan())));
      expect(exported.name).toBe('Default');

      // Same name as the open plan: replaced in place, undoable.
      expect(store().importPlanFile(exported).outcome).toBe('replaced-open');
      expect(store().plan.projects).toHaveLength(0);
      expect(store().meta.revision).toBe(4);
      undo();
      expect(store().plan.projects.length).toBeGreaterThan(0);

      // Same name as a closed plan: that plan is replaced and opened.
      store().newPlan('Other');
      expect(store().importPlanFile({ ...exported, name: 'DEFAULT' }).outcome).toBe('replaced-other');
      expect(store().meta.id).toBe('default');
      expect(names()).toEqual(['DEFAULT', 'Other']);

      // New name: a new plan.
      expect(store().importPlanFile({ ...exported, name: 'Imported' }).outcome).toBe('created');
      expect(names()).toEqual(['DEFAULT', 'Imported', 'Other']);
    });

    it('imports old files without a name as "Default"', () => {
      const legacy = JSON.parse(JSON.stringify(createSamplePlan('2026-10-05')));
      expect(parsePlanFile(legacy)).toMatchObject({ name: 'Default', revision: 0 });
    });
  });
});
