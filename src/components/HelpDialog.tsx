import type { ReactNode } from 'react';
import { Modal } from './Modal';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="keys">
      {keys.map((k, i) => (
        <span key={i}>
          {i > 0 && <span className="keys-plus">+</span>}
          <kbd>{k}</kbd>
        </span>
      ))}
    </span>
  );
}

interface Row {
  what: ReactNode;
  how: ReactNode;
}

function Section({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <section className="help-section">
      <h3>{title}</h3>
      <dl>
        {rows.map(({ what, how }, i) => (
          <div key={i} className="help-row">
            <dt>{how}</dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Reference for every interaction and keyboard shortcut. Opened with the Help button or "?". */
export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Help: interactions & shortcuts" onClose={onClose} wide>
      <div className="help">
        <Section
          title="Allocation cells"
          rows={[
            { what: 'Cycle a week 0 → 25 → 50 → 100 → 0', how: 'Double-click a cell' },
            { what: 'Select a cell (doesn’t change it)', how: 'Click' },
            { what: 'Select a range', how: <>Drag, or click then <Keys keys={['Shift']} /> + click</> },
            { what: 'Cycle the whole selection', how: <Keys keys={['Space']} /> },
            { what: 'Set the selection to a value', how: <>Type <kbd>25</kbd>, <kbd>50</kbd> or <kbd>100</kbd>, then <Keys keys={['Enter']} /></> },
            { what: 'Edit the focused cell', how: <><Keys keys={['Enter']} /> or <Keys keys={['F2']} /></> },
            { what: 'Clear the selection', how: <><Keys keys={['Delete']} /> or <Keys keys={['Backspace']} /></> },
            { what: 'Move', how: <>Arrow keys · <Keys keys={['Tab']} /> / <Keys keys={['Shift', 'Tab']} /></> },
            { what: 'Extend the selection', how: <Keys keys={['Shift', 'Arrow']} /> },
            { what: 'Cancel an edit / clear the selection', how: <Keys keys={['Esc']} /> },
          ]}
        />
        <p className="muted small">
          Each week is 0, 25, 50 or 100%; other typed values round to the nearest step. In Month and Quarter view a
          cell shows the average for the period, and changing it sets every week in that period.
        </p>
        <Section
          title="Everywhere"
          rows={[
            { what: 'Undo', how: <Keys keys={[MOD, 'Z']} /> },
            { what: 'Redo', how: <><Keys keys={[MOD, 'Shift', 'Z']} /> or <Keys keys={[MOD, 'Y']} /></> },
            { what: 'Open this help', how: <Keys keys={['?']} /> },
            { what: 'Close a dialog', how: <Keys keys={['Esc']} /> },
          ]}
        />
        <Section
          title="Workstreams and people"
          rows={[
            { what: 'Add people to a workstream', how: <><b>•••</b> on the workstream row → <b>Add a person…</b> (tick several)</> },
            { what: 'Add a person to workstreams', how: <><b>•••</b> on the person’s row → <b>Add to a workstream…</b> (tick several)</> },
            { what: 'Edit a workstream (dates, seller, capabilities)', how: <>Click its name, then <b>Edit workstream</b></> },
            { what: 'Change a workstream’s stage', how: 'Pipeline / Won / Lost pill on its row' },
            { what: 'Summary of a workstream or person: checks, warnings, filled and open roles', how: 'Click its name' },
            { what: 'What’s in the pipeline vs won, who’s supporting, who’s staffed, open roles', how: <><b>Demand</b> tab</> },
            { what: 'Add a role, open or with someone in it', how: <><b>•••</b> on the workstream row → <b>Add an open role…</b></> },
            { what: 'Pick the person for an open role', how: <><b>Fill…</b> on the role (ranked by skills, level, free capacity)</> },
            { what: 'Swap who’s in a role, or leave it open', how: 'Click the person’s name on the row' },
            { what: 'Rename a role or set what it needs', how: 'Click the role name' },
            { what: 'A deal slipped', how: 'Click the workstream name → Edit, move its start date; keep “Move the delivery staffing too” ticked' },
            { what: 'Remove a role (and whoever’s in it)', how: <><b>•••</b> on the row → <b>Remove role</b></> },
            { what: 'Expand or collapse a row', how: <><b>▸</b> / <b>▾</b>, or Expand all / Collapse all in the corner</> },
            { what: 'Jump to an issue', how: 'Click the issue counts in the toolbar, then the issue' },
            { what: 'Show only people (Resources tab) or workstreams (Workstreams tab) with an issue', how: <><b>Issues only</b> switch in the toolbar</> },
            { what: 'Group workstreams by client', how: <><b>By client</b> switch in the Workstreams corner; <b>Clients only</b> collapses to one row per client</> },
            { what: 'Team capacity in FTE-weeks: won delivery, pipeline and headroom', how: <><b>Capacity</b> in the toolbar (Workstreams view)</> },
            { what: 'Trace one person across workstreams', how: <>Click them in the <b>Capacity</b> panel</> },
            { what: 'People under their level’s utilization target over the next 10 weeks', how: <><b>Underutilized</b> switch in the toolbar (Resources view)</> },
            { what: 'Set utilization targets per level', how: <><b>Manage</b> → Settings &amp; data</> },
            { what: 'Open-role demand vs free capacity by capability', how: <><b>Capacity</b> panel → Capabilities</> },
            { what: 'See capacity by career level (D, SM, M, SA, A)', how: <>Resources view, <b>Levels only</b>: each level shows its people’s average %</> },
            { what: 'Set someone’s career level', how: <><b>Manage</b> → Resources → Level</> },
            { what: 'Add people, workstreams, capabilities, sellers', how: <><b>Manage</b> tab, or type a new capability name in any picker</> },
          ]}
        />
        <Section
          title="Bookings and issues"
          rows={[
            { what: 'Confirmed: counts toward load (presales, or delivery on a Won workstream)', how: 'Solid blue bar' },
            { what: 'Tentative: delivery on a Pipeline workstream, counts only if won', how: 'Hatched purple bar' },
            { what: 'Open role: demand nobody covers yet', how: 'Dashed outline bar' },
            { what: 'Delivery on a Lost workstream: not counted', how: 'Grey, struck through' },
            { what: 'How much', how: 'FTE label where a bar starts or changes (0.5 FTE = 50%)' },
            { what: 'Conflict: committed work over capacity in those weeks', how: 'Red outline over the weeks (stronger fill past the red threshold)' },
            { what: 'At risk: over capacity only if pipeline work is won', how: 'Dashed red outline' },
            { what: 'Workstream start and end', how: 'Teal line, labelled START / END on the workstream row' },
            { what: 'Weeks before the start date (presales) always count; delivery counts once Won', how: 'Hover a week for its details' },
            { what: 'Outside the workstream’s dates', how: 'Hatched' },
          ]}
        />
        <Section
          title="View and data"
          rows={[
            { what: 'Change the time scale', how: 'Week / Month / Quarter' },
            { what: 'Show bars or every week’s %', how: 'Bars / % toggle' },
            { what: 'Move through time', how: <><b>‹</b> <b>Today</b> <b>›</b></> },
            { what: 'Switch plans, or start a new one', how: 'Plan dropdown next to the title' },
            { what: 'Rename or delete plans', how: <><b>Manage</b> → Plans</> },
            { what: 'Back up or move a plan (export bumps its version; import overwrites the plan with the same name, else adds one)', how: <><b>⋯</b> in the header → Export / Import</> },
            { what: 'One workstream’s staffing plan as a spreadsheet', how: <><b>•••</b> on the workstream row → <b>Download CSV</b></> },
            { what: 'Light or dark theme (or follow the system)', how: <><b>Manage</b> → Settings &amp; data → <b>Appearance</b></> },
            { what: 'All staffing in one CSV (one line per person per week)', how: <><b>⋯</b> in the header → Export staffing (CSV)</> },
          ]}
        />
        <Section
          title="Shared workspace (opt-in)"
          rows={[
            { what: 'Share plans with your team, edited live', how: <><b>Manage</b> → Settings &amp; data → <b>Use the shared workspace</b> (per browser)</> },
            { what: 'Who else has the plan open, and what they’ve selected', how: 'Avatars in the toolbar; coloured outlines on cells' },
            { what: 'Recently changed by someone else', how: 'Coloured corner on the cell (hover for who and when)' },
            { what: 'History of a cell: who changed it, when, from what', how: <>Right-click → <b>History</b>, or select and press <b>H</b></> },
            { what: 'History of a workstream or person', how: 'Click its name → History' },
            { what: 'Comment on cells (threaded; @ to mention someone)', how: <>Right-click → <b>Comment…</b>, or select and press <b>M</b></> },
            { what: 'Comment on a role, workstream or person', how: <>The row’s <b>💬</b> button</> },
            { what: 'Every thread in the plan; resolve or reopen', how: <><b>Comments</b> in the toolbar</> },
            { what: 'Threads that mention you, across plans', how: <><b>Mentions</b> tab (badge: unread and unresolved)</> },
            { what: 'Freeze cells, a role or a workstream', how: <>Right-click a cell → <b>Lock…</b>; or the workstream’s details → <b>Lock staffing</b></> },
            { what: 'Undo your own last change (others’ later changes are kept)', how: <><b>Ctrl+Z</b></> },
            { what: 'Every change in every plan; undo any of them', how: <><b>Activity</b> tab</> },
            { what: 'Roles and access (admins)', how: <><b>Manage</b> → People &amp; access</> },
          ]}
        />
      </div>
    </Modal>
  );
}
