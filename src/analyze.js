'use strict';

/**
 * Deterministic statistics over parsed readings.
 *
 * Every number the briefing quotes is computed here, not by the language model,
 * and every statistic carries the row IDs it was computed from.
 */

const { POLLUTANTS, FLAGS, orderSeries, groupBy, median, round } = require('./parse');

/** India CPCB National AQI bands (upper bound of each category). */
const CATEGORIES = [
  { key: 'good', label: 'Good', rank: 0 },
  { key: 'satisfactory', label: 'Satisfactory', rank: 1 },
  { key: 'moderate', label: 'Moderate', rank: 2 },
  { key: 'poor', label: 'Poor', rank: 3 },
  { key: 'very_poor', label: 'Very Poor', rank: 4 },
  { key: 'severe', label: 'Severe', rank: 5 },
];
const BREAKPOINTS = {
  pm25: [30, 60, 90, 120, 250],
  pm10: [50, 100, 250, 350, 430],
  no2: [40, 80, 180, 280, 400],
  so2: [40, 80, 380, 800, 1600],
  o3: [50, 100, 168, 208, 748],
  co: [1, 2, 10, 17, 34],
  aqi: [50, 100, 200, 300, 400],
};
const PRIMARY_ORDER = ['pm25', 'pm10', 'aqi', 'no2', 'o3', 'so2', 'co'];
const BUCKETS = [
  { key: 'morning', label: 'Morning (5am–11am)', from: 5, to: 11 },
  { key: 'afternoon', label: 'Afternoon (11am–4pm)', from: 11, to: 16 },
  { key: 'evening', label: 'Evening (4pm–9pm)', from: 16, to: 21 },
  { key: 'night', label: 'Night (9pm–5am)', from: 21, to: 29 },
];
const EVIDENCE_CAP = 8;

function categoryFor(pollutant, value) {
  const breaks = BREAKPOINTS[pollutant];
  if (!breaks || value == null) return null;
  const idx = breaks.findIndex((b) => value <= b);
  return CATEGORIES[idx === -1 ? CATEGORIES.length - 1 : idx];
}

const mean = (nums) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null);
const uniq = (list) => [...new Set(list)];
const cap = (list, n = EVIDENCE_CAP) => uniq(list).slice(0, n);

/** Compare the first and second half of a series. Needs 4+ reliable readings. */
function trendOf(ordered) {
  if (ordered.length < 4) return { direction: 'unknown', pct: null, rows: [] };
  const half = Math.floor(ordered.length / 2);
  const early = ordered.slice(0, half);
  const late = ordered.slice(ordered.length - half);
  const a = mean(early.map((r) => r.value));
  const b = mean(late.map((r) => r.value));
  const pct = a ? round(((b - a) / a) * 100, 0) : 0;
  const direction = pct >= 10 ? 'rising' : pct <= -10 ? 'falling' : 'steady';
  return { direction, pct, from: round(a), to: round(b), rows: cap([...early.slice(0, 3), ...late.slice(-3)].map((r) => r.row), 6) };
}

function seriesStats(pollutant, list) {
  const good = orderSeries(list.filter((r) => r.ok));
  const values = good.map((r) => r.value);
  const stats = {
    pollutant,
    label: POLLUTANTS[pollutant].label,
    unit: POLLUTANTS[pollutant].unit,
    total: list.length,
    usable: good.length,
    missing: list.filter((r) => r.flags.includes('missing')).length,
    excluded: list.filter((r) => !r.ok && !r.flags.includes('missing')).length,
    coveragePct: list.length ? Math.round((good.length / list.length) * 100) : 0,
    mean: null, median: null, max: null, min: null, maxRow: null, latest: null, latestRow: null,
    category: null, trend: { direction: 'unknown', pct: null, rows: [] }, rows: [],
  };
  if (!good.length) return stats;
  const maxReading = good.reduce((m, r) => (r.value > m.value ? r : m), good[0]);
  const last = good[good.length - 1];
  Object.assign(stats, {
    mean: round(mean(values)),
    median: round(median(values)),
    max: maxReading.value,
    maxRow: maxReading.row,
    min: Math.min(...values),
    latest: last.value,
    latestRow: last.row,
    category: categoryFor(pollutant, mean(values)),
    trend: trendOf(good),
    rows: cap([maxReading.row, ...good.map((r) => r.row)]),
  });
  return stats;
}

function periodLabel(readings) {
  const times = readings.filter((r) => r.dated && r.t != null).map((r) => r.t);
  if (!times.length) return { start: null, end: null, label: 'Dates not given' };
  const fmt = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const start = Math.min(...times);
  const end = Math.max(...times);
  const a = fmt(start);
  const b = fmt(end);
  return { start, end, label: a === b ? a : `${a} to ${b}` };
}

function timeOfDay(readings) {
  const usable = readings.filter((r) => r.ok && r.hour != null);
  const buckets = BUCKETS.map((b) => {
    const inBucket = usable.filter((r) => {
      const h = r.hour < 5 ? r.hour + 24 : r.hour;
      return h >= b.from && h < b.to;
    });
    return {
      key: b.key,
      label: b.label,
      n: inBucket.length,
      mean: inBucket.length ? round(mean(inBucket.map((r) => r.value))) : null,
      rows: cap(inBucket.sort((x, y) => y.value - x.value).map((r) => r.row), 6),
    };
  }).filter((b) => b.n >= 2);
  if (buckets.length < 2) return null;
  const sorted = [...buckets].sort((a, b) => b.mean - a.mean);
  const peak = sorted[0];
  const best = sorted[sorted.length - 1];
  const spreadPct = best.mean ? Math.round(((peak.mean - best.mean) / best.mean) * 100) : 0;
  return { buckets, peak: peak.key, peakLabel: peak.label, best: best.key, bestLabel: best.label, spreadPct, meaningful: spreadPct >= 15 };
}

function qualitySummary(parsed, locations) {
  const issues = [];
  const names = new Map(parsed.locations.map((l) => [l.key, l.name]));
  const byFlag = new Map();
  parsed.readings.forEach((r) => r.flags.forEach((f) => {
    if (!byFlag.has(f)) byFlag.set(f, []);
    byFlag.get(f).push(r);
  }));
  for (const [flag, list] of byFlag) {
    const info = FLAGS[flag];
    if (!info || flag === 'location_filled') continue;
    issues.push({
      type: flag,
      label: info.label,
      explanation: info.text,
      excluded: info.exclude,
      count: list.length,
      rows: cap(list.map((r) => r.row), 12),
      locations: uniq(list.map((r) => names.get(r.locKey))).slice(0, 6),
      examples: uniq(list.map((r) => r.note || r.raw).filter(Boolean)).slice(0, 3),
    });
  }
  locations.filter((l) => l.reliability === 'low').forEach((l) => {
    issues.push({
      type: 'low_coverage',
      label: 'Low confidence location',
      explanation: l.reliabilityReason,
      excluded: false,
      count: 1,
      rows: l.flaggedRows,
      locations: [l.name],
      examples: [],
    });
  });
  return issues.sort((a, b) => Number(b.excluded) - Number(a.excluded) || b.count - a.count);
}

/**
 * @param {ReturnType<import('./parse').parseTable>} parsed
 */
function computeStats(parsed) {
  const usablePollutants = new Set(parsed.readings.filter((r) => r.ok).map((r) => r.pollutant));
  const primary = PRIMARY_ORDER.find((p) => usablePollutants.has(p)) || null;
  if (!primary) {
    return { ok: false, error: 'No usable numeric readings were found. Every value was missing or flagged as unreliable.' };
  }
  const byLocation = groupBy(parsed.readings, (r) => r.locKey);
  const locations = parsed.locations.map((loc) => {
    const list = byLocation.get(loc.key) || [];
    const perPollutant = {};
    for (const [p, series] of groupBy(list, (r) => r.pollutant)) perPollutant[p] = seriesStats(p, series);
    const main = perPollutant[primary] || null;
    const worst = Object.values(perPollutant)
      .filter((s) => s.category)
      .sort((a, b) => b.category.rank - a.category.rank)[0] || null;
    const total = list.length;
    const good = list.filter((r) => r.ok).length;
    const coveragePct = total ? Math.round((good / total) * 100) : 0;
    const mainUsable = main ? main.usable : 0;
    let reliability = 'ok';
    let reliabilityReason = '';
    if (mainUsable < 3) {
      reliability = 'low';
      reliabilityReason = `Only ${mainUsable} usable ${POLLUTANTS[primary].label} reading(s)`;
    } else if (coveragePct < 70) {
      reliability = 'low';
      reliabilityReason = `Only ${coveragePct}% of readings are usable (${total - good} of ${total} missing or flagged)`;
    }
    return {
      key: loc.key,
      name: loc.name,
      perPollutant,
      mean: main ? main.mean : null,
      max: main ? main.max : null,
      maxRow: main ? main.maxRow : null,
      category: main ? main.category : null,
      trend: main ? main.trend : { direction: 'unknown', pct: null, rows: [] },
      worstPollutant: worst ? { pollutant: worst.pollutant, label: worst.label, category: worst.category, mean: worst.mean } : null,
      coveragePct,
      reliability,
      reliabilityReason,
      rows: main ? main.rows : [],
      flaggedRows: cap(list.filter((r) => !r.ok).map((r) => r.row)),
    };
  });

  const ranked = locations.filter((l) => l.mean != null).sort((a, b) => b.mean - a.mean);
  // Group once; every per-pollutant statistic below reuses these lists.
  const byPollutant = groupBy(parsed.readings, (r) => r.pollutant);
  const primaryReadings = byPollutant.get(primary);
  const overall = seriesStats(primary, primaryReadings);
  ranked.forEach((l, i) => {
    l.rank = i + 1;
    l.isHotspot = l.category.rank >= 3 || (l.category.rank >= 2 && ranked.length > 1 && l.mean >= overall.mean * 1.25);
  });
  const hotspots = ranked.filter((l) => l.isHotspot).map((l) => l.key);
  const total = parsed.readings.length;
  let excluded = 0;
  let missing = 0;
  for (const r of parsed.readings) {
    if (!r.ok) excluded += 1;
    if (r.flags.includes('missing')) missing += 1;
  }

  const stats = {
    ok: true,
    standard: 'India CPCB National AQI bands, applied to the average of the supplied readings (indicative, not an official AQI).',
    primary,
    primaryLabel: POLLUTANTS[primary].label,
    unit: POLLUTANTS[primary].unit,
    breakpoints: BREAKPOINTS[primary],
    period: periodLabel(parsed.readings),
    totals: {
      rows: parsed.rows.length,
      locations: locations.length,
      readings: total,
      usable: total - excluded,
      missing,
      excluded,
      coveragePct: total ? Math.round(((total - excluded) / total) * 100) : 0,
    },
    overall: {
      mean: overall.mean, median: overall.median, max: overall.max, maxRow: overall.maxRow,
      category: overall.category, trend: overall.trend,
    },
    otherPollutants: parsed.pollutants.filter((p) => p !== primary).map((p) => {
      const s = seriesStats(p, byPollutant.get(p));
      return { pollutant: p, label: s.label, unit: s.unit, mean: s.mean, max: s.max, maxRow: s.maxRow, category: s.category, usable: s.usable };
    }),
    locations: [...ranked, ...locations.filter((l) => l.mean == null)],
    hotspots,
    timeOfDay: timeOfDay(primaryReadings),
  };
  stats.quality = qualitySummary(parsed, stats.locations);
  return stats;
}

/** Compact, storable summary of a brief, used to compare the next brief against it. */
function makeSnapshot(stats, place) {
  return {
    v: 1,
    createdAt: new Date().toISOString(),
    place: place || '',
    primary: stats.primary,
    primaryLabel: stats.primaryLabel,
    unit: stats.unit,
    period: stats.period.label,
    overallMean: stats.overall.mean,
    overallCategory: stats.overall.category.label,
    overallRank: stats.overall.category.rank,
    coveragePct: stats.totals.coveragePct,
    excluded: stats.totals.excluded,
    locations: stats.locations.filter((l) => l.mean != null).map((l) => ({
      key: l.key, name: l.name, mean: l.mean, category: l.category.label, rank: l.category.rank,
      hotspot: Boolean(l.isHotspot), reliability: l.reliability,
    })),
  };
}

module.exports = { computeStats, makeSnapshot, categoryFor, CATEGORIES, BREAKPOINTS, BUCKETS };
