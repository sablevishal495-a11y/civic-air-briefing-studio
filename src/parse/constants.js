'use strict';

/**
 * Shared constants for the parser: pollutants, flag catalogue and the tokens
 * that mean "no reading" or "sensor fault".
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

module.exports = { MAX_ROWS, POLLUTANTS, FLAGS, MISSING_TOKENS, SENTINELS, MONTHS, WEEKDAYS, DAY_MS };
