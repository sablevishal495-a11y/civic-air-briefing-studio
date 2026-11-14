/**
 * The data table as interpreted, with row IDs and flags.
 */

import { h, replace } from './dom.js';
import { state, $ } from './state.js';

export function renderData() {
  const p = state.result.parsed;
  const flags = state.config.flags;
  const pollutants = p.pollutants;
  const label = function (key) { return (state.config.pollutants[key] || {}).label || key; };
  const unit = function (key) { return (state.config.pollutants[key] || {}).unit || ''; };
  const hasRemark = p.rows.some((r) => { return r.remark; });

  const body = p.rows.map((r) => {
    return h('tr', { id: `row-${  r.id}`, tabindex: '-1' },
      h('th', { scope: 'row' }, h('span', { class: 'chip-example', text: r.id })),
      h('td', null, r.location, r.flags.indexOf('location_filled') >= 0 ? h('span', { class: 'flag', text: 'filled from row above' }) : null),
      h('td', { text: r.time || '' }),
      pollutants.map((key) => {
        const c = r.cells[key];
        if (!c) return h('td', { class: 'num', text: '' });
        const cls = `num${  !c.ok ? ' bad' : c.flags.length ? ' soft' : ''}`;
        const names = c.flags.map((f) => { return (flags[f] || {}).label || f; });
        const title = c.flags.map((f) => { return (flags[f] || {}).text || f; }).join('. ');
        return h('td', { class: cls, title: title || null },
          c.value != null && c.ok ? String(c.value) : h('span', { class: c.ok ? '' : 'rawval', text: c.value != null ? String(c.value) : (c.raw || 'blank') }),
          names.length ? h('span', { class: 'flag', text: names.join(', ') + (c.note ? ` (${  c.note  })` : '') }) : null);
      }),
      hasRemark ? h('td', { text: r.remark || '' }) : null
    );
  });

  replace($('data-body'),
    h('p', { class: 'hint', text: 'This is how your data was read. Row IDs match the line numbers of what you pasted (R7 is line 7). Red cells were excluded from every average; amber cells were kept but should be verified.' }),
    h('div', { class: 'toolbar' },
      h('button', { type: 'button', class: 'btn small', id: 'back-to-finding', hidden: true, onclick () {
        if (state.lastChip && document.contains(state.lastChip)) { state.lastChip.scrollIntoView({ block: 'center' }); state.lastChip.focus({ preventScroll: true }); }
      } }, '↩ Back to the finding')),
    h('div', { class: 'table-scroll', tabindex: '0', role: 'region', 'aria-label': 'Readings table' }, h('table', null,
      h('caption', { class: 'visually-hidden', text: 'Readings as interpreted, with row IDs and flags' }),
      h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Row' }), h('th', { scope: 'col', text: 'Location' }), h('th', { scope: 'col', text: 'Time' }),
        pollutants.map((key) => { return h('th', { scope: 'col', class: 'num', text: label(key) + (unit(key) ? ` (${  unit(key)  })` : '') }); }),
        hasRemark ? h('th', { scope: 'col', text: 'Remarks' }) : null)),
      h('tbody', null, body))),
    h('details', { class: 'more', open: true },
      h('summary', { text: 'How the table was interpreted' }),
      h('dl', { class: 'kv' },
        h('dt', { text: 'Layout' }), h('dd', { text: `${p.format === 'long' ? 'One reading per row' : 'One column per pollutant'  }, separated by ${  p.delimiter}` }),
        p.columns.map((c) => { return [h('dt', { text: `"${  c.header  }"` }), h('dd', { text: c.meaning })]; })),
      p.notes.length ? h('ul', null, p.notes.map((n) => { return h('li', { text: n }); })) : null,
      state.result.mode === 'ai' ? [h('p', { class: 'hint small', text: 'Gemini\'s reading of the data:' }), h('ul', null, state.result.brief.dataInterpretation.map((n) => { return h('li', { text: n }); }))] : null,
      p.ignored.length ? h('p', { class: 'hint small', text: `Lines not treated as readings: ${  p.ignored.map((i) => { return `line ${  i.line  } (${  i.reason.toLowerCase()  })`; }).join('; ')  }.` }) : null)
  );
}
