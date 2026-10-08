import { describe, expect, it } from 'vitest';
import { allWorkstreamsCsv, csvCell, slug, workstreamCsv, workstreamWeeks } from './csv';
import { createSamplePlan } from './sampleData';

const parse = (csv: string) => csv.trimEnd().split('\r\n');

describe('csv', () => {
  it('quotes cells that need it', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(50)).toBe('50');
  });

  it('slugs workstream names for file names', () => {
    expect(slug('Colgate - MCN Agent')).toBe('colgate-mcn-agent');
    expect(slug('!!!')).toBe('workstream');
  });

  it('covers the workstream dates plus any allocation outside them', () => {
    const plan = createSamplePlan('2026-10-05');
    const contoso = plan.projects.find((p) => p.id === 'proj-contoso')!;
    const weeks = workstreamWeeks(plan, contoso);
    // Presales starts at week 0 (before the week-4 start date); dates end at week 16.
    expect(weeks[0]).toBe('2026-10-05');
    expect(weeks[weeks.length - 1]).toBe(contoso.endWeek);
  });

  it('writes one workstream as a details block, phase row, roles and FTE totals', () => {
    const plan = createSamplePlan('2026-10-05');
    const lines = parse(workstreamCsv(plan, 'proj-contoso'));
    expect(lines[0]).toBe('Workstream,Agentforce Service Pilot');
    expect(lines).toContain('Status,Pipeline');
    const header = lines.find((l) => l.startsWith('Role,Person,'))!.split(',');
    const phase = lines.find((l) => l.startsWith('Phase,'))!.split(',');
    const start = header.indexOf('2026-11-02'); // Contoso starts at week 4
    expect(phase[start - 1]).toBe('Presales');
    expect(phase[start]).toBe('Delivery');
    // A person's row names their role first.
    const alex = lines.find((l) => l.startsWith('Solution Architect,Alex Rivera,'))!.split(',');
    expect(alex[header.indexOf('2026-10-05')]).toBe('25');
    const total = lines.find((l) => l.startsWith('Total FTE,'))!.split(',');
    // Alex 25 + Jamie 25 presales in week 0.
    expect(total[header.indexOf('2026-10-05')]).toBe('0.5');
    // The open Agentforce Architect role (50% from week 4) follows the people, with its own total.
    const role = lines.find((l) => l.startsWith('Agentforce Architect,Open,'))!.split(',');
    expect(role[header.indexOf('2026-11-02')]).toBe('50');
    const open = lines[lines.length - 1].split(',');
    expect(open[0]).toBe('Open FTE');
    expect(open[header.indexOf('2026-11-02')]).toBe('0.5');
  });

  it('writes every allocated week of every workstream as one long table', () => {
    const plan = createSamplePlan('2026-10-05');
    const lines = parse(allWorkstreamsCsv(plan));
    expect(lines[0]).toBe('Workstream,Client,Seller,Status,Role,Person,Level,Week of,Phase,Allocation %');
    const total = plan.assignments.reduce((n, a) => n + Object.values(a.weekly).filter(Boolean).length, 0);
    expect(lines).toHaveLength(total + 1);
    expect(lines).toContain(
      'Agentforce Service Pilot,Contoso,Marcus Chen,Pipeline,Solution Architect,Alex Rivera,SM,2026-10-05,Presales,25',
    );
    expect(lines).toContain(
      'Agentforce Service Pilot,Contoso,Marcus Chen,Pipeline,Agentforce Architect,Open,SM,2026-11-02,Delivery,50',
    );
  });
});
