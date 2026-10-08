import { describe, expect, it } from 'vitest';
import { derive } from './derive';
import { createSamplePlan } from './sampleData';
import { demandSummary, personSummary, summarizeRole, workstreamChecks } from './summary';
import { lookaheadWeeks } from './utilization';

const NOW = '2026-10-05';
const plan = createSamplePlan(NOW);
const d = derive(plan);
const window = lookaheadWeeks(NOW);
const project = (id: string) => plan.projects.find((p) => p.id === id)!;
const failing = (checks: { id: string; ok: boolean }[]) => checks.filter((c) => !c.ok).map((c) => c.id).sort();

describe('role summary', () => {
  it('says which phases a role covers from now on, and its average over the window', () => {
    // Alex on Contoso: 25% presales weeks 0–3, 100% delivery weeks 6–12.
    const alex = plan.assignments.find((a) => a.projectId === 'proj-contoso' && a.resourceId === 'res-alex')!;
    const s = summarizeRole(alex, project('proj-contoso'), NOW, window);
    expect(s.phase).toBe('both');
    expect(s.first).toBe(NOW);
    expect(s.avg).toBe((4 * 25 + 4 * 100) / 10);
    // From week 4 on, only delivery is left.
    expect(summarizeRole(alex, project('proj-contoso'), '2026-11-02', window).phase).toBe('delivery');
  });
});

describe('workstream checks', () => {
  it('flags an open role and pipeline risk on the Contoso pursuit, and passes the rest', () => {
    const checks = workstreamChecks(plan, d, project('proj-contoso'), NOW, window);
    expect(failing(checks)).toEqual(['filled', 'risk']);
    expect(checks.find((c) => c.id === 'presales')).toMatchObject({ ok: true });
    expect(checks.find((c) => c.id === 'filled')?.detail).toContain('Agentforce Architect');
  });

  it('flags a skill mismatch', () => {
    expect(failing(workstreamChecks(plan, d, project('proj-globex'), NOW, window))).toContain('skills');
  });

  it('only checks seller and dates on lost workstreams', () => {
    expect(workstreamChecks(plan, d, project('proj-fabrikam'), NOW, window).map((c) => c.id)).toEqual(['seller', 'dates']);
  });
});

describe('person summary', () => {
  it('flags an overallocation in the next 10 weeks and compares with the level target', () => {
    const sam = plan.resources.find((r) => r.id === 'res-sam')!;
    const s = personSummary(plan, d, sam, window);
    expect(s.target).toBe(90);
    expect(s.peak).toBe(150);
    expect(failing(s.checks)).toContain('overallocated');
  });
});

describe('demand summary', () => {
  it('splits live workstreams into pipeline and won, with supporting, staffed and open roles', () => {
    const s = demandSummary(plan, d, NOW, window);
    expect(s.pipeline.map((w) => w.project.id)).toEqual(['proj-contoso']);
    expect(s.won.map((w) => w.project.id).sort()).toEqual(['proj-acme', 'proj-globex', 'proj-initech', 'proj-northwind']);
    const contoso = s.pipeline[0];
    expect(contoso.supporting.map((r) => r.role.resourceId).sort()).toEqual(['res-alex', 'res-jamie']);
    expect(contoso.staffed.map((r) => r.role.resourceId).sort()).toEqual(['res-alex', 'res-casey', 'res-jamie']);
    expect(contoso.open.map((r) => r.role.name)).toEqual(['Agentforce Architect']);
  });
});
