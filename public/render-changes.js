/**
 * Comparison with the previous brief.
 */

import { h, replace } from './dom.js';
import { state, $ } from './state.js';

export const DIRECTION = { worse: '▲ Worse', better: '▼ Better', same: '● Same', new: '◆ New' };

export function renderChanges() {
  const r = state.result;
  const c = r.comparison;
  if (!c.available) {
    replace($('changes-body'),
      c.warning ? h('p', { class: 'notice', text: c.warning }) : null,
      h('p', { text: 'There is no earlier brief to compare with yet. This brief has been saved in this browser as the baseline, so the next one you generate will show what changed.' }),
      h('p', { class: 'hint', text: 'To see a comparison now, open "Compare with an earlier period" in step 1 and paste the earlier readings, or load the "Week 2, compared with Week 1" sample.' }));
    return;
  }
  const prev = c.previous;
  const when = prev.createdAt ? new Date(prev.createdAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const s = r.stats;
  const table = c.comparable && c.locations.length ? h('div', { class: 'table-scroll' }, h('table', null,
    h('caption', { text: `Average ${  s.primaryLabel  } by location, previous and now` }),
    h('thead', null, h('tr', null,
      h('th', { scope: 'col', text: 'Location' }), h('th', { scope: 'col', class: 'num', text: 'Previous' }), h('th', { scope: 'col', class: 'num', text: 'Now' }),
      h('th', { scope: 'col', class: 'num', text: 'Change' }), h('th', { scope: 'col', text: 'Direction' }), h('th', { scope: 'col', text: 'Band' }))),
    h('tbody', null, [{ name: 'All locations', prev: c.overall.prev, curr: c.overall.curr, delta: c.overall.delta, deltaPct: c.overall.deltaPct, direction: c.overall.direction, prevCategory: c.overall.prevCategory, currCategory: c.overall.currCategory }]
      .concat(c.locations).map((l) => {
        return h('tr', null,
          h('th', { scope: 'row' }, l.name, l.lowConfidence ? h('span', { class: 'flag', text: 'low confidence' }) : null),
          h('td', { class: 'num', text: String(l.prev) }), h('td', { class: 'num', text: String(l.curr) }),
          h('td', { class: 'num', text: `${(l.delta > 0 ? '+' : '') + l.delta  } (${  l.deltaPct > 0 ? '+' : ''  }${l.deltaPct  }%)` }),
          h('td', null, h('span', { class: `dir ${  l.direction}`, text: DIRECTION[l.direction] })),
          h('td', { text: l.prevCategory === l.currCategory ? l.currCategory : `${l.prevCategory  } → ${  l.currCategory}` }));
      }))
  )) : null;

  replace($('changes-body'),
    h('p', { class: 'meta-line', text: `Compared with ${  c.source === 'data' ? 'the earlier readings you pasted' : `the brief saved ${  when}`  } (data period: ${  prev.period  }).` }),
    h('ul', { class: 'plain' }, r.brief.changes.map((ch) => {
      return h('li', { class: 'finding' }, h('span', { class: `dir ${  ch.direction}`, text: DIRECTION[ch.direction] }), ' ', ch.text);
    })),
    table,
    h('p', { class: 'hint small', text: 'A change of less than 10% is treated as "same". The table is calculated directly from the two sets of readings.' })
  );
}
