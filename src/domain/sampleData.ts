import { mergeAssignments } from './schema';
import type { Assignment, PlanData, WeekKey } from './types';
import { addWeeks, currentWeek, weeksBetween } from './weeks';

/**
 * Demo plan positioned around the current week. It deliberately contains:
 * - a committed overallocation (Sam, 150%),
 * - an at-risk week run that only exceeds 100% if the Contoso pipeline deal
 *   is won (Alex),
 * - a resource at exactly 100% including pipeline work (Casey, no flag),
 * - a skill mismatch (Riley on Globex) and an uncovered capability
 *   (Agentforce on Northwind),
 * - a lost deal whose presales effort is kept but whose delivery is not counted.
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
    version: 3,
    settings: { overallocationThreshold: 100, criticalThreshold: 149 },
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
      { id: 'res-alex', level: 'SM', name: 'Alex Rivera', role: 'Solution Architect', tagIds: ['tag-dc', 'tag-af'] },
      { id: 'res-sam', level: 'SA', name: 'Sam Patel', role: 'Data Cloud Consultant', tagIds: ['tag-dc', 'tag-mule'] },
      { id: 'res-taylor', level: 'A', name: 'Taylor Brooks', role: 'Marketing Cloud Developer', tagIds: ['tag-mc'] },
      { id: 'res-morgan', level: 'M', name: 'Morgan Kim', role: 'Marketing Strategist', tagIds: ['tag-mc', 'tag-dc'] },
      { id: 'res-casey', level: 'SA', name: 'Casey Nguyen', role: 'Sales Cloud Consultant', tagIds: ['tag-sales', 'tag-service'] },
      { id: 'res-jamie', level: 'A', name: 'Jamie Ortiz', role: 'Service Cloud Developer', tagIds: ['tag-service', 'tag-af'] },
      { id: 'res-riley', level: 'SA', name: 'Riley Thompson', role: 'Integration Engineer', tagIds: ['tag-mule'] },
      { id: 'res-drew', level: 'M', name: 'Drew Okafor', role: 'Analytics Consultant', tagIds: ['tag-tableau', 'tag-dc'] },
    ],
    projects: [
      {
        id: 'proj-acme',
        status: 'won',
        name: 'Data Cloud Unification',
        client: 'Acme Retail',
        sellerId: 'seller-jordan',
        tagIds: ['tag-dc', 'tag-mule'],
        startWeek: w(-2),
        endWeek: w(14),
      },
      {
        id: 'proj-northwind',
        status: 'won',
        name: 'Journey Modernization',
        client: 'Northwind',
        sellerId: 'seller-priya',
        tagIds: ['tag-mc', 'tag-af'],
        startWeek: w(0),
        endWeek: w(12),
      },
      {
        id: 'proj-contoso',
        status: 'pipeline',
        name: 'Agentforce Service Pilot',
        client: 'Contoso',
        sellerId: 'seller-marcus',
        tagIds: ['tag-af', 'tag-service'],
        startWeek: w(4),
        endWeek: w(16),
      },
      {
        id: 'proj-globex',
        status: 'won',
        name: 'Sales Cloud Rollout',
        client: 'Globex',
        sellerId: 'seller-jordan',
        tagIds: ['tag-sales'],
        startWeek: w(1),
        endWeek: w(18),
      },
      {
        id: 'proj-initech',
        status: 'won',
        name: 'Analytics Foundation',
        client: 'Initech',
        sellerId: 'seller-priya',
        tagIds: ['tag-tableau', 'tag-dc'],
        startWeek: w(8),
        endWeek: w(24),
      },
      {
        id: 'proj-fabrikam',
        status: 'lost',
        name: 'Commerce Replatform',
        client: 'Fabrikam',
        sellerId: 'seller-marcus',
        tagIds: ['tag-mc', 'tag-dc'],
        startWeek: w(2),
        endWeek: w(10),
      },
    ],
    // Rows for the same person and workstream (e.g. presales then delivery) merge into one.
    assignments: mergeAssignments([
      assign('proj-acme', 'res-alex', 50, -2, 14),
      assign('proj-acme', 'res-sam', 100, 0, 10),
      assign('proj-acme', 'res-riley', 50, 2, 8),
      assign('proj-northwind', 'res-taylor', 100, 0, 12),
      assign('proj-northwind', 'res-morgan', 50, 0, 12),
      assign('proj-contoso', 'res-jamie', 100, 4, 16),
      assign('proj-contoso', 'res-alex', 100, 6, 12),
      assign('proj-contoso', 'res-casey', 50, 4, 16),
      assign('proj-globex', 'res-casey', 50, 1, 18),
      assign('proj-globex', 'res-riley', 25, 1, 10),
      assign('proj-initech', 'res-drew', 100, 10, 24),
      assign('proj-initech', 'res-sam', 50, 8, 14),
      assign('proj-contoso', 'res-alex', 25, 0, 3),
      assign('proj-contoso', 'res-jamie', 25, 0, 3),
      assign('proj-fabrikam', 'res-morgan', 25, -4, -1),
      assign('proj-fabrikam', 'res-morgan', 50, 2, 10),
    ]),
  };
}

export function createEmptyPlan(): PlanData {
  return {
    version: 3,
    settings: { overallocationThreshold: 100, criticalThreshold: 149 },
    tags: [],
    sellers: [],
    resources: [],
    projects: [],
    assignments: [],
  };
}
