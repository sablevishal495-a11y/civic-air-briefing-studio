'use strict';

/**
 * Parsing one cell into a number in the pollutant's standard unit.
 */

const { POLLUTANTS, MISSING_TOKENS, SENTINELS } = require('./constants');
const { detectUnit } = require('./detect');
const { round } = require('./util');

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

module.exports = { parseValue };
