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
            { what: 'Add people to a workstream', how: <><b>+ Person</b> on the workstream row (tick several)</> },
            { what: 'Add a person to workstreams', how: <><b>+ Workstream</b> on the person’s row (tick several)</> },
            { what: 'Edit a workstream (dates, seller, capabilities)', how: 'Click its name' },
            { what: 'Change a workstream’s status', how: 'Pipeline / Won / Lost dropdown on its row' },
            { what: 'Add a role, open or with someone in it', how: <><b>+ Role</b> on the workstream row</> },
            { what: 'Pick the person for an open role', how: <><b>Fill…</b> on the role (ranked by skills, level, free capacity)</> },
            { what: 'Swap who’s in a role, or leave it open', how: 'Click the person’s name on the role row' },
            { what: 'Rename a role or set what it needs', how: 'Click the role name' },
            { what: 'A deal slipped', how: 'Click the workstream name and move its start date; tick “Move the delivery staffing too”' },
            { what: 'Remove a role (and whoever’s in it)', how: <><b>×</b> on the role row</> },
            { what: 'Expand or collapse a row', how: <><b>▸</b> / <b>▾</b>, or Expand / Collapse in the corner</> },
            { what: 'Jump to a conflict', how: 'Click it in the Conflicts panel' },
            { what: 'Show only people (Resources tab) or workstreams (Workstreams tab) with a conflict', how: <><b>⚠ Conflicts only</b> in the toolbar</> },
            { what: 'Group workstreams by client', how: <><b>By client</b> in the Workstreams corner; <b>Clients only</b> collapses to one row per client</> },
            { what: 'Everyone’s delivery vs pipeline utilization, next 10 weeks', how: <><b>Utilization</b> in the toolbar (Workstreams view)</> },
            { what: 'People under their level’s utilization target over the next 10 weeks', how: <><b>Underutilized</b> in the toolbar (Resources view)</> },
            { what: 'Set utilization targets per level', how: <><b>Manage</b> → Settings &amp; data</> },
            { what: 'Open-role demand vs free capacity by capability', how: <><b>Utilization</b> sidebar → Open demand vs bench</> },
            { what: 'See capacity by career level (D, SM, M, SA, A)', how: <>Resources view, <b>Levels only</b>: each level shows its people’s average %</> },
            { what: 'Set someone’s career level', how: <><b>Manage</b> → Resources → Level</> },
            { what: 'Add people, workstreams, capabilities, sellers', how: <><b>Manage</b> tab, or type a new capability name in any picker</> },
          ]}
        />
        <Section
          title="Presales, delivery and flags"
          rows={[
            { what: 'Presales: always counts toward load', how: 'Violet weeks, before the start date' },
            { what: 'Delivery: counts once Won, tentative while Pipeline, ignored if Lost', how: 'Blue weeks, from the start date' },
            { what: 'Tentative pipeline delivery', how: 'Dashed circle' },
            { what: 'Overallocated: 150% or more, committed work alone or once pipeline work is counted', how: 'Red' },
            { what: 'Stretched: 101–149% of committed work, or over 100% once pipeline work is counted (shown as +N / dashed)', how: 'Orange text' },
            { what: 'At risk: over 100% only if pipeline work is won (listed separately in Conflicts)', how: 'Orange text + yellow “At risk” badge' },
            { what: 'Workstream start and end', how: 'Vertical line, labelled on the workstream row' },
            { what: 'Outside the workstream’s dates', how: 'Hatched' },
          ]}
        />
        <Section
          title="View and data"
          rows={[
            { what: 'Change the time scale', how: 'Week / Month / Quarter' },
            { what: 'Show circles or numbers', how: '◑ / % toggle' },
            { what: 'Move through time', how: <><b>◀</b> <b>Today</b> <b>▶</b></> },
            { what: 'Switch plans, or start a new one', how: 'Plan dropdown next to the title' },
            { what: 'Rename or delete plans', how: <><b>Manage</b> → Plans</> },
            { what: 'Back up or move a plan (export bumps its version; import overwrites the plan with the same name, else adds one)', how: <><b>Export</b> / <b>Import</b></> },
            { what: 'One workstream’s staffing plan as a spreadsheet', how: <><b>⤓ CSV</b> on the workstream row</> },
            { what: 'All staffing in one CSV (one line per person per week)', how: <><b>CSV</b> in the toolbar</> },
          ]}
        />
      </div>
    </Modal>
  );
}
