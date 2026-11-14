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

const { postProcess } = require('./checks');
const { MAX_ROWS, POLLUTANTS, FLAGS } = require('./constants');
const { detectPollutant, detectUnit, classifyHeader, describeColumn } = require('./detect');
const { detectDelimiter, splitLine, jsonToTable, inferColumns } = require('./layout');
const { parseTime } = require('./time');
const { isReliable, locationKey, isNumericLike, median, round, groupBy, orderSeries } = require('./util');
const { parseValue } = require('./value');

const SEPARATOR_LINE = /^[\s|:\-+=_]+$/;
const SUMMARY_ROW = /^(average|avg|mean|total|max(imum)?|min(imum)?|overall|summary)\b/i;
const DELIMITER_NAMES = { '\t': 'tab', '|': 'pipe', ';': 'semicolon', ',': 'comma', space: 'aligned spaces' };
const NO_POLLUTANT_COLUMNS = 'Could not recognise any pollutant columns (PM2.5, PM10, NO2, SO2, O3, CO or AQI).';

/** A problem with the input that the user can fix; turned into `{ ok: false }` by parseTable. */
class ParseFailure extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.extra = extra;
  }
}

/**
 * Stage 1: text → table. Detects the delimiter and drops lines that are not table rows.
 * @returns {{table: Array<{n: number, cells: string[]}>, width: number, delimiter: string}}
 */
function readTable(input, ctx) {
  let text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const fromJson = jsonToTable(text);
  if (fromJson) {
    text = fromJson;
    ctx.notes.add('Input was JSON: row IDs follow item order (R2 is the first record).');
  }
  const lines = [];
  text.split('\n').forEach((raw, i) => {
    if (raw.trim() && !SEPARATOR_LINE.test(raw)) lines.push({ n: i + 1, text: raw });
  });
  if (lines.length < 2) throw new ParseFailure('Need a header row and at least one row of readings.');

  const delimiter = detectDelimiter(lines.slice(0, 60).map((l) => l.text));
  const all = lines.map((l) => ({ n: l.n, cells: splitLine(l.text, delimiter) }));
  const widths = new Map();
  all.forEach((r) => widths.set(r.cells.length, (widths.get(r.cells.length) || 0) + 1));
  const width = [...widths.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  if (width < 2) throw new ParseFailure('Could not find separate columns in this text.');

  const table = all.filter((r) => {
    const filled = r.cells.filter((c) => c !== '').length;
    const isRow = r.cells.length >= 2 && filled > 0 && !(r.cells.length < width - 1 && filled < 2);
    if (!isRow) ctx.ignored.push({ line: r.n, reason: 'Not a table row (title, note or blank)' });
    return isRow;
  });
  if (table.length < 2) throw new ParseFailure('Need a header row and at least one row of readings.');
  return { table, width, delimiter };
}

/** Index of the header row within the first few rows, or -1 when there is none. */
function findHeaderRow(table, width) {
  return table.slice(0, 6).findIndex(({ cells }) => {
    // Header cells are short labels; long cells mean this is prose, not a header.
    if (cells.length < Math.max(2, width - 1) || cells.some((c) => c.length > 40)) return false;
    const hasValue = cells.map(classifyHeader).some((r) => r.role === 'value' || r.role === 'longValue');
    return hasValue && cells.filter(isNumericLike).length <= cells.length * 0.34;
  });
}

/**
 * Stage 2: decide what each column means, from the header row or (failing that) the cell contents.
 * @returns {{columns: object[], dataRows: object[]}}
 */
function locateColumns(table, width, ctx) {
  const headerIdx = findHeaderRow(table, width);
  let columns;
  let dataRows;
  if (headerIdx >= 0) {
    table.slice(0, headerIdx).forEach((r) => ctx.ignored.push({ line: r.n, reason: 'Text above the header row' }));
    columns = table[headerIdx].cells.map((header, index) => ({ index, header, ...classifyHeader(header) }));
    dataRows = table.slice(headerIdx + 1);
  } else {
    const inferred = inferColumns(table, width, ctx.defaultYear);
    if (!inferred) throw new ParseFailure(`${NO_POLLUTANT_COLUMNS} Add a header row naming them.`, { needsAI: true });
    ({ columns } = inferred);
    dataRows = table;
    ctx.notes.add(inferred.note);
  }
  const seen = new Set();
  columns.filter((c) => c.role === 'value').forEach((c) => {
    if (seen.has(c.pollutant)) {
      c.role = 'ignore';
      ctx.notes.add(`Column "${c.header}" repeats ${POLLUTANTS[c.pollutant].label} and was not used.`);
    }
    seen.add(c.pollutant);
  });
  if (dataRows.length > MAX_ROWS) {
    ctx.notes.add(`Only the first ${MAX_ROWS} rows were analysed (${dataRows.length} supplied).`);
    dataRows = dataRows.slice(0, MAX_ROWS);
  }
  return { columns, dataRows };
}

/**
 * Stage 3: pick the columns to read from (the "plan") and note anything assumed.
 */
function planColumns(columns, dataRows, ctx) {
  const col = (role) => columns.find((c) => c.role === role);
  const valueCols = columns.filter((c) => c.role === 'value');
  const longValue = col('longValue');
  const longFormat = valueCols.length === 0 && Boolean(longValue);
  if (!valueCols.length && !longFormat) throw new ParseFailure(NO_POLLUTANT_COLUMNS, { needsAI: true });

  const pollutantName = col('pollutantName');
  if (longFormat && !pollutantName) {
    ctx.notes.add(`Column "${longValue.header}" does not name a pollutant, so it was treated as an AQI value. Rename the column if that is wrong.`);
  }
  const unknown = columns.filter((c) => c.role === 'unknown').map((c) => c.header);
  if (unknown.length) ctx.notes.add(`Columns not used: ${unknown.join(', ')}.`);

  // Prefer the location-like column that distinguishes the most places.
  const distinct = (c) => new Set(dataRows.map((r) => (r.cells[c.index] || '').toLowerCase())).size;
  const location = columns.filter((c) => c.role === 'location').sort((a, b) => distinct(b) - distinct(a))[0];
  if (!location) ctx.notes.add('No location column found, so all readings are treated as one place.');
  const date = col('datetime') || col('date');
  const time = col('time');
  if (!date && !time) ctx.notes.add('No date or time column found, so trends follow row order.');

  return { valueCols, longValue, longFormat, pollutantName, unit: col('unit'), location, date, time, sourceLine: col('sourceline'), remark: col('remark') };
}

/** Row ID from the source line number, kept unique when one line yields several rows (R7, R7.2, ...). */
function nextRowId(base, idUses) {
  const uses = (idUses.get(base) || 0) + 1;
  idUses.set(base, uses);
  return uses > 1 ? `${base}.${uses}` : base;
}

/**
 * Stage 4: rows → normalised readings. Blank locations and dates are filled down
 * (as in merged spreadsheet cells) and flagged; summary rows are skipped.
 */
function buildRows(dataRows, plan, ctx) {
  const rows = [];
  const readings = [];
  const locations = new Map();
  const formats = new Set();
  const idUses = new Map();
  let lastLocation = null;
  let lastDate = '';
  let filledDown = 0;

  for (const source of dataRows) {
    const cell = (c) => (c ? source.cells[c.index] || '' : '');
    let locRaw = plan.location ? cell(plan.location) : 'All readings';
    if (SUMMARY_ROW.test(locRaw)) {
      ctx.ignored.push({ line: source.n, reason: 'Summary row (average / total), not a reading' });
      continue;
    }
    const lineRef = /^\d+$/.test(cell(plan.sourceLine)) ? cell(plan.sourceLine) : source.n;
    const id = nextRowId(`R${lineRef}`, idUses);
    const flags = [];
    if (!locRaw && lastLocation) {
      locRaw = lastLocation;
      flags.push('location_filled');
      filledDown += 1;
    }
    locRaw = locRaw || 'Unknown location';
    lastLocation = locRaw;
    const locKey = locationKey(locRaw) || 'unknown';
    if (!locations.has(locKey)) locations.set(locKey, { key: locKey, name: locRaw, variants: new Set() });
    locations.get(locKey).variants.add(locRaw);

    let dateStr = cell(plan.date);
    if (plan.date && plan.time && !dateStr) dateStr = lastDate;
    if (dateStr) lastDate = dateStr;
    const time = parseTime(dateStr, plan.time && plan.time !== plan.date ? cell(plan.time) : '', ctx.defaultYear);
    if (time.fmt) formats.add(time.fmt);

    const row = {
      id, line: source.n, location: locations.get(locKey).name, locKey, timeLabel: time.label,
      t: time.t, hour: time.hour, dated: Boolean(time.dated), remark: cell(plan.remark), cells: {}, flags,
    };
    const addReading = (pollutant, rawCell, unitHint) => {
      const parsed = parseValue(rawCell, pollutant, unitHint);
      if (parsed.columnConversion) ctx.notes.add(parsed.columnConversion);
      const reading = {
        row: id, locKey, pollutant, value: parsed.value, raw: parsed.raw, t: time.t, hour: time.hour,
        dated: row.dated, flags: parsed.flags, note: parsed.note || '', ok: isReliable(parsed.flags),
      };
      readings.push(reading);
      row.cells[pollutant] = reading;
    };
    if (plan.longFormat) {
      const pollutant = plan.pollutantName ? detectPollutant(cell(plan.pollutantName)) : 'aqi';
      if (pollutant) addReading(pollutant, cell(plan.longValue), detectUnit(cell(plan.unit)) || plan.longValue.unit);
      else flags.push('unknown_pollutant');
    } else {
      plan.valueCols.forEach((c) => addReading(c.pollutant, cell(c), c.unit));
    }
    rows.push(row);
  }
  if (!rows.length) throw new ParseFailure('No data rows found under the header.');
  return { rows, readings, locations: [...locations.values()], formats, filledDown };
}

/** Tell the user about every normalisation that was applied while reading rows. */
function noteNormalisations({ locations, formats, filledDown }, ctx) {
  if (filledDown) ctx.notes.add(`${filledDown} row(s) had a blank location and were given the location from the row above.`);
  const readable = [...formats].filter((f) => f !== 'invalid date' && f !== 'free text');
  if (readable.length > 1) {
    ctx.notes.add(`Dates were written in ${readable.length} different styles (${readable.join(', ')}) and were normalised. Ambiguous dates such as 03/04 are read as day/month.`);
  }
  if (formats.has('invalid date') || formats.has('free text')) {
    ctx.notes.add('Some dates could not be read; those rows keep their position in the table for trend purposes.');
  }
  locations.filter((l) => l.variants.size > 1).forEach((l) => {
    ctx.notes.add(`Spellings merged into "${l.name}": ${[...l.variants].join(' / ')}.`);
  });
}

/**
 * Parse pasted or uploaded text into flagged, traceable readings.
 *
 * @param {string} input raw pasted or uploaded text
 * @param {{defaultYear?: number}} [opts]
 * @returns {{ok: true, rows: object[], readings: object[], locations: object[], pollutants: string[], columns: object[], notes: string[], ignored: object[], format: string, delimiter: string} | {ok: false, error: string, needsAI?: boolean}}
 */
function parseTable(input, opts = {}) {
  if (typeof input !== 'string' || !input.trim()) {
    return { ok: false, error: 'No data found. Paste a table or upload a file first.' };
  }
  // `notes` is a Set so a note raised by many rows is recorded once, in O(1).
  const ctx = { notes: new Set(), ignored: [], defaultYear: opts.defaultYear || new Date().getUTCFullYear() };
  try {
    const { table, width, delimiter } = readTable(input, ctx);
    const { columns, dataRows } = locateColumns(table, width, ctx);
    const plan = planColumns(columns, dataRows, ctx);
    const built = buildRows(dataRows, plan, ctx);
    noteNormalisations(built, ctx);
    postProcess(built.readings);

    const present = new Set(built.readings.map((r) => r.pollutant));
    return {
      ok: true,
      format: plan.longFormat ? 'long' : 'wide',
      delimiter: DELIMITER_NAMES[delimiter],
      columns: columns.map((c) => ({ header: c.header, meaning: describeColumn(c) })),
      pollutants: Object.keys(POLLUTANTS).filter((p) => present.has(p)),
      rows: built.rows,
      readings: built.readings,
      locations: built.locations.map((l) => ({ key: l.key, name: l.name })),
      notes: [...ctx.notes],
      ignored: ctx.ignored,
    };
  } catch (err) {
    if (err instanceof ParseFailure) return { ok: false, error: err.message, ...err.extra };
    throw err;
  }
}

module.exports = {
  parseTable, parseValue, parseTime, detectPollutant, detectDelimiter, classifyHeader,
  orderSeries, groupBy, median, round, POLLUTANTS, FLAGS, MAX_ROWS,
};
