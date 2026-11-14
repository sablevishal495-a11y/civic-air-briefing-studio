/**
 * Findings, data gaps and prioritised actions.
 */

import { h, replace } from './dom.js';
import { evidence } from './evidence.js';
import { REGENERATE_EVENT, state, $ } from './state.js';

export function findingList(items, kind) {
  return h('ul', { class: 'plain' }, items.map((item) => {
    return h('li', { class: `finding${  kind === 'quality' ? ' quality' : ''}` },
      item.location ? h('strong', { text: item.location }) : null,
      h('span', { text: `${item.text  } ` }),
      item.confidence ? h('span', { class: `badge ${  item.confidence}`, text: `${item.confidence  } confidence` }) : null,
      item.impact ? h('div', { class: 'impact', text: item.impact }) : null,
      kind === 'quality' && !item.evidence.length ? null : evidence(item.evidence, item.unverified)
    );
  }));
}

export function renderFindings() {
  const b = state.result.brief;
  replace($('findings-body'),
    h('h3', { text: 'Likely hotspots' }), findingList(b.hotspots),
    h('h3', { text: 'Trends' }), findingList(b.trends),
    h('h3', { text: 'Data gaps and unreliable readings' }), findingList(b.dataQuality, 'quality')
  );
}

export function renderActions() {
  const r = state.result;
  const others = [['ward', 'Ward officer'], ['society', 'Housing society'], ['school', 'School']].filter((a) => { return a[0] !== r.audience; });
  replace($('actions-body'),
    h('p', { class: 'hint', text: `For: ${  r.audienceLabel  }. Ordered by urgency, and limited to what this audience has the power to do.` }),
    h('ol', { class: 'plain' }, r.brief.actions.map((a, i) => {
      return h('li', { class: 'action' },
        h('div', { class: 'action-num', 'aria-hidden': 'true', text: String(i + 1) }),
        h('div', null, h('span', { class: 'badge time', text: a.timeframe }), ' ', h('span', { class: 'action-title', text: a.title })),
        h('div', null, a.detail ? h('div', { text: a.detail }) : null, a.why ? h('div', { class: 'action-why', text: `Why: ${  a.why}` }) : null, evidence(a.evidence, a.unverified))
      );
    })),
    h('div', { class: 'audience-switch' }, 'See actions for another audience:', others.map((a) => {
      return h('button', { type: 'button', class: 'btn small', onclick () {
        document.querySelector(`input[name="audience"][value="${  a[0]  }"]`).checked = true;
        document.dispatchEvent(new CustomEvent(REGENERATE_EVENT));
      } }, a[1]);
    }))
  );
}
