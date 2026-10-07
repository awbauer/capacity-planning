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

  it('writes one workstream as a details block, phase row, people and FTE total', () => {
    const plan = createSamplePlan('2026-10-05');
    const lines = parse(workstreamCsv(plan, 'proj-contoso'));
    expect(lines[0]).toBe('Workstream,Agentforce Service Pilot');
    expect(lines).toContain('Status,Pipeline');
    const header = lines.find((l) => l.startsWith('Person,'))!.split(',');
    const phase = lines.find((l) => l.startsWith('Phase,'))!.split(',');
    const start = header.indexOf('2026-11-02'); // Contoso starts at week 4
    expect(phase[start - 1]).toBe('Presales');
    expect(phase[start]).toBe('Delivery');
    const alex = lines.find((l) => l.startsWith('Alex Rivera,'))!.split(',');
    expect(alex[header.indexOf('2026-10-05')]).toBe('25');
    const total = lines[lines.length - 1].split(',');
    expect(total[0]).toBe('Total FTE');
    // Alex 25 + Jamie 25 presales in week 0.
    expect(total[header.indexOf('2026-10-05')]).toBe('0.5');
  });

  it('writes every allocated week of every workstream as one long table', () => {
    const plan = createSamplePlan('2026-10-05');
    const lines = parse(allWorkstreamsCsv(plan));
    expect(lines[0]).toBe('Workstream,Client,Seller,Status,Person,Role,Week of,Phase,Allocation %');
    const total = plan.assignments.reduce((n, a) => n + Object.values(a.weekly).filter(Boolean).length, 0);
    expect(lines).toHaveLength(total + 1);
    expect(lines).toContain(
      'Agentforce Service Pilot,Contoso,Marcus Chen,Pipeline,Alex Rivera,Solution Architect,2026-10-05,Presales,25',
    );
  });
});
