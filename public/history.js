/**
 * Saved briefs in localStorage, used to show what changed since the last brief.
 */

import { h, replace } from './dom.js';
import { HISTORY_KEY, $ } from './state.js';

export function loadHistory() {
  try {
    const list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

export function saveHistory(list) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 12))); } catch (e) { /* storage unavailable */ }
}

export function rememberBrief(result) {
  const snap = result.snapshot;
  const list = loadHistory().filter((b) => {
    // Re-running the same data (for another audience, say) replaces the entry.
    return !(b.snapshot && b.snapshot.period === snap.period && b.snapshot.overallMean === snap.overallMean && b.snapshot.place === snap.place);
  });
  list.unshift({ id: String(Date.now()), at: snap.createdAt, place: result.place, status: snap.overallCategory, snapshot: snap });
  saveHistory(list);
  renderBaselineOptions();
}

export function renderBaselineOptions() {
  const select = $('baseline');
  const list = loadHistory();
  const current = select.value || 'auto';
  replace(select,
    h('option', { value: 'auto', text: list.length ? 'Most recent saved brief (automatic)' : 'No saved briefs yet' }),
    list.map((b) => {
      const when = new Date(b.at);
      const label = `${(isNaN(when) ? '' : `${when.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })  } · `)
        + (b.place || 'Unnamed area')  } · ${  b.snapshot.period  } · ${  b.status}`;
      return h('option', { value: b.id, text: label });
    }),
    h('option', { value: 'none', text: 'Do not compare' })
  );
  select.value = Array.prototype.some.call(select.options, (o) => { return o.value === current; }) ? current : 'auto';
}

export function previousSnapshots(place) {
  const choice = $('baseline').value;
  const list = loadHistory();
  if (choice === 'none') return [];
  if (choice !== 'auto') {
    return list.filter((b) => { return b.id === choice; }).map((b) => { return b.snapshot; });
  }
  const key = place.trim().toLowerCase();
  const same = list.filter((b) => { return (b.place || '').trim().toLowerCase() === key; });
  return (same.length ? same : list).slice(0, 5).map((b) => { return b.snapshot; });
}
