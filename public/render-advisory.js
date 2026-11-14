/**
 * Citizen advisory: language tabs, reading levels and group tips.
 */

import { h, replace, copyText } from './dom.js';
import { state, $ } from './state.js';

export function advisoryText(a, level) {
  if (level === 'sms') return a.sms;
  const groups = ['Children', 'Older adults', 'People sensitive to poor air'];
  const lists = [a.groups.children, a.groups.olderAdults, a.groups.sensitive];
  const body = level === 'easy' ? [a.easy.title, ''].concat(a.easy.lines) : [a.standard.title, ''].concat(a.standard.paragraphs);
  lists.forEach((list, i) => {
    body.push('', `${groups[i]  }:`);
    list.forEach((tip) => { body.push(`- ${  tip}`); });
  });
  return body.join('\n');
}

export function renderAdvisory() {
  const adv = state.advisory;
  if (!adv) return;
  const langs = state.config.languages;
  const meta = function (code) { return langs.filter((l) => { return l.code === code; })[0] || { code, name: code, native: code, dir: 'ltr' }; };
  const item = adv.items[adv.active];
  const levels = [['easy', 'Easy read'], ['standard', 'Standard'], ['sms', 'SMS']];

  let panel;
  if (item.status === 'loading') {
    panel = h('p', { class: 'status busy', text: `Writing the ${  meta(adv.active).name  } advisory…` });
  } else if (item.status === 'error') {
    panel = h('p', { class: 'notice', text: `The ${  meta(adv.active).name  } advisory could not be written: ${  item.message}` });
  } else {
    const d = item.data;
    const a = d.advisory;
    const shown = d.shownIn;
    let content;
    if (adv.level === 'easy') {
      content = [h('h3', { class: 'adv-title', text: a.easy.title }), h('ul', { class: 'adv-easy' }, a.easy.lines.map((line) => { return h('li', { text: line }); }))];
    } else if (adv.level === 'standard') {
      content = [h('h3', { class: 'adv-title', text: a.standard.title }), a.standard.paragraphs.map((p) => { return h('p', { text: p }); })];
    } else {
      content = [h('p', { class: 'adv-sms', text: a.sms }), h('p', { class: 'hint small', text: `${a.sms.length  } characters` })];
    }
    const group = function (title, tips) {
      return h('div', { class: 'group' }, h('h4', { lang: 'en', dir: 'ltr', text: title }), h('ul', null, tips.map((t) => { return h('li', { text: t }); })));
    };
    panel = h('div', null,
      d.notice ? h('p', { class: 'notice', text: d.notice }) : null,
      h('div', { class: 'toolbar', role: 'group', 'aria-label': 'Reading level' }, levels.map((l) => {
        return h('button', { type: 'button', class: 'btn small', 'aria-pressed': String(adv.level === l[0]), onclick () { adv.level = l[0]; renderAdvisory(); } }, l[1]);
      }), h('button', { type: 'button', class: 'btn small quiet', onclick (e) { copyText(advisoryText(a, adv.level), e.currentTarget); } }, 'Copy this version')),
      h('div', { class: 'adv-panel', lang: shown.code, dir: shown.dir }, content,
        adv.level === 'sms' ? null : h('div', { class: 'groups' },
          group('Children', a.groups.children), group('Older adults', a.groups.olderAdults), group('People sensitive to poor air', a.groups.sensitive))),
      h('p', { class: 'hint small', text: d.mode === 'ai' ? 'Written by Gemini from the facts in this brief. Have a fluent speaker check it before wide circulation.' : 'Written from built-in templates.' })
    );
  }

  replace($('advisory-body'),
    h('p', { class: 'hint', text: 'Ready to share with residents. Easy read is written for a 9-year-old reading level; Standard is for general readers.' }),
    h('div', { class: 'toolbar', role: 'group', 'aria-label': 'Advisory language' }, adv.order.map((code) => {
      const m = meta(code);
      const st = adv.items[code].status;
      return h('button', { type: 'button', class: 'btn small', 'aria-pressed': String(adv.active === code), onclick () { adv.active = code; renderAdvisory(); } },
        m.name, m.native !== m.name ? h('span', { lang: m.code, text: ` ${  m.native}` }) : null, st === 'loading' ? ' …' : st === 'error' ? ' (failed)' : null);
    })),
    panel
  );
}
