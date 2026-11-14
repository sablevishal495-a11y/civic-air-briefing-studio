'use strict';

/**
 * Messy-table parser for air quality readings.
 *
 * Turns pasted / uploaded text (CSV, TSV, semicolon, Markdown pipes, aligned
 * columns, JSON arrays) into normalised readings. Every reading keeps the ID of
 * the source row ("R7" = line 7 of the pasted text) so that each downstream
 * finding can be traced back to the data it came from.
 *
 * Nothing is silently dropped or "fixed": every cleaning decision produces a flag.
 */

const MAX_ROWS = 1500;

const POLLUTANTS = {
  pm25: { key: 'pm25', label: 'PM2.5', unit: 'µg/m³', max: 1500, zeroSuspect: true },
  pm10: { key: 'pm10', label: 'PM10', unit: 'µg/m³', max: 3000, zeroSuspect: true },
  no2: { key: 'no2', label: 'NO₂', unit: 'µg/m³', max: 2000, ppb: 1.88 },
  so2: { key: 'so2', label: 'SO₂', unit: 'µg/m³', max: 2000, ppb: 2.62 },
  o3: { key: 'o3', label: 'O₃', unit: 'µg/m³', max: 1000, ppb: 1.96 },
  co: { key: 'co', label: 'CO', unit: 'mg/m³', max: 100, ppm: 1.145 },
  aqi: { key: 'aqi', label: 'AQI', unit: '', max: 1000, zeroSuspect: true },
};

/** Flag catalogue. `exclude: true` flags remove a reading from all statistics. */
const FLAGS = {
  missing: { label: 'Missing', exclude: true, text: 'No reading recorded' },
  unreadable: { label: 'Unreadable', exclude: true, text: 'Cell contains text that is not a number' },
  negative: { label: 'Negative value', exclude: true, text: 'Concentrations cannot be below zero' },
  sentinel: { label: 'Sensor error code', exclude: true, text: 'Value such as 999 / -999 is a typical sensor fault code' },
  implausible: { label: 'Implausibly high', exclude: true, text: 'Value is outside the physically plausible range' },
  zero: { label: 'Zero reading', exclude: true, text: 'Exactly 0 is almost always a sensor or logging fault' },
  unit_suspect: { label: 'Unit mismatch?', exclude: true, text: 'Value is far below the rest of the column; probably recorded in a different unit' },
  stuck: { label: 'Stuck sensor?', exclude: true, text: 'Same value repeated 4+ times in a row at this location' },
  duplicate: { label: 'Duplicate', exclude: true, text: 'Same location and time appears more than once' },
  unknown_pollutant: { label: 'Unknown pollutant', exclude: true, text: 'Pollutant name not recognised' },
  spike: { label: 'Sudden spike', exclude: false, text: 'Much higher than other readings at this location; verify before acting' },
  censored: { label: 'Limit value', exclude: false, text: 'Recorded as "<" or ">" a limit; the limit value is used' },
  marked: { label: 'Marked in source', exclude: false, text: 'Flagged as estimated or uncertain in the source data' },
  converted: { label: 'Unit converted', exclude: false, text: 'Converted to the standard unit' },
  location_filled: { label: 'Location filled down', exclude: false, text: 'Blank location taken from the row above' },
};

const MISSING_TOKENS = new Set([
  '', '-', '--', '---', '—', 'na', 'n/a', 'n.a.', 'nan', 'null', 'none', 'nil', 'missing',
  'no data', 'nodata', '#n/a', '#value!', 'error', 'err', 'offline', '?', 'x', 'tbd', 'nd', 'not available',
]);

const SENTINELS = new Set([999, 9999, 99999, 999.9, 9999.9, -999, -9999, -99, -99.9, -999.9]);

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const WEEKDAYS = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
const DAY_MS = 86400000;

function clean(cell) {
  let s = String(cell == null ? '' : cell).replace(/\s+/g, ' ').trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).trim();
  return s;
}

function detectPollutant(text) {
  const h = String(text).toLowerCase().replace(/_/g, ' ').replace(/₂/g, '2').replace(/₃/g, '3');
  if (/pm\s*[- ]?2[.,· ]?5|pm25/.test(h)) return 'pm25';
  if (/pm\s*[- ]?10\b/.test(h)) return 'pm10';
  if (/\bno\s*[- ]?2\b|nitrogen dioxide/.test(h)) return 'no2';
  if (/\bso\s*[- ]?2\b|sul(ph|f)ur dioxide/.test(h)) return 'so2';
  if (/\bo\s*[- ]?3\b|ozone/.test(h)) return 'o3';
  if (/\bco\b(?!\s*2)|carbon monoxide/.test(h)) return 'co';
  if (/\baqi\b|air quality index/.test(h)) return 'aqi';
  return null;
}

function detectUnit(text) {
  const t = String(text).toLowerCase().replace(/\s+/g, '');
  if (/(µg|μg|ug|mcg|microgram)/.test(t)) return 'ug';
  if (/mg\/?m|milligram/.test(t)) return 'mg';
  if (/ppb/.test(t)) return 'ppb';
  if (/ppm/.test(t)) return 'ppm';
  return null;
}

function isNumericLike(cell) {
  return /^[<>~≤≥]?\s*-?\d/.test(cell);
}

/** Decide what a header cell means. */
function classifyHeader(header) {
  const s = String(header).toLowerCase().replace(/_/g, ' ').trim();
  if (!s) return { role: 'ignore' };
  if (/^source ?line$/.test(s)) return { role: 'sourceline' };
  if (/^(s\.?\s*no\.?|sr\.?\s*no\.?|sl\.?\s*no\.?|#|id|index|serial( no\.?| number)?|row)$/.test(s)) return { role: 'ignore' };
  const pollutant = detectPollutant(s);
  if (pollutant) return { role: 'value', pollutant, unit: detectUnit(s) };
  if (/^units?$|^uom$/.test(s)) return { role: 'unit' };
  if (/pollutant|parameter|metric|species/.test(s)) return { role: 'pollutantName' };
  if (/date|time(?!s)|timestamp|\bday\b|\bhour\b|\bwhen\b/.test(s)) {
    if (/date ?time|timestamp|\bwhen\b/.test(s)) return { role: 'datetime' };
    if (/time|hour/.test(s) && !/date|day/.test(s)) return { role: 'time' };
    return { role: 'date' };
  }
  if (/^(value|reading|concentration|conc\.?|level|result|measurement)s?\b/.test(s)) return { role: 'longValue', unit: detectUnit(s) };
  if (/location|station|site|area|ward|place|locality|zone|sensor|monitor|society|school|name|point|spot|address|landmark|junction|neighbou?rhood|colony|sector/.test(s)) return { role: 'location' };
  if (/remark|note|comment|status|observ/.test(s)) return { role: 'remark' };
  return { role: 'unknown' };
}

function countDelimiter(line, d) {
  let n = 0;
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === d && !quoted) n++;
  }
  return n;
}

/** Pick the delimiter that splits most lines into the same number of cells. */
function detectDelimiter(lines) {
  let best = 'space';
  let bestScore = 0;
  for (const d of ['\t', '|', ';', ',']) {
    const counts = lines.map((l) => countDelimiter(l, d)).filter((c) => c > 0);
    if (counts.length < Math.min(2, lines.length) || counts.length < lines.length * 0.5) continue;
    const freq = new Map();
    counts.forEach((c) => freq.set(c, (freq.get(c) || 0) + 1));
    const [mode, modeCount] = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
    const score = (modeCount / lines.length) * 100 + Math.min(mode, 10);
    if (score > bestScore + 5) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

function splitLine(line, d) {
  if (d === 'space') return line.trim().split(/\s{2,}|\t/).map(clean);
  if (d === '|') {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map(clean);
  }
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === d && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map(clean);
}

/** Accept a JSON array of flat objects by converting it to a tab-separated table. */
function jsonToTable(text) {
  const t = text.trim();
  if (!t.startsWith('[') && !t.startsWith('{')) return null;
  try {
    let data = JSON.parse(t);
    if (!Array.isArray(data)) data = data.data || data.readings || data.records || data.rows;
    if (!Array.isArray(data) || !data.length || typeof data[0] !== 'object') return null;
    const keys = [];
    data.forEach((o) => Object.keys(o || {}).forEach((k) => { if (!keys.includes(k)) keys.push(k); }));
    const cell = (v) => (v == null ? '' : String(typeof v === 'object' ? JSON.stringify(v) : v).replace(/[\t\n]/g, ' '));
    const lines = [keys.join('\t')].concat(data.map((o) => keys.map((k) => cell((o || {})[k])).join('\t')));
    return lines.join('\n');
  } catch {
    return null;
  }
}

/**
 * Parse a date/time written in almost any common way.
 * Ambiguous numeric dates (03/04/2026) are read day-first, as is usual in India.
 */
function parseTime(dateStr, timeStr, defaultYear) {
  const label = [dateStr, timeStr].map((s) => String(s || '').trim()).filter(Boolean).join(' ');
  if (!label) return { t: null, label: '', hour: null, fmt: null };
  let rest = ` ${label.toLowerCase()} `;
  let hour = null;
  let minute = 0;
  let ap = null;
  let m = rest.match(/(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(am|pm)?/);
  if (m) {
    hour = +m[1]; minute = +m[2]; ap = m[3] || null;
    rest = rest.replace(m[0], ' ');
  } else if ((m = rest.match(/\b(\d{1,2})\s*(am|pm)\b/))) {
    hour = +m[1]; ap = m[2];
    rest = rest.replace(m[0], ' ');
  } else if ((m = rest.match(/\b([01]\d|2[0-3])([0-5]\d)\s*(hrs|hours|h)\b/))) {
    hour = +m[1]; minute = +m[2];
    rest = rest.replace(m[0], ' ');
  } else if ((m = rest.match(/\b(morning|noon|afternoon|evening|night|midnight)\b/))) {
    hour = { morning: 8, noon: 12, afternoon: 14, evening: 19, night: 22, midnight: 0 }[m[1]];
    rest = rest.replace(m[0], ' ');
  }
  if (ap === 'pm' && hour < 12) hour += 12;
  if (ap === 'am' && hour === 12) hour = 0;
  if (hour != null && (hour > 23 || minute > 59)) { hour = null; minute = 0; }
  const timeMs = hour == null ? 0 : hour * 3600000 + minute * 60000;

  let y = null; let mo = null; let d = null; let fmt = null;
  if ((m = rest.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) {
    y = +m[1]; mo = +m[2] - 1; d = +m[3]; fmt = 'year-month-day';
  } else if ((m = rest.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/))) {
    const a = +m[1]; const b = +m[2];
    y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    if (a <= 12 && b > 12) { mo = a - 1; d = b; fmt = 'month/day/year'; } else { d = a; mo = b - 1; fmt = 'day/month/year'; }
  } else if ((m = rest.match(/\b(\d{1,2})(?:st|nd|rd|th)?[\s\-/,.]*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?[\s\-/,.]*(\d{4}|\d{2})?(?!\d)/))) {
    d = +m[1]; mo = MONTHS[m[2]]; y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : defaultYear; fmt = 'day month-name';
  } else if ((m = rest.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/))) {
    mo = MONTHS[m[1]]; d = +m[2]; y = m[3] ? +m[3] : defaultYear; fmt = 'month-name day';
  } else if ((m = rest.match(/\b(\d{1,2})[/-](\d{1,2})\b/))) {
    d = +m[1]; mo = +m[2] - 1; y = defaultYear; fmt = 'day/month';
  }
  if (fmt) {
    const t = Date.UTC(y, mo, d, hour || 0, minute);
    const check = new Date(t);
    if (Number.isFinite(t) && check.getUTCMonth() === mo && check.getUTCDate() === d) {
      return { t, label, hour, fmt, dated: true };
    }
    return { t: null, label, hour, fmt: 'invalid date' };
  }
  if ((m = rest.match(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/))) {
    return { t: WEEKDAYS[m[1]] * DAY_MS + timeMs, label, hour, fmt: 'weekday name' };
  }
  if ((m = rest.match(/\b(day|week)\s*[-#]?\s*(\d{1,3})\b/))) {
    return { t: +m[2] * (m[1] === 'week' ? 7 : 1) * DAY_MS + timeMs, label, hour, fmt: `${m[1]} number` };
  }
  if (hour != null) return { t: timeMs, label, hour, fmt: 'time only' };
  return { t: null, label, hour: null, fmt: 'free text' };
}

/** Parse one cell into a number in the pollutant's standard unit, flagging anything odd. */
function parseValue(raw, pollutant, unitHint) {
  const res = { value: null, raw: String(raw == null ? '' : raw), flags: [] };
  const s = res.raw.trim();
  if (MISSING_TOKENS.has(s.toLowerCase())) {
    res.flags.push('missing');
    return res;
  }
  const spec = POLLUTANTS[pollutant];
  if (!spec) {
    res.flags.push('unknown_pollutant');
    return res;
  }
  const unitRe = /(µg|μg|ug|mcg|mg)\s*\/?\s*(n?m)\s*\^?\s*[3³]?|ppb|ppm/gi;
  const numSource = s.replace(unitRe, ' ').replace(/(\d),(?=\d{3}(\D|$))/g, '$1');
  const m = numSource.match(/-?\d+(?:[.,]\d+)?|-?\.\d+/);
  const leftover = numSource.replace(m ? m[0] : '', ' ').replace(/[*?!()~<>≤≥=\s.,;:]/g, '');
  if (!m || /[a-z]{3,}/i.test(leftover.replace(/\b(est|approx|avg)\b/gi, ''))) {
    res.flags.push('unreadable');
    return res;
  }
  let v = parseFloat(m[0].replace(',', '.'));
  if (/^[<>≤≥]/.test(s)) res.flags.push('censored');
  if (/[*?!~]|est|approx/i.test(s.replace(unitRe, ''))) res.flags.push('marked');

  if (SENTINELS.has(v)) {
    res.flags.push('sentinel');
    return res;
  }
  if (v < 0) {
    res.flags.push('negative');
    return res;
  }
  const cellUnit = detectUnit(s);
  const unit = cellUnit || unitHint || null;
  const before = v;
  if (pollutant === 'co') {
    if (unit === 'ug') v /= 1000;
    else if (unit === 'ppm') v *= spec.ppm;
    else if (unit === 'ppb') v = (v / 1000) * spec.ppm;
  } else if (pollutant !== 'aqi') {
    if (unit === 'mg') v *= 1000;
    else if (unit === 'ppb' && spec.ppb) v *= spec.ppb;
    else if (unit === 'ppm' && spec.ppb) v = v * 1000 * spec.ppb;
    else if ((unit === 'ppb' || unit === 'ppm') && !spec.ppb) res.flags.push('unit_suspect');
  }
  if (v !== before) {
    // A unit written in the cell is an exception worth flagging on that reading;
    // a unit in the column header applies to the whole column and is noted once.
    if (cellUnit) {
      res.flags.push('converted');
      res.note = `${before} ${unit === 'ug' ? 'µg/m³' : unit === 'mg' ? 'mg/m³' : unit} → ${round(v)} ${spec.unit}`;
    } else res.columnConversion = `${spec.label} was converted from ${unit === 'ug' ? 'µg/m³' : unit === 'mg' ? 'mg/m³' : unit} to ${spec.unit}.`;
  }
  v = round(v);
  if (v > spec.max) {
    res.flags.push('implausible');
    res.value = v;
    return res;
  }
  if (v === 0 && spec.zeroSuspect) {
    res.flags.push('zero');
    return res;
  }
  res.value = v;
  return res;
}

function round(v, dp = 1) {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function isReliable(flags) {
  return !flags.some((f) => FLAGS[f] && FLAGS[f].exclude);
}

function locationKey(name) {
  return name.toLowerCase().replace(/[^a-z0-9ऀ-෿]+/g, '');
}

function fail(error, extra = {}) {
  return { ok: false, error, ...extra };
}

/**
 * @param {string} input raw pasted or uploaded text
 * @param {{defaultYear?: number}} [opts]
 */
function parseTable(input, opts = {}) {
  const notes = [];
  const ignored = [];
  const defaultYear = opts.defaultYear || new Date().getUTCFullYear();
  if (typeof input !== 'string' || !input.trim()) return fail('No data found. Paste a table or upload a file first.');

  let text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const fromJson = jsonToTable(text);
  if (fromJson) {
    text = fromJson;
    notes.push('Input was JSON: row IDs follow item order (R2 is the first record).');
  }

  const lines = [];
  text.split('\n').forEach((raw, i) => {
    if (!raw.trim() || /^[\s|:\-+=_]+$/.test(raw)) return;
    lines.push({ n: i + 1, text: raw });
  });
  if (lines.length < 2) return fail('Need a header row and at least one row of readings.');

  const delimiter = detectDelimiter(lines.slice(0, 60).map((l) => l.text));
  let table = lines.map((l) => ({ n: l.n, cells: splitLine(l.text, delimiter) }));

  const widths = new Map();
  table.forEach((r) => widths.set(r.cells.length, (widths.get(r.cells.length) || 0) + 1));
  const width = [...widths.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  if (width < 2) return fail('Could not find separate columns in this text.');

  table = table.filter((r) => {
    const filled = r.cells.filter((c) => c !== '').length;
    if (r.cells.length < 2 || (r.cells.length < width - 1 && filled < 2) || filled === 0) {
      ignored.push({ line: r.n, reason: 'Not a table row (title, note or blank)' });
      return false;
    }
    return true;
  });
  if (table.length < 2) return fail('Need a header row and at least one row of readings.');

  // ---- Header -------------------------------------------------------------
  let headerIdx = -1;
  for (let i = 0; i < Math.min(table.length, 6) && headerIdx < 0; i++) {
    const cells = table[i].cells;
    // Header cells are short labels; long cells mean this is prose, not a header.
    if (cells.length < Math.max(2, width - 1) || cells.some((c) => c.length > 40)) continue;
    const roles = cells.map(classifyHeader);
    const hasValue = roles.some((r) => r.role === 'value' || r.role === 'longValue');
    const numeric = cells.filter(isNumericLike).length;
    if (hasValue && numeric <= cells.length * 0.34) headerIdx = i;
  }

  let columns;
  let dataRows;
  if (headerIdx >= 0) {
    table.slice(0, headerIdx).forEach((r) => ignored.push({ line: r.n, reason: 'Text above the header row' }));
    columns = table[headerIdx].cells.map((header, index) => ({ index, header, ...classifyHeader(header) }));
    dataRows = table.slice(headerIdx + 1);
  } else {
    const inferred = inferColumns(table, width, defaultYear);
    if (!inferred) {
      return fail('Could not recognise any pollutant columns (PM2.5, PM10, NO2, SO2, O3, CO or AQI). Add a header row naming them.', { needsAI: true });
    }
    columns = inferred.columns;
    dataRows = table;
    notes.push(inferred.note);
  }

  const seen = new Set();
  columns.forEach((c) => {
    if (c.role !== 'value') return;
    if (seen.has(c.pollutant)) {
      c.role = 'ignore';
      notes.push(`Column "${c.header}" repeats ${POLLUTANTS[c.pollutant].label} and was not used.`);
    }
    seen.add(c.pollutant);
  });

  const col = (role) => columns.find((c) => c.role === role);
  const valueCols = columns.filter((c) => c.role === 'value');
  const longValue = col('longValue');
  const pollutantName = col('pollutantName');
  const unitCol = col('unit');
  const longFormat = valueCols.length === 0 && Boolean(longValue);
  if (!valueCols.length && !longFormat) {
    return fail('Could not recognise any pollutant columns (PM2.5, PM10, NO2, SO2, O3, CO or AQI).', { needsAI: true });
  }
  if (longFormat && !pollutantName) {
    notes.push(`Column "${longValue.header}" does not name a pollutant, so it was treated as an AQI value. Rename the column if that is wrong.`);
  }
  const unknownCols = columns.filter((c) => c.role === 'unknown').map((c) => c.header);
  if (unknownCols.length) notes.push(`Columns not used: ${unknownCols.join(', ')}.`);

  // Prefer the location-like column that distinguishes the most places.
  const locationCols = columns.filter((c) => c.role === 'location');
  let locationCol = locationCols[0];
  if (locationCols.length > 1) {
    const distinct = (c) => new Set(dataRows.map((r) => (r.cells[c.index] || '').toLowerCase())).size;
    locationCol = locationCols.slice().sort((a, b) => distinct(b) - distinct(a))[0];
  }
  if (!locationCol) notes.push('No location column found, so all readings are treated as one place.');
  const dateCol = col('datetime') || col('date');
  const timeCol = col('time');
  const sourceLineCol = col('sourceline');
  const remarkCol = col('remark');
  if (!dateCol && !timeCol) notes.push('No date or time column found, so trends follow row order.');

  if (dataRows.length > MAX_ROWS) {
    notes.push(`Only the first ${MAX_ROWS} rows were analysed (${dataRows.length} supplied).`);
    dataRows = dataRows.slice(0, MAX_ROWS);
  }

  // ---- Rows ---------------------------------------------------------------
  const rows = [];
  const readings = [];
  const locations = new Map();
  const formats = new Set();
  let lastLocation = null;
  let lastDate = '';
  let filledDown = 0;
  const idUses = new Map();

  for (const r of dataRows) {
    const cell = (c) => (c ? r.cells[c.index] || '' : '');
    let id = `R${r.n}`;
    if (sourceLineCol && /^\d+$/.test(cell(sourceLineCol))) id = `R${cell(sourceLineCol)}`;
    // Several readings can come from one source line; keep IDs unique (R7, R7.2, ...).
    const uses = (idUses.get(id) || 0) + 1;
    idUses.set(id, uses);
    if (uses > 1) id = `${id}.${uses}`;
    const rowFlags = [];

    let locRaw = locationCol ? cell(locationCol) : 'All readings';
    if (/^(average|avg|mean|total|max(imum)?|min(imum)?|overall|summary)\b/i.test(locRaw)) {
      ignored.push({ line: r.n, reason: 'Summary row (average / total), not a reading' });
      continue;
    }
    if (!locRaw) {
      if (lastLocation) {
        locRaw = lastLocation;
        rowFlags.push('location_filled');
        filledDown++;
      } else locRaw = 'Unknown location';
    }
    lastLocation = locRaw;
    const locKey = locationKey(locRaw) || 'unknown';
    if (!locations.has(locKey)) locations.set(locKey, { key: locKey, name: locRaw, variants: new Set() });
    locations.get(locKey).variants.add(locRaw);

    let dateStr = cell(dateCol);
    const timeStr = timeCol && timeCol !== dateCol ? cell(timeCol) : '';
    if (dateCol && timeCol && !dateStr && lastDate) dateStr = lastDate;
    if (dateStr) lastDate = dateStr;
    const time = parseTime(dateStr, timeStr, defaultYear);
    if (time.fmt) formats.add(time.fmt);

    const row = {
      id,
      line: r.n,
      location: locations.get(locKey).name,
      locKey,
      timeLabel: time.label,
      t: time.t,
      hour: time.hour,
      dated: Boolean(time.dated),
      remark: cell(remarkCol),
      cells: {},
      flags: rowFlags,
    };

    const addReading = (pollutant, rawCell, unitHint) => {
      const parsed = parseValue(rawCell, pollutant, unitHint);
      if (parsed.columnConversion && !notes.includes(parsed.columnConversion)) notes.push(parsed.columnConversion);
      const reading = {
        row: id, locKey, pollutant, value: parsed.value, raw: parsed.raw, t: time.t, hour: time.hour,
        dated: row.dated, flags: parsed.flags, note: parsed.note || '', ok: isReliable(parsed.flags),
      };
      readings.push(reading);
      row.cells[pollutant] = reading;
    };

    if (longFormat) {
      const pollutant = pollutantName ? detectPollutant(cell(pollutantName)) : 'aqi';
      const unitHint = detectUnit(cell(unitCol)) || longValue.unit;
      if (pollutant) addReading(pollutant, cell(longValue), unitHint);
      else rowFlags.push('unknown_pollutant');
    } else {
      valueCols.forEach((c) => addReading(c.pollutant, cell(c), c.unit));
    }
    rows.push(row);
  }
  if (!rows.length) return fail('No data rows found under the header.');

  if (filledDown) notes.push(`${filledDown} row(s) had a blank location and were given the location from the row above.`);
  const realFormats = [...formats].filter((f) => f !== 'invalid date' && f !== 'free text');
  if (realFormats.length > 1) {
    notes.push(`Dates were written in ${realFormats.length} different styles (${realFormats.join(', ')}) and were normalised. Ambiguous dates such as 03/04 are read as day/month.`);
  }
  if (formats.has('invalid date') || formats.has('free text')) {
    notes.push('Some dates could not be read; those rows keep their position in the table for trend purposes.');
  }
  const merged = [...locations.values()].filter((l) => l.variants.size > 1);
  merged.forEach((l) => notes.push(`Spellings merged into "${l.name}": ${[...l.variants].join(' / ')}.`));

  postProcess(readings);

  const pollutants = Object.keys(POLLUTANTS).filter((p) => readings.some((r) => r.pollutant === p));
  return {
    ok: true,
    format: longFormat ? 'long' : 'wide',
    delimiter: { '\t': 'tab', '|': 'pipe', ';': 'semicolon', ',': 'comma', space: 'aligned spaces' }[delimiter],
    columns: columns.map((c) => ({
      header: c.header,
      meaning: describeColumn(c),
    })),
    pollutants,
    rows,
    readings,
    locations: [...locations.values()].map((l) => ({ key: l.key, name: l.name })),
    notes,
    ignored,
  };
}

function describeColumn(c) {
  switch (c.role) {
    case 'value': return `${POLLUTANTS[c.pollutant].label}${c.unit ? ` (source unit: ${c.unit === 'ug' ? 'µg/m³' : c.unit === 'mg' ? 'mg/m³' : c.unit})` : ''}`;
    case 'longValue': return 'Reading value';
    case 'pollutantName': return 'Pollutant name';
    case 'unit': return 'Unit';
    case 'location': return 'Location';
    case 'datetime': return 'Date and time';
    case 'date': return 'Date';
    case 'time': return 'Time';
    case 'remark': return 'Remarks';
    case 'sourceline': return 'Original line number';
    case 'ignore': return 'Not used';
    default: return 'Not recognised';
  }
}

/** No header row: guess roles from the cell contents and say so. */
function inferColumns(table, width, defaultYear) {
  const sample = table.slice(0, 25);
  const stats = [];
  for (let i = 0; i < width; i++) {
    const cells = sample.map((r) => r.cells[i] || '').filter((c) => c !== '');
    const dates = cells.filter((c) => /[-/:]|[a-z]{3}/i.test(c) && parseTime(c, '', defaultYear).t != null).length;
    const numeric = cells.filter((c) => /^-?\d+([.,]\d+)?$/.test(c)).length;
    stats.push({ i, n: cells.length || 1, dates, numeric });
  }
  const columns = stats.map((s) => ({ index: s.i, header: `Column ${s.i + 1}`, role: 'unknown' }));
  const dateCol = stats.find((s) => s.dates / s.n > 0.6);
  if (dateCol) columns[dateCol.i].role = 'datetime';
  const locCol = stats.find((s) => s !== dateCol && s.numeric / s.n < 0.3);
  if (locCol) columns[locCol.i].role = 'location';
  const numericCols = stats.filter((s) => s !== dateCol && s !== locCol && s.numeric / s.n > 0.6);
  if (!numericCols.length) return null;
  const guess = ['pm25', 'pm10'];
  numericCols.slice(0, 2).forEach((s, k) => {
    columns[s.i].role = 'value';
    columns[s.i].pollutant = guess[k];
  });
  const described = numericCols.slice(0, 2).map((s, k) => `column ${s.i + 1} as ${POLLUTANTS[guess[k]].label}`).join(' and ');
  return {
    columns,
    note: `No header row was found. Assumed ${described}. Add a header row so this does not have to be guessed.`,
  };
}

/** Checks that need the whole series: unit mismatches, duplicates, stuck sensors, spikes. */
function postProcess(readings) {
  const byPollutant = groupBy(readings, (r) => r.pollutant);
  for (const [pollutant, list] of byPollutant) {
    if (pollutant === 'co' || pollutant === 'aqi') continue;
    const med = median(list.filter((r) => r.ok).map((r) => r.value));
    if (med != null && med >= 20) {
      list.forEach((r) => {
        if (r.ok && r.value < 2 && !r.flags.includes('converted')) flag(r, 'unit_suspect');
      });
    }
  }
  const series = groupBy(readings, (r) => `${r.locKey}|${r.pollutant}`);
  for (const list of series.values()) {
    const seenTimes = new Set();
    list.forEach((r) => {
      if (r.t == null) return;
      if (seenTimes.has(r.t) && r.dated) flag(r, 'duplicate');
      seenTimes.add(r.t);
    });
    const ordered = orderSeries(list.filter((r) => r.ok));
    let runStart = 0;
    for (let i = 1; i <= ordered.length; i++) {
      if (i < ordered.length && ordered[i].value === ordered[runStart].value) continue;
      if (i - runStart >= 4) ordered.slice(runStart, i).forEach((r) => flag(r, 'stuck'));
      runStart = i;
    }
    const good = list.filter((r) => r.ok);
    if (good.length >= 5) {
      const med = median(good.map((r) => r.value));
      good.forEach((r) => {
        if (r.value > med * 3 && r.value - med > 50) flag(r, 'spike');
      });
    }
  }
}

function flag(reading, name) {
  if (!reading.flags.includes(name)) reading.flags.push(name);
  reading.ok = isReliable(reading.flags);
}

function groupBy(list, keyFn) {
  const map = new Map();
  list.forEach((item) => {
    const k = keyFn(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  });
  return map;
}

/** Chronological when every reading has a time; otherwise source-row order. */
function orderSeries(list) {
  if (list.length && list.every((r) => r.t != null)) return [...list].sort((a, b) => a.t - b.t);
  return list;
}

module.exports = {
  parseTable, parseValue, parseTime, detectPollutant, detectDelimiter, classifyHeader,
  orderSeries, groupBy, median, round, POLLUTANTS, FLAGS, MAX_ROWS,
};
