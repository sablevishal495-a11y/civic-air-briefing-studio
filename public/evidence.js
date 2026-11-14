/**
 * Evidence chips: the link from every finding back to its source rows.
 */

import { h } from './dom.js';
import { state, $ } from './state.js';

export function rowSummary(id) {
  const row = state.rows[id];
  if (!row) return id;
  const cells = Object.keys(row.cells).map((p) => {
    const c = row.cells[p];
    const label = (state.config.pollutants[p] || {}).label || p;
    return `${label  } ${  c.value != null ? c.value : `"${  c.raw  }"`}`;
  });
  return `Row ${  id.slice(1)  }: ${  row.location  }${row.time ? `, ${  row.time}` : ''  }, ${  cells.join(', ')}`;
}

export function evidence(ids, unverified) {
  if (unverified || !ids || !ids.length) {
    return h('div', { class: 'evidence' }, h('span', { class: 'badge unverified', text: 'No row reference' }), 'Treat this point with caution.');
  }
  return h('div', { class: 'evidence' }, 'Evidence:', ids.map((id) => {
    return h('button', { type: 'button', class: 'row-chip', title: rowSummary(id), 'aria-label': `Show ${  rowSummary(id)}`, onclick (e) { showRow(id, e.currentTarget); } }, id);
  }));
}

export function showRow(id, chip) {
  const tr = document.getElementById(`row-${  id}`);
  if (!tr) return;
  Array.prototype.forEach.call(document.querySelectorAll('tr.hit'), (el) => { el.classList.remove('hit'); });
  tr.classList.add('hit');
  state.lastChip = chip;
  $('back-to-finding').hidden = false;
  tr.scrollIntoView({ block: 'center' });
  tr.focus({ preventScroll: true });
}
