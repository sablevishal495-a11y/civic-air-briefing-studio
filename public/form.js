/**
 * Input form: languages, AI status badge, samples and file upload.
 */

import { h, replace, setStatus, showError } from './dom.js';
import { MAX_LANGUAGES, MAX_FILE_BYTES, state, $ } from './state.js';

export function renderLanguages() {
  const defaults = ['en', 'hi'];
  replace($('languages'), state.config.languages.map((l) => {
    return h('label', { class: 'chip-check' },
      h('input', { type: 'checkbox', name: 'language', value: l.code, checked: defaults.indexOf(l.code) >= 0, onchange: limitLanguages }),
      h('span', null, l.name, l.native !== l.name ? h('small', { lang: l.code, text: l.native }) : null)
    );
  }));
}

export function selectedLanguages() {
  return Array.prototype.map.call(document.querySelectorAll('input[name="language"]:checked'), (i) => { return i.value; });
}

export function limitLanguages(event) {
  if (selectedLanguages().length > MAX_LANGUAGES) {
    event.target.checked = false;
    setStatus(`You can pick up to ${  MAX_LANGUAGES  } languages at a time.`);
  }
}

export function renderAiStatus() {
  const el = $('ai-status');
  const on = state.config.ai;
  el.className = `ai-status ${  on ? 'on' : 'off'}`;
  el.textContent = on
    ? `Gemini connected${  state.config.model ? ` (${  state.config.model  })` : ''}`
    : 'Gemini not configured: using the built-in rule engine';
  if (!on) {
    $('use-ai').checked = false;
    $('use-ai').disabled = true;
  }
}

export function loadSample(name) {
  const sample = (window.SAMPLES || {})[name];
  if (!sample) return;
  $('raw').value = sample.raw;
  $('previous-raw').value = sample.previousRaw;
  $('previous-panel').open = Boolean(sample.previousRaw);
  $('place').value = sample.place;
  $('file-name').textContent = 'Sample loaded';
  showError('');
  setStatus('Sample loaded. Choose an audience and press Generate briefing.');
}

export function readFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (/\.(xlsx?|ods|pdf|docx?)$/i.test(file.name)) {
    showError('That file type cannot be read directly. In your spreadsheet, choose "Save as CSV" and upload the CSV, or copy the cells and paste them here.');
    event.target.value = '';
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    showError('That file is larger than 200 KB. Upload a smaller extract, for example one week of readings.');
    event.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = function () {
    $('raw').value = String(reader.result || '');
    $('file-name').textContent = `${file.name  } loaded (${  Math.max(1, Math.round(file.size / 1024))  } KB)`;
    showError('');
  };
  reader.onerror = function () { showError('The file could not be read. Try pasting the data instead.'); };
  reader.readAsText(file);
}
