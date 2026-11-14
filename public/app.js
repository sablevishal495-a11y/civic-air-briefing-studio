/* Civic Air Quality Briefing Studio: browser app.
   No framework and no inline HTML strings: every node is built with DOM APIs,
   so pasted data and model output can never inject markup. */
(function () {
  'use strict';

  var HISTORY_KEY = 'caq.briefs.v1';
  var MAX_LANGUAGES = 4;
  var MAX_FILE_BYTES = 200 * 1024;
  var DEFAULT_CONFIG = {
    ai: false,
    model: null,
    maxChars: 200000,
    languages: [
      { code: 'en', name: 'English', native: 'English', dir: 'ltr' },
      { code: 'hi', name: 'Hindi', native: 'हिन्दी', dir: 'ltr' }
    ],
    flags: {},
    pollutants: {}
  };

  var state = { config: DEFAULT_CONFIG, result: null, advisory: null, busy: false, lastChip: null };
  var $ = function (id) { return document.getElementById(id); };

  // ---- Small helpers --------------------------------------------------------

  function h(tag, attrs) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }

  function append(el, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) kid.forEach(function (k) { append(el, k); });
    else el.appendChild(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }

  function replace(el) {
    el.textContent = '';
    for (var i = 1; i < arguments.length; i++) append(el, arguments[i]);
  }

  function setStatus(text, busy) {
    var el = $('status');
    el.textContent = text;
    el.classList.toggle('busy', Boolean(busy));
  }

  function showError(text) {
    var el = $('error');
    el.hidden = !text;
    el.textContent = text || '';
    if (text) el.scrollIntoView({ block: 'center' });
  }

  function api(path, body) {
    return fetch(path + '?op=' + path.split('/').pop(), {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || 'The server returned an error (' + res.status + ').');
        return data;
      });
    });
  }

  function copyText(text, button) {
    var done = function () {
      var old = button.textContent;
      button.textContent = 'Copied';
      setTimeout(function () { button.textContent = old; }, 1600);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else {
      fallbackCopy(text);
      done();
    }
  }

  function fallbackCopy(text) {
    var ta = h('textarea', { class: 'visually-hidden', 'aria-hidden': 'true' });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* nothing more to try */ }
    ta.remove();
  }

  function download(name, text) {
    var url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    var a = h('a', { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 500);
  }

  function catChip(category) {
    return category ? h('span', { class: 'cat cat-' + category.key, text: category.label }) : null;
  }

  function withUnit(value, unit) {
    return value + (unit ? ' ' + unit : '');
  }

  // ---- Saved briefs (for "what changed") -------------------------------------

  function loadHistory() {
    try {
      var list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function saveHistory(list) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 12))); } catch (e) { /* storage unavailable */ }
  }

  function rememberBrief(result) {
    var snap = result.snapshot;
    var list = loadHistory().filter(function (b) {
      // Re-running the same data (for another audience, say) replaces the entry.
      return !(b.snapshot && b.snapshot.period === snap.period && b.snapshot.overallMean === snap.overallMean && b.snapshot.place === snap.place);
    });
    list.unshift({ id: String(Date.now()), at: snap.createdAt, place: result.place, status: snap.overallCategory, snapshot: snap });
    saveHistory(list);
    renderBaselineOptions();
  }

  function renderBaselineOptions() {
    var select = $('baseline');
    var list = loadHistory();
    var current = select.value || 'auto';
    replace(select,
      h('option', { value: 'auto', text: list.length ? 'Most recent saved brief (automatic)' : 'No saved briefs yet' }),
      list.map(function (b) {
        var when = new Date(b.at);
        var label = (isNaN(when) ? '' : when.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' · ')
          + (b.place || 'Unnamed area') + ' · ' + b.snapshot.period + ' · ' + b.status;
        return h('option', { value: b.id, text: label });
      }),
      h('option', { value: 'none', text: 'Do not compare' })
    );
    select.value = Array.prototype.some.call(select.options, function (o) { return o.value === current; }) ? current : 'auto';
  }

  function previousSnapshots(place) {
    var choice = $('baseline').value;
    var list = loadHistory();
    if (choice === 'none') return [];
    if (choice !== 'auto') {
      return list.filter(function (b) { return b.id === choice; }).map(function (b) { return b.snapshot; });
    }
    var key = place.trim().toLowerCase();
    var same = list.filter(function (b) { return (b.place || '').trim().toLowerCase() === key; });
    return (same.length ? same : list).slice(0, 5).map(function (b) { return b.snapshot; });
  }

  // ---- Form -----------------------------------------------------------------

  function renderLanguages() {
    var defaults = ['en', 'hi'];
    replace($('languages'), state.config.languages.map(function (l) {
      return h('label', { class: 'chip-check' },
        h('input', { type: 'checkbox', name: 'language', value: l.code, checked: defaults.indexOf(l.code) >= 0, onchange: limitLanguages }),
        h('span', null, l.name, l.native !== l.name ? h('small', { lang: l.code, text: l.native }) : null)
      );
    }));
  }

  function selectedLanguages() {
    return Array.prototype.map.call(document.querySelectorAll('input[name="language"]:checked'), function (i) { return i.value; });
  }

  function limitLanguages(event) {
    if (selectedLanguages().length > MAX_LANGUAGES) {
      event.target.checked = false;
      setStatus('You can pick up to ' + MAX_LANGUAGES + ' languages at a time.');
    }
  }

  function renderAiStatus() {
    var el = $('ai-status');
    var on = state.config.ai;
    el.className = 'ai-status ' + (on ? 'on' : 'off');
    el.textContent = on
      ? 'Gemini connected' + (state.config.model ? ' (' + state.config.model + ')' : '')
      : 'Gemini not configured: using the built-in rule engine';
    if (!on) {
      $('use-ai').checked = false;
      $('use-ai').disabled = true;
    }
  }

  function loadSample(name) {
    var sample = (window.SAMPLES || {})[name];
    if (!sample) return;
    $('raw').value = sample.raw;
    $('previous-raw').value = sample.previousRaw;
    $('previous-panel').open = Boolean(sample.previousRaw);
    $('place').value = sample.place;
    $('file-name').textContent = 'Sample loaded';
    showError('');
    setStatus('Sample loaded. Choose an audience and press Generate briefing.');
  }

  function readFile(event) {
    var file = event.target.files[0];
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
    var reader = new FileReader();
    reader.onload = function () {
      $('raw').value = String(reader.result || '');
      $('file-name').textContent = file.name + ' loaded (' + Math.max(1, Math.round(file.size / 1024)) + ' KB)';
      showError('');
    };
    reader.onerror = function () { showError('The file could not be read. Try pasting the data instead.'); };
    reader.readAsText(file);
  }

  // ---- Generate ---------------------------------------------------------------

  function generate(event) {
    if (event) event.preventDefault();
    if (state.busy) return;
    var raw = $('raw').value;
    if (!raw.trim()) {
      showError('Add some air quality data first: paste a table, upload a file, or load a sample.');
      $('raw').focus();
      return;
    }
    if (raw.length > state.config.maxChars) {
      showError('That is too much data for one brief. Paste a smaller extract, for example one week of readings.');
      return;
    }
    var languages = selectedLanguages();
    if (!languages.length) languages = ['en'];
    var place = $('place').value.trim();
    var audience = document.querySelector('input[name="audience"]:checked').value;
    // With no key configured the box is disabled; let the server explain that instead of "switched off".
    var useAI = $('use-ai').checked || !state.config.ai;

    state.busy = true;
    $('generate').disabled = true;
    $('results').setAttribute('aria-busy', 'true');
    showError('');
    setStatus(useAI ? 'Reading your data and writing the briefing. This can take up to a minute…' : 'Reading your data…', true);

    api('/api/analyze', {
      raw: raw,
      previousRaw: $('previous-raw').value,
      previous: previousSnapshots(place),
      audience: audience,
      place: place,
      useAI: useAI
    }).then(function (result) {
      state.result = result;
      state.rows = {};
      result.parsed.rows.forEach(function (r) { state.rows[r.id] = r; });
      renderAll();
      rememberBrief(result);
      $('results').hidden = false;
      $('overview').focus({ preventScroll: true });
      $('results').scrollIntoView();
      setStatus('Briefing ready. Writing citizen advisories…', true);
      return loadAdvisories(languages, audience, useAI);
    }).then(function () {
      setStatus('Briefing and advisories ready.');
    }).catch(function (err) {
      setStatus('');
      showError(err.message || 'Something went wrong. Please try again.');
    }).then(function () {
      state.busy = false;
      $('generate').disabled = false;
      $('results').removeAttribute('aria-busy');
    });
  }

  function loadAdvisories(languages, audience, useAI) {
    var facts = state.result.advisoryFacts;
    state.advisory = { order: languages, items: {}, active: languages[0], level: 'easy' };
    languages.forEach(function (code) { state.advisory.items[code] = { status: 'loading' }; });
    renderAdvisory();
    return Promise.all(languages.map(function (code) {
      return api('/api/advisory', { facts: facts, language: code, audience: audience, useAI: useAI }).then(function (data) {
        state.advisory.items[code] = { status: 'ready', data: data };
      }, function (err) {
        state.advisory.items[code] = { status: 'error', message: err.message };
      }).then(renderAdvisory);
    }));
  }

  // ---- Evidence chips ---------------------------------------------------------

  function rowSummary(id) {
    var row = state.rows[id];
    if (!row) return id;
    var cells = Object.keys(row.cells).map(function (p) {
      var c = row.cells[p];
      var label = (state.config.pollutants[p] || {}).label || p;
      return label + ' ' + (c.value != null ? c.value : '"' + c.raw + '"');
    });
    return 'Row ' + id.slice(1) + ': ' + row.location + (row.time ? ', ' + row.time : '') + ', ' + cells.join(', ');
  }

  function evidence(ids, unverified) {
    if (unverified || !ids || !ids.length) {
      return h('div', { class: 'evidence' }, h('span', { class: 'badge unverified', text: 'No row reference' }), 'Treat this point with caution.');
    }
    return h('div', { class: 'evidence' }, 'Evidence:', ids.map(function (id) {
      return h('button', { type: 'button', class: 'row-chip', title: rowSummary(id), 'aria-label': 'Show ' + rowSummary(id), onclick: function (e) { showRow(id, e.currentTarget); } }, id);
    }));
  }

  function showRow(id, chip) {
    var tr = document.getElementById('row-' + id);
    if (!tr) return;
    Array.prototype.forEach.call(document.querySelectorAll('tr.hit'), function (el) { el.classList.remove('hit'); });
    tr.classList.add('hit');
    state.lastChip = chip;
    $('back-to-finding').hidden = false;
    tr.scrollIntoView({ block: 'center' });
    tr.focus({ preventScroll: true });
  }

  // ---- Rendering --------------------------------------------------------------

  function renderAll() {
    renderOverview();
    renderFindings();
    renderActions();
    renderChanges();
    renderNote();
    renderData();
  }

  function renderOverview() {
    var r = state.result;
    var s = r.stats;
    var hot = s.locations.filter(function (l) { return l.isHotspot; });
    var scaleMax = Math.max.apply(null, s.locations.map(function (l) { return l.mean || 0; }).concat([s.breakpoints[2] * 1.15]));
    var poorFrom = s.breakpoints[2];

    var bars = s.locations.filter(function (l) { return l.mean != null; }).map(function (l) {
      var fill = h('div', { class: 'bar-fill cat-' + l.category.key + (l.reliability === 'low' ? ' low' : '') });
      fill.style.width = Math.max(1, Math.round((l.mean / scaleMax) * 100)) + '%';
      var mark = h('div', { class: 'bar-mark', 'aria-hidden': 'true' });
      mark.style.left = Math.round((poorFrom / scaleMax) * 100) + '%';
      var trend = l.trend.direction === 'unknown' ? '' : ', ' + l.trend.direction + (l.trend.pct ? ' ' + (l.trend.pct > 0 ? '+' : '') + l.trend.pct + '%' : '');
      return h('div', { class: 'bar-row', role: 'listitem', title: l.name + ': average ' + withUnit(l.mean, s.unit) + ', peak ' + withUnit(l.max, s.unit) + ' (row ' + l.maxRow + ')' + trend },
        h('div', { class: 'bar-name' }, l.name,
          h('small', null, (l.isHotspot ? 'Hotspot · ' : '') + 'peak ' + l.max + trend + (l.reliability === 'low' ? ' · low confidence' : ''))),
        h('div', { class: 'bar-track' }, fill, mark),
        h('div', { class: 'bar-value' }, withUnit(l.mean, s.unit), catChip(l.category))
      );
    });

    var bands = ['Good', 'Satisfactory', 'Moderate', 'Poor', 'Very Poor', 'Severe'];
    var keys = ['good', 'satisfactory', 'moderate', 'poor', 'very_poor', 'severe'];
    var bandKey = bands.map(function (label, i) {
      var lo = i === 0 ? 0 : s.breakpoints[i - 1];
      var range = i === 5 ? 'above ' + s.breakpoints[4] : lo + '–' + s.breakpoints[i];
      return h('span', { class: 'cat cat-' + keys[i], text: label + ' ' + range });
    });

    var tod = s.timeOfDay;
    var todBlock = null;
    if (tod) {
      var todMax = Math.max.apply(null, tod.buckets.map(function (b) { return b.mean; }));
      todBlock = h('div', null,
        h('h3', { text: 'By time of day' }),
        h('div', { class: 'chart compact', role: 'list', 'aria-label': 'Average ' + s.primaryLabel + ' by time of day' }, tod.buckets.map(function (b) {
          var fill = h('div', { class: 'bar-fill' });
          fill.style.width = Math.round((b.mean / todMax) * 100) + '%';
          fill.style.background = b.key === tod.peak ? 'var(--accent)' : '#9db8b3';
          return h('div', { class: 'bar-row', role: 'listitem' },
            h('div', { class: 'bar-name' }, b.label, h('small', null, b.n + ' readings' + (b.key === tod.peak ? ' · highest' : b.key === tod.best ? ' · lowest' : ''))),
            h('div', { class: 'bar-track' }, fill),
            h('div', { class: 'bar-value' }, withUnit(b.mean, s.unit)));
        })),
        tod.meaningful ? null : h('p', { class: 'hint small', text: 'The difference between times of day is small, so it is not treated as a pattern.' })
      );
    }

    var others = s.otherPollutants.filter(function (p) { return p.mean != null; });
    var othersBlock = others.length ? h('div', null,
      h('h3', { text: 'Other pollutants in this data' }),
      h('div', { class: 'table-scroll' }, h('table', null,
        h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Pollutant' }), h('th', { scope: 'col', class: 'num', text: 'Average' }), h('th', { scope: 'col', class: 'num', text: 'Peak' }), h('th', { scope: 'col', text: 'Band' }))),
        h('tbody', null, others.map(function (p) {
          return h('tr', null, h('th', { scope: 'row', text: p.label }), h('td', { class: 'num', text: withUnit(p.mean, p.unit) }),
            h('td', { class: 'num' }, withUnit(p.max, p.unit), evidence([p.maxRow])), h('td', null, catChip(p.category)));
        }))
      ))
    ) : null;

    replace($('overview-body'),
      r.mode === 'ai'
        ? h('p', { class: 'notice info', text: 'Written by Gemini (' + r.model + ') from statistics computed directly from your rows. Cited rows were checked against the data.' })
        : h('p', { class: 'notice', text: r.aiNotice }),
      r.restructured ? h('p', { class: 'notice', text: 'Your input was not a regular table, so Gemini extracted the readings from the text. Check the Data section before relying on this brief.' }) : null,
      h('p', { class: 'headline', text: r.brief.headline }),
      h('p', { text: r.brief.summary }),
      h('p', { class: 'meta-line', text: 'For: ' + r.audienceLabel + (r.place ? ' · ' + r.place : '') + ' · Data period: ' + s.period.label }),
      h('div', { class: 'tiles' },
        h('div', { class: 'tile' }, h('div', { class: 'tile-label', text: 'Overall ' + s.primaryLabel }),
          h('div', { class: 'tile-value' }, String(s.overall.mean), ' ', h('small', { text: s.unit })), h('div', { class: 'tile-note' }, catChip(s.overall.category))),
        h('div', { class: 'tile' }, h('div', { class: 'tile-label', text: 'Hotspots' }),
          h('div', { class: 'tile-value' }, String(hot.length), ' ', h('small', { text: 'of ' + s.totals.locations + ' locations' })),
          h('div', { class: 'tile-note', text: hot.length ? hot.slice(0, 2).map(function (l) { return l.name; }).join(', ') : 'None in the Poor range or worse' })),
        h('div', { class: 'tile' }, h('div', { class: 'tile-label', text: 'Highest reading' }),
          h('div', { class: 'tile-value' }, String(s.overall.max), ' ', h('small', { text: s.unit })),
          h('div', { class: 'tile-note' }, evidence([s.overall.maxRow]))),
        h('div', { class: 'tile' }, h('div', { class: 'tile-label', text: 'Usable data' }),
          h('div', { class: 'tile-value' }, s.totals.coveragePct + '%'),
          h('div', { class: 'tile-note', text: s.totals.usable + ' of ' + s.totals.readings + ' readings; ' + s.totals.excluded + ' missing or flagged' }))
      ),
      h('h3', { text: 'Average ' + s.primaryLabel + ' by location' }),
      h('div', { class: 'chart', role: 'list', 'aria-label': 'Average ' + s.primaryLabel + ' by location, highest first' }, bars),
      h('div', { class: 'chart-key' }, h('span', null, h('span', { class: 'dash', 'aria-hidden': 'true' }), 'Poor starts above ' + withUnit(poorFrom, s.unit)), bandKey),
      h('p', { class: 'hint small', text: 'Striped bars are low-confidence locations. ' + s.standard }),
      h('div', { class: 'split' }, todBlock, othersBlock)
    );
  }

  function findingList(items, kind) {
    return h('ul', { class: 'plain' }, items.map(function (item) {
      return h('li', { class: 'finding' + (kind === 'quality' ? ' quality' : '') },
        item.location ? h('strong', { text: item.location }) : null,
        h('span', { text: item.text + ' ' }),
        item.confidence ? h('span', { class: 'badge ' + item.confidence, text: item.confidence + ' confidence' }) : null,
        item.impact ? h('div', { class: 'impact', text: item.impact }) : null,
        kind === 'quality' && !item.evidence.length ? null : evidence(item.evidence, item.unverified)
      );
    }));
  }

  function renderFindings() {
    var b = state.result.brief;
    replace($('findings-body'),
      h('h3', { text: 'Likely hotspots' }), findingList(b.hotspots),
      h('h3', { text: 'Trends' }), findingList(b.trends),
      h('h3', { text: 'Data gaps and unreliable readings' }), findingList(b.dataQuality, 'quality')
    );
  }

  function renderActions() {
    var r = state.result;
    var others = [['ward', 'Ward officer'], ['society', 'Housing society'], ['school', 'School']].filter(function (a) { return a[0] !== r.audience; });
    replace($('actions-body'),
      h('p', { class: 'hint', text: 'For: ' + r.audienceLabel + '. Ordered by urgency, and limited to what this audience has the power to do.' }),
      h('ol', { class: 'plain' }, r.brief.actions.map(function (a, i) {
        return h('li', { class: 'action' },
          h('div', { class: 'action-num', 'aria-hidden': 'true', text: String(i + 1) }),
          h('div', null, h('span', { class: 'badge time', text: a.timeframe }), ' ', h('span', { class: 'action-title', text: a.title })),
          h('div', null, a.detail ? h('div', { text: a.detail }) : null, a.why ? h('div', { class: 'action-why', text: 'Why: ' + a.why }) : null, evidence(a.evidence, a.unverified))
        );
      })),
      h('div', { class: 'audience-switch' }, 'See actions for another audience:', others.map(function (a) {
        return h('button', { type: 'button', class: 'btn small', onclick: function () {
          document.querySelector('input[name="audience"][value="' + a[0] + '"]').checked = true;
          generate();
        } }, a[1]);
      }))
    );
  }

  var DIRECTION = { worse: '▲ Worse', better: '▼ Better', same: '● Same', new: '◆ New' };

  function renderChanges() {
    var r = state.result;
    var c = r.comparison;
    if (!c.available) {
      replace($('changes-body'),
        c.warning ? h('p', { class: 'notice', text: c.warning }) : null,
        h('p', { text: 'There is no earlier brief to compare with yet. This brief has been saved in this browser as the baseline, so the next one you generate will show what changed.' }),
        h('p', { class: 'hint', text: 'To see a comparison now, open "Compare with an earlier period" in step 1 and paste the earlier readings, or load the "Week 2, compared with Week 1" sample.' }));
      return;
    }
    var prev = c.previous;
    var when = prev.createdAt ? new Date(prev.createdAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    var s = r.stats;
    var table = c.comparable && c.locations.length ? h('div', { class: 'table-scroll' }, h('table', null,
      h('caption', { text: 'Average ' + s.primaryLabel + ' by location, previous and now' }),
      h('thead', null, h('tr', null,
        h('th', { scope: 'col', text: 'Location' }), h('th', { scope: 'col', class: 'num', text: 'Previous' }), h('th', { scope: 'col', class: 'num', text: 'Now' }),
        h('th', { scope: 'col', class: 'num', text: 'Change' }), h('th', { scope: 'col', text: 'Direction' }), h('th', { scope: 'col', text: 'Band' }))),
      h('tbody', null, [{ name: 'All locations', prev: c.overall.prev, curr: c.overall.curr, delta: c.overall.delta, deltaPct: c.overall.deltaPct, direction: c.overall.direction, prevCategory: c.overall.prevCategory, currCategory: c.overall.currCategory }]
        .concat(c.locations).map(function (l) {
          return h('tr', null,
            h('th', { scope: 'row' }, l.name, l.lowConfidence ? h('span', { class: 'flag', text: 'low confidence' }) : null),
            h('td', { class: 'num', text: String(l.prev) }), h('td', { class: 'num', text: String(l.curr) }),
            h('td', { class: 'num', text: (l.delta > 0 ? '+' : '') + l.delta + ' (' + (l.deltaPct > 0 ? '+' : '') + l.deltaPct + '%)' }),
            h('td', null, h('span', { class: 'dir ' + l.direction, text: DIRECTION[l.direction] })),
            h('td', { text: l.prevCategory === l.currCategory ? l.currCategory : l.prevCategory + ' → ' + l.currCategory }));
        }))
    )) : null;

    replace($('changes-body'),
      h('p', { class: 'meta-line', text: 'Compared with ' + (c.source === 'data' ? 'the earlier readings you pasted' : 'the brief saved ' + when) + ' (data period: ' + prev.period + ').' }),
      h('ul', { class: 'plain' }, r.brief.changes.map(function (ch) {
        return h('li', { class: 'finding' }, h('span', { class: 'dir ' + ch.direction, text: DIRECTION[ch.direction] }), ' ', ch.text);
      })),
      table,
      h('p', { class: 'hint small', text: 'A change of less than 10% is treated as "same". The table is calculated directly from the two sets of readings.' })
    );
  }

  function renderNote() {
    var text = state.result.internalNoteText;
    replace($('note-body'),
      h('div', { class: 'toolbar' },
        h('button', { type: 'button', class: 'btn small', onclick: function (e) { copyText(text, e.currentTarget); } }, 'Copy note'),
        h('button', { type: 'button', class: 'btn small', onclick: function () { download('air-quality-briefing-note.txt', text); } }, 'Download .txt'),
        h('button', { type: 'button', class: 'btn small', onclick: function () { window.print(); } }, 'Print briefing')),
      h('pre', { class: 'note-text', tabindex: '0', 'aria-label': 'Internal briefing note text', text: text })
    );
  }

  function advisoryText(a, level) {
    if (level === 'sms') return a.sms;
    var groups = ['Children', 'Older adults', 'People sensitive to poor air'];
    var lists = [a.groups.children, a.groups.olderAdults, a.groups.sensitive];
    var body = level === 'easy' ? [a.easy.title, ''].concat(a.easy.lines) : [a.standard.title, ''].concat(a.standard.paragraphs);
    lists.forEach(function (list, i) {
      body.push('', groups[i] + ':');
      list.forEach(function (tip) { body.push('- ' + tip); });
    });
    return body.join('\n');
  }

  function renderAdvisory() {
    var adv = state.advisory;
    if (!adv) return;
    var langs = state.config.languages;
    var meta = function (code) { return langs.filter(function (l) { return l.code === code; })[0] || { code: code, name: code, native: code, dir: 'ltr' }; };
    var item = adv.items[adv.active];
    var levels = [['easy', 'Easy read'], ['standard', 'Standard'], ['sms', 'SMS']];

    var panel;
    if (item.status === 'loading') {
      panel = h('p', { class: 'status busy', text: 'Writing the ' + meta(adv.active).name + ' advisory…' });
    } else if (item.status === 'error') {
      panel = h('p', { class: 'notice', text: 'The ' + meta(adv.active).name + ' advisory could not be written: ' + item.message });
    } else {
      var d = item.data;
      var a = d.advisory;
      var shown = d.shownIn;
      var content;
      if (adv.level === 'easy') {
        content = [h('h3', { class: 'adv-title', text: a.easy.title }), h('ul', { class: 'adv-easy' }, a.easy.lines.map(function (line) { return h('li', { text: line }); }))];
      } else if (adv.level === 'standard') {
        content = [h('h3', { class: 'adv-title', text: a.standard.title }), a.standard.paragraphs.map(function (p) { return h('p', { text: p }); })];
      } else {
        content = [h('p', { class: 'adv-sms', text: a.sms }), h('p', { class: 'hint small', text: a.sms.length + ' characters' })];
      }
      var group = function (title, tips) {
        return h('div', { class: 'group' }, h('h4', { lang: 'en', dir: 'ltr', text: title }), h('ul', null, tips.map(function (t) { return h('li', { text: t }); })));
      };
      panel = h('div', null,
        d.notice ? h('p', { class: 'notice', text: d.notice }) : null,
        h('div', { class: 'toolbar', role: 'group', 'aria-label': 'Reading level' }, levels.map(function (l) {
          return h('button', { type: 'button', class: 'btn small', 'aria-pressed': String(adv.level === l[0]), onclick: function () { adv.level = l[0]; renderAdvisory(); } }, l[1]);
        }), h('button', { type: 'button', class: 'btn small quiet', onclick: function (e) { copyText(advisoryText(a, adv.level), e.currentTarget); } }, 'Copy this version')),
        h('div', { class: 'adv-panel', lang: shown.code, dir: shown.dir }, content,
          adv.level === 'sms' ? null : h('div', { class: 'groups' },
            group('Children', a.groups.children), group('Older adults', a.groups.olderAdults), group('People sensitive to poor air', a.groups.sensitive))),
        h('p', { class: 'hint small', text: d.mode === 'ai' ? 'Written by Gemini from the facts in this brief. Have a fluent speaker check it before wide circulation.' : 'Written from built-in templates.' })
      );
    }

    replace($('advisory-body'),
      h('p', { class: 'hint', text: 'Ready to share with residents. Easy read is written for a 9-year-old reading level; Standard is for general readers.' }),
      h('div', { class: 'toolbar', role: 'group', 'aria-label': 'Advisory language' }, adv.order.map(function (code) {
        var m = meta(code);
        var st = adv.items[code].status;
        return h('button', { type: 'button', class: 'btn small', 'aria-pressed': String(adv.active === code), onclick: function () { adv.active = code; renderAdvisory(); } },
          m.name, m.native !== m.name ? h('span', { lang: m.code, text: ' ' + m.native }) : null, st === 'loading' ? ' …' : st === 'error' ? ' (failed)' : null);
      })),
      panel
    );
  }

  function renderData() {
    var p = state.result.parsed;
    var flags = state.config.flags;
    var pollutants = p.pollutants;
    var label = function (key) { return (state.config.pollutants[key] || {}).label || key; };
    var unit = function (key) { return (state.config.pollutants[key] || {}).unit || ''; };
    var hasRemark = p.rows.some(function (r) { return r.remark; });

    var body = p.rows.map(function (r) {
      return h('tr', { id: 'row-' + r.id, tabindex: '-1' },
        h('th', { scope: 'row' }, h('span', { class: 'chip-example', text: r.id })),
        h('td', null, r.location, r.flags.indexOf('location_filled') >= 0 ? h('span', { class: 'flag', text: 'filled from row above' }) : null),
        h('td', { text: r.time || '' }),
        pollutants.map(function (key) {
          var c = r.cells[key];
          if (!c) return h('td', { class: 'num', text: '' });
          var cls = 'num' + (!c.ok ? ' bad' : c.flags.length ? ' soft' : '');
          var names = c.flags.map(function (f) { return (flags[f] || {}).label || f; });
          var title = c.flags.map(function (f) { return (flags[f] || {}).text || f; }).join('. ');
          return h('td', { class: cls, title: title || null },
            c.value != null && c.ok ? String(c.value) : h('span', { class: c.ok ? '' : 'rawval', text: c.value != null ? String(c.value) : (c.raw || 'blank') }),
            names.length ? h('span', { class: 'flag', text: names.join(', ') + (c.note ? ' (' + c.note + ')' : '') }) : null);
        }),
        hasRemark ? h('td', { text: r.remark || '' }) : null
      );
    });

    replace($('data-body'),
      h('p', { class: 'hint', text: 'This is how your data was read. Row IDs match the line numbers of what you pasted (R7 is line 7). Red cells were excluded from every average; amber cells were kept but should be verified.' }),
      h('div', { class: 'toolbar' },
        h('button', { type: 'button', class: 'btn small', id: 'back-to-finding', hidden: true, onclick: function () {
          if (state.lastChip && document.contains(state.lastChip)) { state.lastChip.scrollIntoView({ block: 'center' }); state.lastChip.focus({ preventScroll: true }); }
        } }, '↩ Back to the finding')),
      h('div', { class: 'table-scroll', tabindex: '0', role: 'region', 'aria-label': 'Readings table' }, h('table', null,
        h('caption', { class: 'visually-hidden', text: 'Readings as interpreted, with row IDs and flags' }),
        h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Row' }), h('th', { scope: 'col', text: 'Location' }), h('th', { scope: 'col', text: 'Time' }),
          pollutants.map(function (key) { return h('th', { scope: 'col', class: 'num', text: label(key) + (unit(key) ? ' (' + unit(key) + ')' : '') }); }),
          hasRemark ? h('th', { scope: 'col', text: 'Remarks' }) : null)),
        h('tbody', null, body))),
      h('details', { class: 'more', open: true },
        h('summary', { text: 'How the table was interpreted' }),
        h('dl', { class: 'kv' },
          h('dt', { text: 'Layout' }), h('dd', { text: (p.format === 'long' ? 'One reading per row' : 'One column per pollutant') + ', separated by ' + p.delimiter }),
          p.columns.map(function (c) { return [h('dt', { text: '"' + c.header + '"' }), h('dd', { text: c.meaning })]; })),
        p.notes.length ? h('ul', null, p.notes.map(function (n) { return h('li', { text: n }); })) : null,
        state.result.mode === 'ai' ? [h('p', { class: 'hint small', text: 'Gemini\'s reading of the data:' }), h('ul', null, state.result.brief.dataInterpretation.map(function (n) { return h('li', { text: n }); }))] : null,
        p.ignored.length ? h('p', { class: 'hint small', text: 'Lines not treated as readings: ' + p.ignored.map(function (i) { return 'line ' + i.line + ' (' + i.reason.toLowerCase() + ')'; }).join('; ') + '.' }) : null)
    );
  }

  // ---- Start ------------------------------------------------------------------

  function init() {
    renderLanguages();
    renderBaselineOptions();
    $('studio-form').addEventListener('submit', generate);
    $('file').addEventListener('change', readFile);
    $('clear-data').addEventListener('click', function () {
      $('raw').value = '';
      $('previous-raw').value = '';
      $('file').value = '';
      $('file-name').textContent = '.csv, .tsv, .txt or .json, up to 200 KB';
      showError('');
      setStatus('');
      $('raw').focus();
    });
    $('clear-history').addEventListener('click', function () {
      saveHistory([]);
      renderBaselineOptions();
      setStatus('Saved briefs deleted from this browser.');
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-sample]'), function (btn) {
      btn.addEventListener('click', function () { loadSample(btn.getAttribute('data-sample')); });
    });
    api('/api/config').then(function (config) {
      state.config = config;
      renderLanguages();
    }).catch(function () { /* keep defaults; the rule engine still works */ }).then(renderAiStatus);
  }

  init();
})();
