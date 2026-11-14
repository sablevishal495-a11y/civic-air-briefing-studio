'use strict';

/**
 * Date and time parsing for the many ways field data writes them.
 */

const { MONTHS, WEEKDAYS, DAY_MS } = require('./constants');

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

module.exports = { parseTime };
