const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const out = process.argv[2] || '/tmp';
const assert = (ok, message) => { if (!ok) throw new Error(message); console.log('ok -', message); };
(async () => {
  const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.setContent('<main><iframe title="Capacity Planner" style="border:0;width:100%;height:800px"></iframe></main>');
    const rows = [
      { id: 'north', name: 'Northstar transformation', client: 'Northstar', externalId: 'CRM-1042', stage: 'pipeline', winProbability: 75, staffedFte: 2.5, demandFte: 4, percentStaffed: 62.5, openRoles: 2, issueCount: 1, seller: { name: 'Alex Rivera' }, startWeek: '2026-10-12', endWeek: '2027-01-04' },
      { id: 'helios', name: 'Helios migration', client: 'Helios', externalId: 'CRM-1089', stage: 'won', staffedFte: 3, demandFte: 3, percentStaffed: 100, openRoles: 0, issueCount: 0, seller: { name: 'Morgan Chen' } },
      { id: 'lumen', name: 'Lumen discovery', client: 'Lumen', stage: 'pipeline', winProbability: 50, staffedFte: .5, demandFte: 1.5, percentStaffed: 33.3, openRoles: 1, issueCount: 2 },
    ];
    const role = { id: 'role1', name: 'Solution Architect', person: { id: 'alex', name: 'Alex Rivera' }, workstream: { id: 'north', name: 'Northstar transformation' }, level: 'SM', ranges: [{ from: '2026-10-12', to: '2026-11-09', percent: 50 }] };
    const fixtures = {
      list_workstreams: { items: rows, total: 3, truncated: false },
      get_workstream: { ...rows[0], status: 'pipeline', notes: 'Client notes stay plain text.', stats: { demand: 400, staffed: 250, unfilled: 150 }, roles: { items: [role] }, checks: [{ ok: true, label: 'Seller assigned', detail: 'Alex Rivera' }, { ok: false, label: 'Upcoming roles filled', detail: 'Two roles still need people.' }], threads: { items: [] } },
      get_person: { id: 'alex', name: 'Alex Rivera', email: 'alex@example.com', target: 80, utilization: { committed: 75, pipeline: 30 }, allocations: { items: [role] }, weekly: Array.from({ length: 10 }, (_, i) => ({ week: new Date(Date.UTC(2026, 9, 5 + 7 * i)).toISOString().slice(0, 10), committed: [75, 100, 75, 50, 75, 100, 50, 75, 75, 100][i], tentative: i % 3 ? 25 : 50 })) },
      get_capacity_summary: { supply: 120, delivery: 71, pipeline: 28, other: 4, headroom: 17, overflow: 0, window: { from: '2026-10-12', to: '2026-12-14' }, people: { items: [{ person: { name: 'Alex Rivera' }, utilization: 75 }, { person: { name: 'Morgan Chen' }, utilization: 90 }] }, byCapability: { items: [{ capability: { name: 'Solution architecture' }, won: 2.5, pipeline: 1.2, available: 4.2 }, { capability: { name: 'Data engineering' }, won: 3.1, pipeline: .8, available: 2.5 }, { capability: { name: 'Experience design' }, won: 1.4, pipeline: 1.5, available: 3.8 }] } },
      set_allocation: { ok: true, changeId: 'change1', summary: 'Set Alex to 50% (via agent)', impact: { added: [], cleared: [{ type: 'risk' }] }, warnings: [], dates: { from: '2026-10-12', to: '2026-11-09' } },
      undo_change: { ok: true, summary: 'Undid allocation (via agent)', impact: { added: [], cleared: [] }, warnings: [] },
    };
    await page.evaluate(({ fixtures }) => {
      window.calls = []; window.fixtures = fixtures;
      window.emit = (tool, data, args = {}) => document.querySelector('iframe').contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: { tool, args: { plan: 'demo', ...args }, data: data ?? window.fixtures[tool] } } }, '*');
      window.addEventListener('message', event => {
        const m = event.data, frame = document.querySelector('iframe');
        if (event.source !== frame.contentWindow || m?.jsonrpc !== '2.0') return;
        if (m.method === 'ui/initialize') frame.contentWindow.postMessage({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2026-01-26', hostCapabilities: { serverTools: {} }, hostInfo: { name: 'test-host', version: '1' }, hostContext: { theme: 'light' } } }, '*');
        if (m.method === 'ui/notifications/initialized') window.emit('list_workstreams');
        if (m.method === 'ui/notifications/size-changed') frame.style.height = m.params.height + 'px';
        if (m.method === 'tools/call') { window.calls.push(m.params); frame.contentWindow.postMessage({ jsonrpc: '2.0', id: m.id, result: { structuredContent: { tool: m.params.name, args: m.params.arguments, data: window.fixtures[m.params.name] } } }, '*'); }
      });
    }, { fixtures });
    await page.locator('iframe').evaluate((frame, html) => { frame.srcdoc = html; }, fs.readFileSync(path.join(__dirname, '../worker/mcp/app.html'), 'utf8'));
    const app = page.frameLocator('iframe');
    await app.getByRole('heading', { name: 'Workstream overview' }).waitFor();
    assert(await app.locator('article.card').count() === 3, 'MCP app renders workstream cards and summary metrics');
    await app.getByLabel('Search cards').fill('Northstar');
    assert(await app.locator('article.card').count() === 1, 'MCP cards search locally');
    await app.getByLabel('Search cards').fill(''); await app.getByLabel('Filter cards').selectOption('won');
    assert(await app.locator('article.card').count() === 1, 'MCP cards filter by stage');
    await app.getByRole('button', { name: 'Helios migration' }).click();
    await app.getByRole('heading', { name: 'Northstar transformation' }).waitFor();
    assert((await page.evaluate(() => window.calls[0])).arguments.workstream === 'helios', 'card drill-down uses the authenticated host tool bridge');
    await app.getByText('Workstream notes', { exact: true }).click();
    assert(await app.getByText('Client notes stay plain text.').isVisible(), 'MCP details expand notes and health checks');
    await page.evaluate(() => window.emit('get_person'));
    await app.getByRole('heading', { name: 'Weekly allocation' }).waitFor();
    assert(await app.locator('svg.chart rect').count() === 20, 'MCP person view renders styled committed and pipeline chart bars');
    await app.getByRole('button', { name: 'Refresh this view' }).click();
    await page.waitForFunction(() => window.calls.at(-1)?.name === 'get_person');
    assert((await page.evaluate(() => window.calls.at(-1))).name === 'get_person', 'refresh requests current data through the host');
    fs.mkdirSync(path.join(out, 'shots'), { recursive: true });
    await page.screenshot({ path: path.join(out, 'shots/mcp-person-cards.png'), fullPage: true });
    await page.evaluate(() => window.emit('get_capacity_summary'));
    await app.getByRole('heading', { name: 'Capacity at a glance' }).waitFor();
    assert(await app.getByRole('heading', { name: 'Capability coverage' }).isVisible(), 'MCP capacity view shows supply, demand and capability coverage');
    await page.screenshot({ path: path.join(out, 'shots/mcp-capacity-cards.png'), fullPage: true });
    await page.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { theme: 'dark' } }, '*'));
    await app.locator('html[data-theme=dark]').waitFor();
    assert(await app.locator('html').getAttribute('data-theme') === 'dark', 'MCP cards follow host dark mode');
    await page.setViewportSize({ width: 375, height: 900 });
    assert(await app.locator('body').evaluate(body => body.scrollWidth <= window.innerWidth), 'MCP cards fit a narrow mobile container');
    await page.evaluate(() => window.emit('list_workstreams', { items: [{ id: 'bad', name: '<img src=x onerror="window.pwned=true">', stage: 'pipeline' }], total: 1 }));
    await app.getByRole('heading', { name: 'Workstream overview' }).waitFor();
    assert(await app.locator('img').count() === 0 && await app.getByRole('button', { name: '<img src=x onerror="window.pwned=true">' }).count() === 1, 'MCP cards display untrusted content as text');
    await page.evaluate(() => window.emit('set_allocation', { ...window.fixtures.set_allocation, dryRun: true, changeId: undefined }, { role: 'role1', workstream: 'north', percent: 50, dryRun: true }));
    await app.getByRole('button', { name: 'Apply this change' }).click();
    assert(!(await page.evaluate(() => window.calls)).some(c => c.name === 'set_allocation'), 'preview needs an explicit confirmation before writing');
    await app.getByRole('button', { name: 'Confirm apply' }).click();
    await app.getByRole('heading', { name: 'Workspace updated' }).waitFor();
    assert((await page.evaluate(() => window.calls.at(-1))).arguments.dryRun === false, 'confirm apply sends the actual command');
    await app.getByRole('button', { name: 'Undo this change' }).click(); await app.getByRole('button', { name: 'Confirm undo' }).click();
    await page.waitForFunction(() => window.calls.at(-1)?.name === 'undo_change');
    assert((await page.evaluate(() => window.calls.at(-1))).arguments.changeId === 'change1', 'card undo reuses the saved change id');
    assert(errors.length === 0, 'MCP cards produce no browser errors: ' + errors.join('; '));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
