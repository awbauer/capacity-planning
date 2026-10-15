const { chromium } = require('playwright');
const path = require('path');
// Local mode (this browser's plans): run with npm run test:e2e (see e2e/run.mjs).
const SP = process.argv[2] || require('os').tmpdir();
require('fs').mkdirSync(path.join(SP, 'shots'), { recursive: true });
const BASE = process.env.BASE_URL || 'http://localhost:5173';
const shot = (page, name) => page.screenshot({ path: path.join(SP, 'shots', name + '.png') });
const assert = (cond, msg) => { if (!cond) { throw new Error('ASSERT: ' + msg); } console.log('ok -', msg); };
/** Opens a row's ••• menu (or the header's ⋯ menu) and picks an item. */
const choose = async (page, trigger, item) => {
  await trigger.click();
  await page.getByRole('menuitem', { name: item }).click();
};
const rowMenu = (page, row, item) => choose(page, row.locator('.row-more').first(), item);
/** Pipeline only is on whenever the page loads; the tests below want every workstream. */
const allStages = async (page) => {
  const sw = page.getByRole('switch', { name: 'Pipeline only' });
  if ((await sw.count()) && (await sw.getAttribute('aria-checked')) === 'true') await sw.click();
};
const moreMenu = (page, item) => choose(page, page.getByRole('button', { name: 'More', exact: true }), item);

(async () => {
  const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 1600, height: 950 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? (global.nextPrompt ?? d.defaultValue()) : undefined));
  await page.goto(BASE + '/');
  assert(await page.getByText('No workstreams yet').count() === 1, 'starts with a blank plan');
  assert((await page.locator('select.plan-switcher option:checked').innerText()).startsWith('Default'), 'blank plan is called Default');
  await page.getByRole('button', { name: 'Manage', exact: true }).click();
  await page.getByRole('button', { name: 'Settings & data' }).click();
  await page.getByRole('button', { name: 'Load sample data' }).click();
  await page.getByRole('button', { name: 'Workstreams', exact: true }).first().click();
  await page.waitForSelector('.grid');

  // Defaults: pipeline workstreams only, not grouped by client, all collapsed.
  const pipelineSwitch = page.getByRole('switch', { name: 'Pipeline only' });
  assert((await pipelineSwitch.getAttribute('aria-checked')) === 'true', 'Pipeline only is on by default');
  assert(await page.getByRole('switch', { name: 'Issues only' }).count() === 0, 'Workstreams has Pipeline only instead of Issues only');
  const pipelineRows = await page.locator('tr.project-row').count();
  const samplePipeline = (await page.evaluate(() => JSON.parse(localStorage.getItem('capacity-plan:v1')).state.plan)).projects.filter((p) => p.status === 'pipeline').length;
  assert(pipelineRows === samplePipeline && pipelineRows > 0, `only pipeline workstreams shown (${pipelineRows})`);
  const groupBy = page.getByLabel('Group by', { exact: true });
  assert((await groupBy.inputValue()) === 'none', 'Group by is None by default');
  assert(await page.locator('tr.group-row').count() === 0 && await page.locator('tr.role-row').count() === 0, 'workstreams start collapsed and ungrouped');
  const firstWs = page.locator('tr.project-row').first();
  const [nameBox, clientBox] = await Promise.all([firstWs.locator('.ws-name').boundingBox(), firstWs.locator('.row-title .client').boundingBox()]);
  assert(clientBox && Math.abs(nameBox.y - clientBox.y) < 4 && clientBox.x > nameBox.x, 'client is on the first line, after the workstream name');
  assert(await firstWs.locator('.row-meta .fte').count() === 0, 'no FTE text in the label column');
  // Clicking anywhere on the row (not just the arrow) expands and collapses it.
  await firstWs.locator('.row-meta').click({ position: { x: 200, y: 6 } });
  assert(await page.locator('tr.role-row').count() > 0, 'clicking the row expands it');
  await firstWs.locator('.ws-name').click();
  assert(await page.locator('tr.role-row').count() === 0, 'clicking its name collapses it again');
  await shot(page, '00-defaults');
  await pipelineSwitch.click();
  assert(await page.locator('tr.project-row').count() > pipelineRows, 'turning Pipeline only off shows won and lost workstreams');
  // The rest of the run uses the full layout: grouped by client and expanded.
  await groupBy.selectOption('client');
  await page.locator('.corner-actions').getByRole('button', { name: 'Expand all', exact: true }).click();
  await shot(page, '01-projects-week');

  // Sample conflicts are visible.
  const panel = page.locator('.conflicts');
  assert(await panel.getByText('Alex Rivera').count() > 0, 'conflicts panel lists Alex (at risk)');
  assert(await page.locator('.cell.risk').count() > 0, 'amber at-risk cells shown');
  assert(await page.locator('.cell.tentative').count() > 0, 'tentative pipeline cells shown');
  assert(await page.locator('.cell.excluded').count() > 0, 'lost-project delivery cells shown as not counted');
  assert(await panel.getByText('Sam Patel').count() > 0, 'conflicts panel lists Sam');
  assert(await panel.getByText('Riley Thompson').count() > 0, 'skill mismatch for Riley listed');
  assert(await page.locator('.cell.over').count() > 0, 'over cells highlighted in project view');

  const val = (loc) => loc.getAttribute('data-value').then(Number);
  const plan = () => page.evaluate(() => JSON.parse(localStorage.getItem('capacity-plan:v1')).state.plan);
  assert(await page.locator('.grid svg.pie').count() > 20 && await page.locator('.grid .bar').count() === 0, 'allocations render as circles by default');
  await page.getByRole('button', { name: 'Bars', exact: true }).click();
  assert(await page.locator('.bar').count() > 20, 'the Bars display draws bars');
  assert(await page.locator('[id="row-a:sample-a1"] .bar-label').count() < await page.locator('[id="row-a:sample-a1"] td.filled').count(), 'FTE is labelled where a bar starts or changes, not every week');

  // Click cycles an empty cell 0 → 25 → 50 → 100 → 0 (Drew on Initech, before the project starts).
  const row = page.locator('[id="row-a:sample-a11"]');
  const cells = row.locator('td.cell');
  const seen = [];
  await cells.nth(0).click();
  assert((await val(cells.nth(0))) === 0, 'single click only selects');
  for (let i = 0; i < 4; i++) { await cells.nth(0).dblclick(); seen.push(await val(cells.nth(0))); }
  assert(JSON.stringify(seen) === '[25,50,100,0]', `double-click cycles 25,50,100,0: ${seen}`);
  await shot(page, '02-bars');

  // Range: click, shift-click to extend, type an off-step value → snaps.
  await cells.nth(0).click();
  await cells.nth(2).click({ modifiers: ['Shift'] });
  await page.keyboard.type('80');
  await page.keyboard.press('Enter');
  const texts = await Promise.all([0, 1, 2, 3].map((i) => val(cells.nth(i))));
  assert(JSON.stringify(texts) === '[100,100,100,0]', `typed 80 snapped to 100 across range: ${texts}`);

  // Delete clears.
  await cells.nth(2).click();
  await cells.nth(1).click({ modifiers: ['Shift'] });
  await page.keyboard.press('Delete');
  assert((await val(cells.nth(1))) === 0 && (await val(cells.nth(2))) === 0, 'Delete clears the selection');

  // Clicking Riley on Acme from 50 → 100 pushes Riley (also 25 on Globex) over capacity.
  const riley = page.locator('[id="row-a:sample-a3"] td.cell');
  await page.locator('.grid-scroll').evaluate((el) => el.scrollTo(0, 0));
  assert((await val(riley.nth(4))) === 50, 'Riley starts at 50');
  await riley.nth(4).dblclick();
  assert((await val(riley.nth(4))) === 100, 'double-click advanced Riley to 100');
  // 100 on Acme + 25 on Globex = 125%: stretched (orange), not overallocated (red).
  assert(await riley.nth(4).evaluate((el) => el.classList.contains('stretch') && !el.classList.contains('over')), 'Riley cell flagged stretched (125%)');
  assert(await panel.locator('li', { hasText: 'Riley Thompson' }).locator('.pill-stretch').count() > 0, 'Riley in stretched list');
  const rileyColor = await riley.nth(4).evaluate((el) => getComputedStyle(el).backgroundColor);
  const samColor = await page.locator('td.cell.over').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  assert(rileyColor !== samColor, `orange and red cells differ (${rileyColor} vs ${samColor})`);
  await page.keyboard.press('Control+z');
  assert((await val(riley.nth(4))) === 50, 'Ctrl+Z reverted the click');

  // Drag-select across Alex / Riley / Sam on Acme, Space cycles all to the step after the focus cell.
  const a1 = page.locator('[id="row-a:sample-a1"] td.cell');
  const a2 = page.locator('[id="row-a:sample-a2"] td.cell');
  const a3 = page.locator('[id="row-a:sample-a3"] td.cell');
  const b1 = await a1.nth(5).boundingBox();
  const b2 = await a2.nth(6).boundingBox();
  await page.mouse.move(b1.x + 10, b1.y + 10);
  await page.mouse.down();
  await page.mouse.move(b2.x + 10, b2.y + 10, { steps: 5 });
  await page.mouse.up();
  assert(await page.locator('td.selected').count() === 6, 'drag selected 3 rows x 2 cols');
  assert((await val(a1.nth(5))) === 50, 'drag did not change values');
  await page.keyboard.type('25');
  await page.keyboard.press('Enter');
  const dragVals = await Promise.all([a1, a2, a3].flatMap((r) => [r.nth(5), r.nth(6)]).map(val));
  assert(dragVals.every((v) => v === 25), `drag-selected 3x2 filled with 25: ${dragVals}`);
  await page.keyboard.press('Control+z');
  assert((await val(a1.nth(5))) === 50, 'Ctrl+Z reverted the range fill');

  // Month zoom: clicking a month cell sets every week in it to the next step.
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await shot(page, '03-projects-month');
  const m1 = page.locator('[id="row-a:sample-a1"] td.cell');
  await m1.nth(1).dblclick();
  assert((await val(m1.nth(1))) === 100, 'month cell cycled 50 → 100');
  const a = (await plan()).assignments.find((x) => x.id === 'sample-a1');
  const n100 = Object.values(a.weekly).filter((v) => v === 100).length;
  assert(n100 >= 4 && n100 <= 5, `month click set ${n100} weeks to 100`);
  await page.getByRole('button', { name: /Undo/ }).click();
  const a2s = (await plan()).assignments.find((x) => x.id === 'sample-a1');
  assert(Object.values(a2s.weekly).every((v) => v === 50), 'undo button reverted the month edit');
  await page.getByRole('button', { name: 'Week', exact: true }).click();

  // Numbers display toggle.
  await page.getByRole('button', { name: 'Numbers', exact: true }).click();
  assert((await a1.nth(5).innerText()).trim() === '50', 'number display shows every week\'s value');
  await page.getByRole('button', { name: 'Circles', exact: true }).click();
  assert((await page.locator('.grid svg.pie').count()) > 20 && (await page.locator('.grid .bar').count()) === 0, 'circles display draws a Harvey ball per booked week instead of bars');
  assert(await page.locator('.grid .pie-tentative').count() > 0 && await page.locator('.grid .pie-open').count() > 0, 'circles keep the booking state (tentative, open role)');
  await shot(page, '03-circles');
  await page.reload();
  await page.waitForSelector('.grid');
  await allStages(page);
  assert((await page.locator('.grid svg.pie').count()) > 20, 'the display choice survives a reload');
  await page.getByRole('button', { name: 'Bars', exact: true }).click();

  // Quarter view + resources view screenshots.
  await page.getByRole('button', { name: 'Quarter', exact: true }).click();
  await shot(page, '04-projects-quarter');
  await page.getByRole('button', { name: 'Resources', exact: true }).click();
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await shot(page, '05-resources-month');
  await page.getByRole('button', { name: 'Week', exact: true }).click();
  assert(await page.locator('td.heat-over').count() > 0, 'resource view shows red heat cells');
  // Grouped by career level, most senior first, collapsible.
  const groupTitles = await page.locator('tr.group-row .row-title strong').allInnerTexts();
  assert(JSON.stringify(groupTitles) === '["SM","M","SA","A"]', `level groups in order: ${groupTitles}`);
  const smGroup = page.locator('[id="row-g:SM"]');
  assert((await smGroup.innerText()).includes('1 person'), 'group shows headcount');
  await smGroup.locator('.twisty').click();
  assert(await page.locator('[id="row-r:res-alex"]').count() === 0, 'collapsing SM hides Alex');
  await page.locator('[id="row-g:SM"] .twisty').click();
  assert(await page.locator('[id="row-r:res-alex"] .level-badge').innerText() === 'SM', 'Alex shows level badge');
  await shot(page, '17-levels');
  await shot(page, '06-resources-week');

  // Conflicts-only filter: people on Resources, workstreams on Workstreams.
  const toggle = page.getByRole('switch', { name: 'Issues only' });
  const peopleBefore = await page.locator('tr[id^="row-r:"]').count();
  assert((await toggle.getAttribute('aria-checked')) === 'false', 'Issues only is a switch, off by default');
  await toggle.click();
  assert((await toggle.getAttribute('aria-checked')) === 'true', 'switch turns on');
  const people = await page.locator('tr[id^="row-r:"] .row-title').allInnerTexts();
  assert(people.length < peopleBefore && people.length > 0, `conflicts-only trims people: ${peopleBefore} -> ${people.length}`);
  assert(people.some((t) => t.includes('Sam Patel')) && !people.some((t) => t.includes('Taylor Brooks')), 'Sam (over) stays, Taylor (clear) hidden');
  await shot(page, '18-conflicts-only-people');
  await page.getByLabel('View').getByRole('button', { name: 'Workstreams' }).click();
  assert(await page.locator('tr[id^="row-p:"]').count() === 6, 'Issues only from Resources never hides workstreams');
  await page.getByLabel('View').getByRole('button', { name: 'Resources' }).click();
  await toggle.click();

  // Conflict click jumps to resource row and expands it.
  await page.getByRole('button', { name: 'Workstreams', exact: true }).click();
  await panel.getByRole('button', { name: /Sam Patel/ }).first().click();
  await page.waitForTimeout(200);
  assert(await page.locator('nav[aria-label=View] button[aria-pressed="true"]', { hasText: 'Resources' }).count() === 1, 'jumped to resource view');
  assert(await page.locator('[id="row-r:res-sam"].flash').count() === 1, 'Sam row flashed');
  assert(await page.locator('[id="row-a:sample-a2"]').count() === 1, 'Sam row expanded showing assignments');
  await shot(page, '07-jump-to-conflict');

  // Winning the pipeline deal turns Alex's risk into a real overallocation.
  await page.getByRole('button', { name: 'Workstreams', exact: true }).click();
  const overBefore = await panel.locator('li').filter({ hasText: 'Alex Rivera' }).locator('.pill-over').count();
  assert(overBefore === 0, 'Alex not overallocated while Contoso is pipeline');
  await page.locator('[id="row-p:proj-contoso"] select.status-select').selectOption('won');
  assert(await panel.locator('li').filter({ hasText: 'Alex Rivera' }).locator('.pill-over').count() > 0, 'Alex overallocated once Contoso is won');
  await shot(page, '12-contoso-won');
  await page.keyboard.press('Escape');
  await page.locator('.grid-scroll').focus();
  await page.keyboard.press('Control+z');
  assert(await page.locator('[id="row-p:proj-contoso"] select.status-select').inputValue() === 'pipeline', 'undo restored pipeline status');

  // One row per person per workstream: Alex has a single Contoso row holding presales and delivery weeks.
  assert(await page.locator('[id^="row-a:"]', { hasText: 'Alex Rivera' }).count() === 2, 'Alex has one row on each of his 2 workstreams');
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  const alexRowId = (await plan()).assignments.find((x) => x.projectId === 'proj-contoso' && x.resourceId === 'res-alex').id;
  const alexContoso = page.locator(`[id="row-a:${alexRowId}"]`);
  assert(await alexContoso.locator('td.presales.filled').count() > 0, 'pre-start weeks on the row are presales');
  assert(await alexContoso.locator('td.delivery.tentative.filled').count() > 0, 'post-start weeks on the row are tentative delivery');

  // Persistence across reload (Drew 150s remain).
  await page.reload();
  await page.waitForSelector('.grid');
  await allStages(page);
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('capacity-plan:v1')).state.plan);
  assert(Object.keys(st.assignments.find((x) => x.id === 'sample-a11').weekly).length === 16, 'data persisted across reload');

  // Add person dialog from project view.
  await page.getByRole('button', { name: 'Workstreams', exact: true }).click();
  await rowMenu(page, page.locator('[id="row-p:proj-northwind"]'), 'Add a person…');
  await shot(page, '08-add-person-dialog');
  assert(await page.locator('.modal [aria-label="Type of work"]').count() === 0, 'no presales/delivery picker');
  assert(await page.locator('.modal .segmented[aria-label="Allocation"] button').count() === 3, 'dialog offers 25/50/100');
  assert(await page.locator('.modal .candidate input[type=checkbox]').count() > 1, 'candidates are checkboxes');
  await page.locator('.candidate', { hasText: 'Jamie Ortiz' }).click();
  await page.locator('.candidate', { hasText: 'Drew Okafor' }).click();
  assert((await page.locator('.modal .btn-primary').innerText()).startsWith('Add 2 people'), 'button counts ticked people');
  await page.locator('.modal').getByRole('button', { name: /^Add/ }).click();
  const st3 = await page.evaluate(() => JSON.parse(localStorage.getItem('capacity-plan:v1')).state.plan);
  assert(st3.assignments.some((x) => x.projectId === 'proj-northwind' && x.resourceId === 'res-jamie' && Object.keys(x.weekly).length === 13), 'Jamie added to Northwind for 13 weeks');
  assert(await page.locator('[id="row-p:proj-northwind"]').locator('.badge-warn', { hasText: /^Gap/ }).count() === 0, 'Agentforce now covered on Northwind');
  assert(st3.assignments.some((x) => x.projectId === 'proj-northwind' && x.resourceId === 'res-drew'), 'Drew added in the same step');

  // Help: toolbar button and the ? key.
  await page.getByRole('button', { name: /Help/ }).click();
  assert(await page.locator('dialog[open]', { hasText: 'interactions & shortcuts' }).count() === 1, 'Help opens from the toolbar');
  await shot(page, '15-help');
  await page.keyboard.press('Escape');
  assert(await page.locator('dialog[open]').count() === 0, 'Esc closes help');
  await page.locator('.grid-scroll').focus();
  await page.keyboard.press('Shift+Slash');
  assert(await page.locator('dialog[open]', { hasText: 'interactions & shortcuts' }).count() === 1, '? opens help');
  await page.keyboard.press('Escape');

  // New project with a brand-new tag and a new seller-less project.
  await page.getByRole('button', { name: '+ Workstream', exact: true }).click();
  await page.locator('.modal input').first().fill('Heroku Migration');
  await page.locator('.modal .combo input').fill('Heroku');
  await page.keyboard.press('Enter');
  assert(await page.locator('.modal .chip', { hasText: 'Heroku' }).count() === 1, 'new tag created inline');
  await shot(page, '09-new-project');
  await page.getByRole('button', { name: 'Create workstream' }).click();
  assert(await page.getByText('Heroku Migration').count() > 0, 'new project in grid');

  // CSV downloads: one workstream, and all workstreams.
  await page.getByRole('button', { name: 'Workstreams', exact: true }).click();
  const fs = require('fs');
  const [csv1] = await Promise.all([
    page.waitForEvent('download'),
    rowMenu(page, page.locator('[id="row-p:proj-contoso"]'), 'Download CSV'),
  ]);
  const f1 = path.join(SP, 'contoso.csv');
  await csv1.saveAs(f1);
  const t1 = fs.readFileSync(f1, 'utf8');
  assert(csv1.suggestedFilename().startsWith('staffing-agentforce-service-pilot-'), `workstream CSV filename: ${csv1.suggestedFilename()}`);
  assert(t1.startsWith('\uFEFFWorkstream,Agentforce Service Pilot') && t1.includes('\r\nPhase,') && t1.includes('\r\nTotal FTE,'), 'workstream CSV content');
  const [csv2] = await Promise.all([page.waitForEvent('download'), moreMenu(page, 'Export staffing (CSV)')]);
  const f2 = path.join(SP, 'all.csv');
  await csv2.saveAs(f2);
  assert(fs.readFileSync(f2, 'utf8').startsWith('\uFEFFWorkstream,Client,Seller,Status,Role,Person,Level,Week of,Phase,Allocation %'), 'all-workstreams CSV content');
  await shot(page, '16-csv-buttons');

  // Export, clear, import.
  const [download] = await Promise.all([page.waitForEvent('download'), moreMenu(page, 'Export plan (JSON)')]);
  const file = path.join(SP, 'export.json');
  await download.saveAs(file);
  assert(await page.locator('.export-status.dirty').count() === 0, 'export status clean after export');
  await page.getByRole('button', { name: 'Manage', exact: true }).click();
  // Set a level from Manage → Resources; the person moves to that group.
  await page.locator('nav[aria-label=Manage] button', { hasText: 'Resources' }).click();
  const taylorRow = page.locator('table.table tr:has(input[value="Taylor Brooks"])');
  await taylorRow.locator('select[aria-label="Career level"]').selectOption('D');
  await page.getByRole('button', { name: 'Resources', exact: true }).first().click();
  assert((await page.locator('tr.group-row .row-title strong').first().innerText()) === 'D', 'D group appears first after setting a level');
  await page.getByRole('button', { name: 'Manage', exact: true }).click();
  await shot(page, '10-manage-resources');
  await page.getByRole('button', { name: 'Settings & data' }).click();
  await page.getByRole('button', { name: 'Start empty' }).click();
  await page.getByRole('button', { name: 'Workstreams', exact: true }).first().click();
  assert(await page.getByText('No workstreams yet').count() === 1, 'plan cleared');
  await page.locator('input[type=file]').setInputFiles(file);
  await page.waitForTimeout(200);
  assert(await page.getByText('Heroku Migration').count() > 0, 'import restored the plan');

  // ---- Group by client (#14)
  const fsx = require('fs');
  await page.getByRole('button', { name: 'Workstreams', exact: true }).first().click();
  const clientTitles = await page.locator('tr.group-row .row-title').allInnerTexts();
  assert(clientTitles.length >= 3, `client groups shown: ${clientTitles.length}`);
  assert(clientTitles[clientTitles.length - 1].startsWith('No client'), 'workstreams without a client grouped last');
  await shot(page, '20-group-by-client');
  await page.getByRole('button', { name: 'Groups only' }).click();
  assert(await page.locator('tr.project-row').count() === 0, 'Groups only collapses to one row per client');
  await page.locator('.corner-actions').getByRole('button', { name: 'Expand all', exact: true }).click();
  assert((await groupBy.inputValue()) === 'client', 'Group by stays on Client as chosen earlier');
  await groupBy.selectOption('none');
  assert(await page.locator('tr.group-row').count() === 0, 'Group by None removes the group rows');
  await groupBy.selectOption('stage');
  const stageTitles = await page.locator('tr.group-row .row-title strong').allInnerTexts();
  assert(JSON.stringify(stageTitles) === '["Pipeline","Won","Lost"]', `grouped by stage in pipeline → won → lost order: ${stageTitles}`);
  await groupBy.selectOption('seller');
  const sellerTitles = await page.locator('tr.group-row .row-title').allInnerTexts();
  assert(sellerTitles.length >= 2 && sellerTitles.every((t) => !t.includes('No client')), `grouped by seller: ${sellerTitles.length} groups`);
  await shot(page, '20b-group-by-seller');
  await groupBy.selectOption('client');

  // ---- Win % on pipeline workstreams: sorts, filters, and lightens the risk it causes
  const contosoWs = page.locator('[id="row-p:proj-contoso"]');
  const win = contosoWs.getByLabel(/^Win probability for/);
  assert((await win.inputValue()) === '', 'a pipeline workstream starts with no win %');
  assert(await page.locator('[id="row-p:proj-northwind"]').getByLabel(/^Win probability for/).count() === 0, 'won workstreams have no win %');
  const alexRisk = () => page.locator('tr.role-row', { hasText: 'Alex Rivera' }).locator('.badge-risk').first();
  assert((await alexRisk().innerText()) === 'Low risk' && (await page.locator('.issue-band.issue-low').count()) > 0, 'unset win %: the pipeline risk is a low (lighter) risk');
  await win.selectOption('90');
  assert((await alexRisk().innerText()) === 'At risk' && (await page.locator('.issue-band.issue-low').count()) === 0, 'at 90% it is a full risk');
  assert((await plan()).projects.find((p) => p.id === 'proj-contoso').winProbability === 90, 'win % is saved on the workstream');
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByLabel('Filter by win probability').selectOption('90');
  assert(await contosoWs.count() === 1, '≥90% filter keeps a 90% workstream');
  await win.selectOption('50');
  assert(await contosoWs.count() === 0, '…and hides it once it drops to 50%');
  assert(await page.locator('[id="row-p:proj-northwind"]').count() === 1, '…without hiding won workstreams');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Filters/ }).click();
  await page.getByLabel('Filter by win probability').selectOption('');
  await page.keyboard.press('Escape');
  await page.locator('.grid-scroll').focus();
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  assert((await plan()).projects.find((p) => p.id === 'proj-contoso').winProbability === undefined, 'undo clears the win % again');

  // ---- Capacity panel + underutilized filter (#12)
  await page.getByRole('button', { name: /Capacity/ }).click();
  const util = page.locator('aside[aria-label=Capacity]');
  assert(await util.count() === 1, 'capacity panel opens');
  assert(await page.locator('.conflicts').count() === 0, 'one side panel at a time');
  assert(/^\d+%$/.test(await util.locator('.metric-big').innerText()), 'planned utilization headline');
  const shares = await util.locator('.metric-row strong').allInnerTexts();
  assert(shares.length === 3 && shares.every((t) => /^\d+%$/.test(t)), `won / pipeline / headroom shares: ${shares}`);
  assert((await util.locator('.metric-caption').innerText()).includes('FTE-weeks'), 'states the denominator');
  assert(await util.locator('.person-cap').count() >= 8, 'one row per person');
  await util.locator('.person-cap-main', { hasText: 'Sam Patel' }).click();
  assert(await page.locator('tr.highlighted').count() > 0 && await page.locator('tr.dimmed').count() > 0, 'clicking a person highlights their rows and dims the rest');
  await shot(page, '21-capacity');
  await util.locator('.person-cap-main', { hasText: 'Sam Patel' }).click();
  assert(await page.locator('tr.dimmed').count() === 0, 'clicking again clears the highlight');
  await util.getByRole('button', { name: /^Show .* in Resources$/ }).first().click();
  assert(await page.locator('tr.flash, tr.resource-row').count() > 0, 'clicking a person jumps to Resources');
  const allPeople = await page.locator('tr.resource-row').count();
  await page.getByRole('switch', { name: 'Underutilized' }).click();
  const under = await page.locator('tr.resource-row').count();
  assert(under > 0 && under < allPeople, `underutilized narrows people: ${allPeople} → ${under}`);
  assert(await page.locator('.badge-under').count() === under, 'each shows its 10-week committed %');
  await shot(page, '22-underutilized');
  await page.getByRole('switch', { name: 'Underutilized' }).click();

  // ---- Plans (#17)
  const planNames = () => page.locator('select.plan-switcher option:not([disabled])').allInnerTexts();
  assert(download.suggestedFilename().startsWith('default-v1-'), `export filename: ${download.suggestedFilename()}`);
  const exported = JSON.parse(fsx.readFileSync(file, 'utf8'));
  assert(exported.name === 'Default' && exported.revision === 1 && exported.version === 4, 'export carries name + revision');
  assert((await planNames())[0].startsWith('Default · v1'), 'switcher shows version after export/import');
  await page.getByRole('button', { name: 'Workstreams', exact: true }).first().click();
  global.nextPrompt = 'Scenario B';
  await page.locator('select.plan-switcher').selectOption('__new');
  assert(await page.getByText('No workstreams yet').count() === 1, 'new plan is empty');
  assert((await planNames()).some((n) => n.startsWith('Scenario B')), 'new plan listed');
  // Import a file with another name → new plan; same name → overwrite.
  const other = path.join(SP, 'other.json');
  fsx.writeFileSync(other, JSON.stringify({ ...exported, name: 'Imported', revision: 7 }));
  await page.locator('input[type=file]').setInputFiles(other);
  await page.waitForTimeout(200);
  assert((await page.locator('select.plan-switcher option:checked').innerText()).startsWith('Imported · v7'), 'different name imports as a new, opened plan');
  assert((await planNames()).filter((n) => !n.includes('New plan') && !n.includes('Manage')).length === 3, 'three plans');
  await page.locator('input[type=file]').setInputFiles(other);
  await page.waitForTimeout(200);
  assert((await planNames()).filter((n) => !n.includes('New plan') && !n.includes('Manage')).length === 3, 'same name overwrites instead of adding');
  const defaultId = await page.locator('select.plan-switcher option', { hasText: 'Default' }).getAttribute('value');
  await page.locator('select.plan-switcher').selectOption(defaultId);
  assert(await page.getByText('Heroku Migration').count() > 0, 'switching back restores the Default plan');
  // Manage → Plans: rename and delete.
  await page.locator('select.plan-switcher').selectOption('__manage');
  assert(await page.locator('table.table tr.current input[value="Default"]').count() === 1, 'Manage → Plans marks the open plan');
  await shot(page, '23-manage-plans');
  await page.locator('table.table input[value="Scenario B"]').fill('Imported');
  await page.keyboard.press('Enter');
  assert(await page.locator('table.table input[value="Scenario B"]').count() === 1, 'duplicate rename refused');
  await page.getByRole('button', { name: 'Delete plan Scenario B' }).click();
  assert(await page.locator('table.table tbody tr').count() === 2, 'plan deleted');
  await page.reload();
  await page.waitForSelector('select.plan-switcher');
  assert((await planNames()).filter((n) => !n.includes('New plan') && !n.includes('Manage')).length === 2, 'plans persist across reload');

  // ---- Open roles (#20)
  const planNow = () => page.evaluate(() => JSON.parse(localStorage.getItem('capacity-plan:v1')).state.plan);
  await page.getByRole('button', { name: 'Workstreams', exact: true }).first().click();
  const contosoRow = page.locator('[id="row-p:proj-contoso"]');
  assert((await contosoRow.locator('.badge-open').innerText()) === '1 open', 'workstream shows its open role count');
  const roleRow = page.locator('[id="row-a:sample-role1"]');
  assert(await roleRow.count() === 1, 'open role row sits under the workstream');
  assert(await roleRow.locator('td.cell.open-role.filled').count() > 0, 'open role cells drawn as demand');
  assert(await roleRow.locator('td.cell.over, td.cell.risk, td.cell.stretch').count() === 0, 'open roles are never flagged');
  if (await page.locator('.conflicts').count() === 0) await page.locator('.issue-chip').click();
  assert(await page.locator('.conflicts').getByText('Agentforce Architect').count() > 0, 'conflicts panel lists the open role');
  await rowMenu(page, contosoRow, 'Add an open role…');
  await page.locator('.modal input').first().fill('Service Cloud Lead');
  await page.getByRole('button', { name: 'Add open role' }).click();
  assert((await contosoRow.locator('.badge-open').innerText()) === '2 open', 'open role added from the workstream row');
  // A role with someone in it from the start.
  await rowMenu(page, contosoRow, 'Add an open role…');
  await page.locator('.modal input').first().fill('Engagement Lead');
  await page.locator('.modal select[aria-label=Person]').selectOption({ label: 'Drew Okafor (M)' });
  await page.getByRole('button', { name: 'Add role', exact: true }).click();
  const lead = (await planNow()).assignments.find((a) => a.name === 'Engagement Lead');
  assert(lead && lead.resourceId === 'res-drew', 'role added with a person in it');
  assert(await page.locator(`[id="row-a:${lead.id}"] .person-name`, { hasText: 'Drew Okafor' }).count() === 1, 'shows as role › person');
  // Click the person to change who's in the role, or leave it open.
  await page.locator(`[id="row-a:${lead.id}"] .person-name`).click();
  await page.getByRole('button', { name: 'Leave open' }).click();
  assert(await page.locator(`[id="row-a:${lead.id}"] .badge-open`).count() === 1, 'Leave open frees the person and keeps the role');
  assert((await contosoRow.locator('.badge-open').innerText()) === '3 open', 'now three open roles');
  await shot(page, '30-open-roles');
  await roleRow.getByRole('button', { name: 'Fill…' }).click();
  const firstCandidate = await page.locator('.modal .candidate-name').first().innerText();
  assert(firstCandidate.startsWith('Alex Rivera'), `best match ranked first (Agentforce, SM): ${firstCandidate.split('\n')[0]}`);
  await shot(page, '31-fill-role');
  await page.locator('.modal .candidate', { hasText: 'Casey Nguyen' }).click();
  await page.getByRole('button', { name: 'Fill with Casey Nguyen' }).click();
  assert((await roleRow.locator('.person-name').innerText()) === 'Casey Nguyen', 'Casey is now in the role, on its own row');
  assert((await contosoRow.locator('.badge-open').innerText()) === '2 open', 'one fewer open role');
  const filledRole = (await planNow()).assignments.find((a) => a.id === 'sample-role1');
  assert(filledRole.resourceId === 'res-casey' && filledRole.name === 'Agentforce Architect', 'role keeps its name and weeks');
  await page.locator('.grid-scroll').focus();
  await page.keyboard.press('Control+z');
  assert(await roleRow.locator('.badge-open').count() === 1, 'undo makes it open again');
  const util2 = page.locator('aside[aria-label=Capacity]');
  if (await util2.count() === 0) await page.getByRole('button', { name: /Capacity/ }).click();
  await util2.getByRole('button', { name: 'Open roles' }).click();
  assert(await util2.locator('.role-caps li', { hasText: 'Agentforce Architect' }).count() === 1, 'capacity panel lists open roles in the window');
  await util2.getByRole('button', { name: 'Capabilities' }).click();
  assert(await util2.locator('.util-table').getByText('Agentforce').count() === 1, 'Agentforce demand vs bench row');
  await shot(page, '32-demand-vs-bench');

  // ---- Utilization targets (#21)
  await util2.getByRole('button', { name: 'People' }).click();
  assert(await util2.locator('.psub', { hasText: 'vs target' }).count() >= 8, 'capacity panel compares with level targets');
  await page.getByRole('button', { name: 'Resources', exact: true }).first().click();
  await page.getByRole('switch', { name: 'Underutilized' }).click();
  const underDefault = await page.locator('tr.resource-row').count();
  assert(await page.locator('.badge-under', { hasText: 'target' }).count() === underDefault, `badges show % vs target (${underDefault} under)`);
  await page.getByRole('button', { name: 'Manage', exact: true }).click();
  await page.getByRole('button', { name: 'Settings & data' }).click();
  for (const l of ['D', 'SM', 'M', 'SA', 'A']) await page.getByLabel(`Target for ${l}`).fill('0');
  await shot(page, '33-targets');
  await page.getByRole('button', { name: 'Resources', exact: true }).first().click();
  assert(await page.locator('tr.resource-row').count() === 0, 'nobody is under a 0% target');
  await page.getByRole('button', { name: 'Manage', exact: true }).click();
  await page.getByRole('button', { name: 'Reset to defaults' }).click();
  assert((await page.getByLabel('Target for D').inputValue()) === '40', 'targets reset to defaults');
  await page.getByRole('button', { name: 'Resources', exact: true }).first().click();
  await page.getByRole('switch', { name: 'Underutilized' }).click();

  // ---- Slipped deal (#19)
  await page.getByRole('button', { name: 'Workstreams', exact: true }).first().click();
  const before = await planNow();
  const contoso = before.projects.find((p) => p.id === 'proj-contoso');
  const alexBefore = before.assignments.find((a) => a.projectId === 'proj-contoso' && a.resourceId === 'res-alex').weekly;
  const plus = (w, n) => { const d = new Date(w + 'T00:00:00'); d.setDate(d.getDate() + 7 * n); return d.toISOString().slice(0, 10); };
  await rowMenu(page, contosoRow, 'Details');
  // ---- Details modal (workstream)
  const details = page.locator('dialog[open]');
  assert((await details.locator('h2').first().innerText()) === 'Agentforce Service Pilot', 'clicking a workstream opens its details');
  assert(await details.locator('.check.fail', { hasText: 'All upcoming roles filled' }).count() === 1, 'details: open roles flagged as a warning');
  assert(await details.locator('.check.ok', { hasText: 'Has a seller' }).count() === 1, 'details: passed checks listed');
  assert(await details.locator('h3', { hasText: 'Filled roles' }).count() === 1 && await details.locator('h3', { hasText: 'Open roles' }).count() === 1, 'details: filled and open roles');
  await shot(page, '40-workstream-details');
  await page.getByRole('button', { name: 'Edit workstream' }).click();
  await page.locator('.modal label', { hasText: 'Start (week of)' }).locator('input').fill(plus(contoso.startWeek, 3));
  const offer = page.locator('.shift-offer');
  assert(await offer.count() === 1 && (await offer.locator('input').isChecked()), 'moving the start offers to move the staffing (on by default)');
  assert((await offer.innerText()).includes('+3 weeks'), 'offer states the shift');
  await shot(page, '34-slip');
  await page.getByRole('button', { name: 'Save' }).click();
  assert((await page.locator('dialog[open] h2').first().innerText()) === 'Agentforce Service Pilot', 'saving an edit returns to the details');
  await page.locator('dialog[open] .modal-footer').getByRole('button', { name: 'Close' }).click();
  const after = await planNow();
  const c2 = after.projects.find((p) => p.id === 'proj-contoso');
  const alexAfter = after.assignments.find((a) => a.projectId === 'proj-contoso' && a.resourceId === 'res-alex').weekly;
  assert(c2.startWeek === plus(contoso.startWeek, 3) && c2.endWeek === plus(contoso.endWeek, 3), 'start and end both moved +3');
  const deliveryWeek = Object.keys(alexBefore).filter((w) => w >= contoso.startWeek).sort()[0];
  const presalesWeek = Object.keys(alexBefore).filter((w) => w < contoso.startWeek).sort()[0];
  assert(alexAfter[plus(deliveryWeek, 3)] === alexBefore[deliveryWeek], 'delivery weeks moved with the start');
  assert(alexAfter[presalesWeek] === alexBefore[presalesWeek], 'presales weeks stayed put');
  await page.locator('.grid-scroll').focus();
  await page.keyboard.press('Control+z');
  const undone = await planNow();
  assert(undone.projects.find((p) => p.id === 'proj-contoso').startWeek === contoso.startWeek &&
    JSON.stringify(undone.assignments.find((a) => a.projectId === 'proj-contoso' && a.resourceId === 'res-alex').weekly) === JSON.stringify(alexBefore),
    'one undo restores dates and staffing');

  // ---- Details modal (person)
  await page.getByRole('button', { name: 'Resources', exact: true }).first().click();
  await page.locator('tr.resource-row').getByRole('button', { name: 'Sam Patel', exact: true }).click();
  const pd = page.locator('dialog[open]');
  assert((await pd.locator('h2').first().innerText()) === 'Sam Patel', 'clicking a person opens their details');
  assert(await pd.locator('.check.fail', { hasText: 'Not over capacity' }).count() === 1, 'person details: overallocation warning');
  assert(await pd.locator('.stat-label', { hasText: 'target' }).count() === 1, 'person details: utilization vs target');
  await shot(page, '41-person-details');
  // From a person, jump to one of their workstreams' details.
  await pd.locator('.details-table .link').first().click();
  assert((await page.locator('dialog[open] .details-subtitle').count()) === 1 && (await page.locator('dialog[open] h3', { hasText: 'Filled roles' }).count()) === 1, 'person → workstream details');
  await page.keyboard.press('Escape');
  assert(await page.locator('dialog[open]').count() === 0, 'Esc closes details');

  // ---- Demand view
  await page.getByRole('button', { name: 'Demand', exact: true }).click();
  const demand = page.locator('.demand');
  const sections = await demand.locator('.demand-header h2').allInnerTexts();
  assert(sections[0].startsWith('Pipeline') && sections[1].startsWith('Won'), `demand: pipeline and won sections (${sections.join(' / ')})`);
  const contosoDemand = demand.locator('tr', { hasText: 'Agentforce Service Pilot' });
  assert(await contosoDemand.locator('td').nth(2).locator('.role-chip').count() >= 2, 'demand: who is supporting the pursuit');
  assert(await contosoDemand.locator('.role-chip.open').count() >= 1, 'demand: open roles');
  assert(await demand.locator('tr', { hasText: 'Commerce Replatform' }).count() === 0, 'demand: lost workstreams left out');
  await shot(page, '42-demand');
  await contosoDemand.locator('td').nth(3).locator('.role-chip').first().click();
  assert(await page.locator('dialog[open] .stat-label', { hasText: 'target' }).count() === 1, 'demand: person chip opens person details');
  await page.keyboard.press('Escape');

  // ---- Drag bars, rollups, inspector, density (design follow-ups)
  await page.getByRole('button', { name: 'Workstreams', exact: true }).first().click();
  await page.getByRole('button', { name: 'Week', exact: true }).click();
  // A bar whose end has two empty weeks after it.
  const target = await page.evaluate(() => {
    for (const td of document.querySelectorAll('tr[id^="row-a:"] td.cell')) {
      if (!td.querySelector('.bar-handle.end')) continue;
      const n1 = td.nextElementSibling, n2 = n1?.nextElementSibling;
      if (n1?.dataset.value === '0' && n2?.dataset.value === '0') return { row: td.closest('tr').id, pos: td.dataset.pos, value: Number(td.dataset.value) };
    }
    return null;
  });
  assert(target, 'found a bar to drag');
  const [tr, tc] = target.pos.split(':').map(Number);
  const cellAt = (c) => page.locator(`[data-pos="${tr}:${c}"]`);
  const roleId = target.row.slice('row-a:'.length);
  const weeksOf = async () => Object.keys((await planNow()).assignments.find((x) => x.id === roleId).weekly).length;
  const before2 = await weeksOf();
  const handle = cellAt(tc).locator('.bar-handle.end');
  await cellAt(tc).hover();
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  const tb = await cellAt(tc + 2).boundingBox();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 5 });
  assert(await page.locator('td.drag-add').count() === 2, 'drag previews the two added weeks');
  await page.mouse.up();
  assert((await weeksOf()) === before2 + 2 && (await val(cellAt(tc + 2))) === target.value, 'dragging the end handle extends the bar with its %');
  await page.locator('.grid-scroll').focus();
  await page.keyboard.press('Control+z');
  assert((await weeksOf()) === before2, 'one undo reverts the drag');
  // Alt+drag moves the whole bar one week later.
  const ab = await cellAt(tc).boundingBox();
  await page.keyboard.down('Alt');
  await page.mouse.move(ab.x + ab.width / 2, ab.y + ab.height / 2);
  await page.mouse.down();
  const nb = await cellAt(tc + 1).boundingBox();
  await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  assert((await val(cellAt(tc + 1))) === target.value && (await weeksOf()) === before2, 'Alt+drag moves the bar, keeping its length');
  await page.locator('.grid-scroll').focus();
  await page.keyboard.press('Control+z');
  assert((await val(cellAt(tc + 1))) === 0, 'undo moves it back');
  await shot(page, '35-drag');

  // Inspector: I opens details for the focused week.
  await cellAt(tc).click();
  await page.keyboard.press('i');
  const insp = page.locator('aside[aria-label=Details]');
  assert(await insp.count() === 1 && (await insp.locator('.inspector-facts').innerText()).includes('This bar'), 'I opens the inspector on the focused bar');
  assert(await page.locator('.conflicts').count() === 0, 'inspector replaces the issues panel');
  await shot(page, '36-inspector');
  await page.keyboard.press('i');
  assert(await insp.count() === 0, 'I closes it again');

  // Month rollups: Avg / Peak, and a month header drills down to weeks.
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  const peakBtn = page.getByLabel('Rollup').getByRole('button', { name: 'Peak' });
  assert(await peakBtn.count() === 1, 'Avg / Peak shown at Month zoom');
  const monthVals = () => page.locator('tr[id^="row-a:"] td.cell.filled').evaluateAll((tds) => tds.map((td) => Number(td.dataset.value)));
  const avgVals = await monthVals();
  await peakBtn.click();
  const peakVals = await monthVals();
  assert(peakVals.every((v, i) => v >= avgVals[i]) && peakVals.some((v, i) => v > avgVals[i]), 'Peak shows each month\'s busiest week');
  await page.getByLabel('Rollup').getByRole('button', { name: 'Avg' }).click();
  await page.locator('.col-drill').nth(2).click();
  assert(await page.locator('nav[aria-label=Zoom] button[aria-pressed=true]', { hasText: 'Week' }).count() === 1, 'clicking a month header drills down to its weeks');

  // Compact density.
  const rowH = () => page.locator('tr.role-row').first().evaluate((el) => el.getBoundingClientRect().height);
  const comfy = await rowH();
  await page.getByRole('button', { name: 'Manage', exact: true }).click();
  await page.getByRole('button', { name: 'Settings & data' }).click();
  await page.getByRole('navigation', { name: 'Density' }).getByRole('button', { name: 'Compact' }).click();
  await page.getByRole('button', { name: 'Workstreams', exact: true }).first().click();
  const compact = await rowH();
  assert(compact < comfy, `compact rows are shorter (${comfy} → ${compact})`);
  await shot(page, '37-compact');
  await page.getByRole('button', { name: 'Manage', exact: true }).click();
  await page.getByRole('navigation', { name: 'Density' }).getByRole('button', { name: 'Comfortable' }).click();

  // ---- Kanban: columns by stage and win %, lanes by seller; drag to change, click for details
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();
  await page.getByLabel('Search', { exact: true }).fill('');
  const board = page.getByRole('region', { name: 'Kanban board' });
  const card = board.getByRole('article', { name: 'Agentforce Service Pilot' });
  const cellOf = (c) => c.evaluate((el) => el.closest('.kanban-cell').getAttribute('aria-label'));
  const contosoNow = async () => (await plan()).projects.find((p) => p.id === 'proj-contoso');
  assert((await contosoNow()).status === 'pipeline' && !(await contosoNow()).winProbability, 'Kanban: Contoso starts in the pipeline with no win %');
  const startCell = await cellOf(card);
  assert(startCell.endsWith(' Unknown'), `Kanban: a pipeline workstream without a win % sits in Unknown (${startCell})`);
  const lane = startCell.slice(0, -' Unknown'.length);
  assert(await board.locator('.kanban-col-head').count() === 6 && !(await board.locator('.col-lost').count()), 'Kanban: six columns, Lost hidden by default');
  await card.dragTo(board.getByLabel(`${lane} 50%`, { exact: true }));
  assert((await contosoNow()).winProbability === 50 && (await contosoNow()).status === 'pipeline', 'Kanban: dragging to 50% sets the win %');
  assert((await cellOf(card)) === `${lane} 50%`, 'Kanban: the card moved to the 50% column');
  await card.dragTo(board.getByLabel(`${lane} Sold`, { exact: true }));
  assert((await contosoNow()).status === 'won', 'Kanban: dragging to Sold marks it won');
  assert(await card.locator('.kcard-staffing').count() === 1 && await card.locator('.kcard-presales').count() === 0, 'Kanban: a sold card shows staffing instead of presales');
  await page.keyboard.press('Control+z');
  assert((await contosoNow()).status === 'pipeline' && (await contosoNow()).winProbability === 50, 'Kanban: undo reverts one drag');
  await page.keyboard.press('Control+z');
  assert(!(await contosoNow()).winProbability, 'Kanban: undo again clears the win %');
  // Details panel
  await card.getByRole('button', { name: 'Agentforce Service Pilot', exact: true }).click();
  const kp = page.getByRole('complementary', { name: 'Agentforce Service Pilot details' });
  assert(await kp.count() === 1 && (await card.getAttribute('aria-current')) === 'true', 'Kanban: clicking a card opens its details and marks it selected');
  const contosoRoles = (await plan()).assignments.filter((a) => a.projectId === 'proj-contoso').length;
  assert(await kp.locator('.kp-team tbody tr').count() === contosoRoles, `Kanban: the team table lists every role (${contosoRoles})`);
  assert(await kp.getByRole('img', { name: /Average load of the \d+ people/ }).count() === 1, 'Kanban: utilization chart for the team');
  await kp.getByLabel('Win probability for Agentforce Service Pilot').selectOption('75');
  assert((await cellOf(card)) === `${lane} 75%` && await card.locator('.kcard-staffing').count() === 1, 'Kanban: setting 75% in the panel moves the card and shows staffing');
  await page.keyboard.press('Control+z');
  await kp.getByRole('tab', { name: 'Resourcing' }).click();
  assert(await kp.locator('.kp-roles li').count() === contosoRoles, 'Kanban: Resourcing tab lists the roles');
  await shot(page, '45-kanban');
  await page.keyboard.press('Escape');
  assert(await kp.count() === 0, 'Kanban: Escape closes the details');
  await page.getByRole('navigation', { name: 'Swimlanes' }).getByRole('button', { name: 'By client' }).click();
  assert((await cellOf(card)).startsWith('Contoso '), 'Kanban: lanes by client');
  await page.getByRole('switch', { name: 'Show lost' }).click();
  assert(await board.locator('.col-lost').count() === 1, 'Kanban: Show lost adds the Lost column');
  await page.getByRole('switch', { name: 'Show lost' }).click();
  await page.getByRole('navigation', { name: 'Swimlanes' }).getByRole('button', { name: 'By seller' }).click();

  // ---- Theme: Auto follows the system; Light / Dark override it and survive a reload
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const isDark = async () => {
    const [r, g, b] = (await bg()).match(/\d+/g).map(Number);
    return r + g + b < 3 * 128;
  };
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByRole('button', { name: 'Manage', exact: true }).click();
  await page.getByRole('button', { name: 'Settings & data' }).click();
  const themeBtn = (name) => page.getByRole('navigation', { name: 'Theme' }).getByRole('button', { name, exact: true });
  assert((await themeBtn('Auto').getAttribute('aria-pressed')) === 'true', 'theme: Auto by default');
  assert(await isDark(), 'theme: Auto follows a dark system');
  await themeBtn('Light').click();
  assert(!(await isDark()), 'theme: Light overrides a dark system');
  await shot(page, '43-theme-light');
  await page.reload();
  assert(!(await isDark()), 'theme: Light survives a reload');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByRole('button', { name: 'Manage', exact: true }).click();
  await page.getByRole('button', { name: 'Settings & data' }).click();
  await themeBtn('Dark').click();
  assert(await isDark(), 'theme: Dark overrides a light system');
  await page.getByRole('button', { name: 'Workstreams', exact: true }).first().click();
  await shot(page, '44-theme-dark');
  await page.getByRole('button', { name: 'Manage', exact: true }).click();
  await page.getByRole('button', { name: 'Settings & data' }).click();
  await themeBtn('Auto').click();
  assert(!(await isDark()), 'theme: back on Auto, it follows the (light) system again');

  console.log('console errors/warnings:', errors.length ? errors : 'none');
  await browser.close();
  assert(errors.length === 0, 'no unexpected browser errors: ' + errors.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
