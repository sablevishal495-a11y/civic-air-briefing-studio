/**
 * Civic Air Quality Briefing Studio: browser entry point.
 * Wires the form to the backend and renders each section of the brief.
 */

import { api } from './api.js';
import { setStatus, showError } from './dom.js';
import { renderLanguages, selectedLanguages, renderAiStatus, loadSample, readFile } from './form.js';
import { saveHistory, rememberBrief, renderBaselineOptions, previousSnapshots } from './history.js';
import { renderAdvisory } from './render-advisory.js';
import { renderChanges } from './render-changes.js';
import { renderData } from './render-data.js';
import { renderFindings, renderActions } from './render-findings.js';
import { renderNote } from './render-note.js';
import { renderOverview } from './render-overview.js';
import { state, $, REGENERATE_EVENT } from './state.js';

function generate(event) {
  if (event) event.preventDefault();
  if (state.busy) return;
  const raw = $('raw').value;
  if (!raw.trim()) {
    showError('Add some air quality data first: paste a table, upload a file, or load a sample.');
    $('raw').focus();
    return;
  }
  if (raw.length > state.config.maxChars) {
    showError('That is too much data for one brief. Paste a smaller extract, for example one week of readings.');
    return;
  }
  let languages = selectedLanguages();
  if (!languages.length) languages = ['en'];
  const place = $('place').value.trim();
  const audience = document.querySelector('input[name="audience"]:checked').value;
  // With no key configured the box is disabled; let the server explain that instead of "switched off".
  const useAI = $('use-ai').checked || !state.config.ai;

  state.busy = true;
  $('generate').disabled = true;
  $('results').setAttribute('aria-busy', 'true');
  showError('');
  setStatus(useAI ? 'Reading your data and writing the briefing. This can take up to a minute…' : 'Reading your data…', true);

  api('analyze', {
    raw,
    previousRaw: $('previous-raw').value,
    previous: previousSnapshots(place),
    audience,
    place,
    useAI
  }).then((result) => {
    state.result = result;
    state.rows = {};
    result.parsed.rows.forEach((r) => { state.rows[r.id] = r; });
    renderAll();
    rememberBrief(result);
    $('results').hidden = false;
    $('overview').focus({ preventScroll: true });
    $('results').scrollIntoView();
    setStatus('Briefing ready. Writing citizen advisories…', true);
    return loadAdvisories(languages, audience, useAI);
  }).then(() => {
    setStatus('Briefing and advisories ready.');
  }).catch((err) => {
    setStatus('');
    showError(err.message || 'Something went wrong. Please try again.');
  }).then(() => {
    state.busy = false;
    $('generate').disabled = false;
    $('results').removeAttribute('aria-busy');
  });
}

function loadAdvisories(languages, audience, useAI) {
  const facts = state.result.advisoryFacts;
  state.advisory = { order: languages, items: {}, active: languages[0], level: 'easy' };
  languages.forEach((code) => { state.advisory.items[code] = { status: 'loading' }; });
  renderAdvisory();
  return Promise.all(languages.map((code) => {
    return api('advisory', { facts, language: code, audience, useAI }).then((data) => {
      state.advisory.items[code] = { status: 'ready', data };
    }, (err) => {
      state.advisory.items[code] = { status: 'error', message: err.message };
    }).then(renderAdvisory);
  }));
}

function renderAll() {
  renderOverview();
  renderFindings();
  renderActions();
  renderChanges();
  renderNote();
  renderData();
}

function init() {
  renderLanguages();
  renderBaselineOptions();
  $('studio-form').addEventListener('submit', generate);
  $('file').addEventListener('change', readFile);
  $('clear-data').addEventListener('click', () => {
    $('raw').value = '';
    $('previous-raw').value = '';
    $('file').value = '';
    $('file-name').textContent = '.csv, .tsv, .txt or .json, up to 200 KB';
    showError('');
    setStatus('');
    $('raw').focus();
  });
  $('clear-history').addEventListener('click', () => {
    saveHistory([]);
    renderBaselineOptions();
    setStatus('Saved briefs deleted from this browser.');
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-sample]'), (btn) => {
    btn.addEventListener('click', () => { loadSample(btn.getAttribute('data-sample')); });
  });
  api('config').then((config) => {
    state.config = config;
    renderLanguages();
  }).catch(() => { /* keep defaults; the rule engine still works */ }).then(renderAiStatus);
}

document.addEventListener(REGENERATE_EVENT, () => generate());
init();
