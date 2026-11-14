'use strict';

/**
 * Recognising what a header or label means: pollutant, unit, column role.
 */

const { POLLUTANTS } = require('./constants');

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

module.exports = { detectPollutant, detectUnit, classifyHeader, describeColumn };
