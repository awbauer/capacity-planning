import type { Assignment, PlanData, WeekKey } from './types';
import { addWeeks, currentWeek, weeksBetween } from './weeks';

/**
 * Demo plan positioned around the current week. It deliberately contains an
 * overallocation (Alex, Sam), a resource at exactly 100% (Casey, not a
 * conflict), a skill mismatch (Riley on Globex) and an uncovered capability
 * (Agentforce on Northwind).
 */
export function createSamplePlan(today: WeekKey = currentWeek()): PlanData {
  const w = (offset: number) => addWeeks(today, offset);
  let n = 0;
  const assign = (
    projectId: string,
    resourceId: string,
    percent: number,
    from: number,
    to: number,
  ): Assignment => ({
    id: `sample-a${++n}`,
    projectId,
    resourceId,
    weekly: Object.fromEntries(weeksBetween(w(from), w(to)).map((k) => [k, percent])),
  });

  return {
    version: 1,
    settings: { overallocationThreshold: 100 },
    tags: [
      { id: 'tag-dc', name: 'Data Cloud', color: '#2563eb' },
      { id: 'tag-mc', name: 'Marketing Cloud', color: '#db2777' },
      { id: 'tag-sales', name: 'Sales Cloud', color: '#16a34a' },
      { id: 'tag-service', name: 'Service Cloud', color: '#d97706' },
      { id: 'tag-af', name: 'Agentforce', color: '#7c3aed' },
      { id: 'tag-mule', name: 'MuleSoft', color: '#0891b2' },
      { id: 'tag-tableau', name: 'Tableau', color: '#ea580c' },
    ],
    sellers: [
      { id: 'seller-jordan', name: 'Jordan Lee' },
      { id: 'seller-priya', name: 'Priya Shah' },
      { id: 'seller-marcus', name: 'Marcus Chen' },
    ],
    resources: [
      { id: 'res-alex', name: 'Alex Rivera', role: 'Solution Architect', tagIds: ['tag-dc', 'tag-af'] },
      { id: 'res-sam', name: 'Sam Patel', role: 'Data Cloud Consultant', tagIds: ['tag-dc', 'tag-mule'] },
      { id: 'res-taylor', name: 'Taylor Brooks', role: 'Marketing Cloud Developer', tagIds: ['tag-mc'] },
      { id: 'res-morgan', name: 'Morgan Kim', role: 'Marketing Strategist', tagIds: ['tag-mc', 'tag-dc'] },
      { id: 'res-casey', name: 'Casey Nguyen', role: 'Sales Cloud Consultant', tagIds: ['tag-sales', 'tag-service'] },
      { id: 'res-jamie', name: 'Jamie Ortiz', role: 'Service Cloud Developer', tagIds: ['tag-service', 'tag-af'] },
      { id: 'res-riley', name: 'Riley Thompson', role: 'Integration Engineer', tagIds: ['tag-mule'] },
      { id: 'res-drew', name: 'Drew Okafor', role: 'Analytics Consultant', tagIds: ['tag-tableau', 'tag-dc'] },
    ],
    projects: [
      {
        id: 'proj-acme',
        name: 'Data Cloud Unification',
        client: 'Acme Retail',
        sellerId: 'seller-jordan',
        tagIds: ['tag-dc', 'tag-mule'],
        startWeek: w(-2),
        endWeek: w(14),
      },
      {
        id: 'proj-northwind',
        name: 'Journey Modernization',
        client: 'Northwind',
        sellerId: 'seller-priya',
        tagIds: ['tag-mc', 'tag-af'],
        startWeek: w(0),
        endWeek: w(12),
      },
      {
        id: 'proj-contoso',
        name: 'Agentforce Service Pilot',
        client: 'Contoso',
        sellerId: 'seller-marcus',
        tagIds: ['tag-af', 'tag-service'],
        startWeek: w(4),
        endWeek: w(16),
      },
      {
        id: 'proj-globex',
        name: 'Sales Cloud Rollout',
        client: 'Globex',
        sellerId: 'seller-jordan',
        tagIds: ['tag-sales'],
        startWeek: w(1),
        endWeek: w(18),
      },
      {
        id: 'proj-initech',
        name: 'Analytics Foundation',
        client: 'Initech',
        sellerId: 'seller-priya',
        tagIds: ['tag-tableau', 'tag-dc'],
        startWeek: w(8),
        endWeek: w(24),
      },
    ],
    assignments: [
      assign('proj-acme', 'res-alex', 50, -2, 14),
      assign('proj-acme', 'res-sam', 100, 0, 10),
      assign('proj-acme', 'res-riley', 50, 2, 8),
      assign('proj-northwind', 'res-taylor', 100, 0, 12),
      assign('proj-northwind', 'res-morgan', 50, 0, 12),
      assign('proj-contoso', 'res-jamie', 80, 4, 16),
      assign('proj-contoso', 'res-alex', 60, 6, 12),
      assign('proj-contoso', 'res-casey', 40, 4, 16),
      assign('proj-globex', 'res-casey', 60, 1, 18),
      assign('proj-globex', 'res-riley', 30, 1, 10),
      assign('proj-initech', 'res-drew', 100, 10, 24),
      assign('proj-initech', 'res-sam', 50, 8, 14),
    ],
  };
}

export function createEmptyPlan(): PlanData {
  return {
    version: 1,
    settings: { overallocationThreshold: 100 },
    tags: [],
    sellers: [],
    resources: [],
    projects: [],
    assignments: [],
  };
}
