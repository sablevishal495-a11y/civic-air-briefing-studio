/**
 * Internal briefing note with copy, download and print.
 */

import { h, replace, copyText, download } from './dom.js';
import { state, $ } from './state.js';

export function renderNote() {
  const text = state.result.internalNoteText;
  replace($('note-body'),
    h('div', { class: 'toolbar' },
      h('button', { type: 'button', class: 'btn small', onclick (e) { copyText(text, e.currentTarget); } }, 'Copy note'),
      h('button', { type: 'button', class: 'btn small', onclick () { download('air-quality-briefing-note.txt', text); } }, 'Download .txt'),
      h('button', { type: 'button', class: 'btn small', onclick () { window.print(); } }, 'Print briefing')),
    h('pre', { class: 'note-text', tabindex: '0', 'aria-label': 'Internal briefing note text', text })
  );
}
