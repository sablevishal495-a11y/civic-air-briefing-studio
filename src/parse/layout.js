'use strict';

/**
 * Working out the physical layout of pasted text: delimiter, cells, JSON
 * input, and column roles when there is no header row.
 */

const { POLLUTANTS } = require('./constants');
const { parseTime } = require('./time');
const { clean } = require('./util');

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

module.exports = { countDelimiter, detectDelimiter, splitLine, jsonToTable, inferColumns };
