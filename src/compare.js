'use strict';

/**
 * Compares the current brief's snapshot with the previous one, so each new
 * brief can say what changed. Pure arithmetic: no model involved.
 */

const CHANGE_THRESHOLD_PCT = 10;

const str = (v, max = 120) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Snapshots come back from the browser, so validate before trusting them. */
function sanitizeSnapshot(s) {
  if (!s || typeof s !== 'object' || num(s.overallMean) == null || !Array.isArray(s.locations)) return null;
  return {
    v: 1,
    createdAt: str(s.createdAt, 40),
    place: str(s.place),
    primary: str(s.primary, 10),
    primaryLabel: str(s.primaryLabel, 20),
    unit: str(s.unit, 12),
    period: str(s.period, 60),
    overallMean: num(s.overallMean),
    overallCategory: str(s.overallCategory, 20),
    overallRank: num(s.overallRank) ?? 0,
    coveragePct: num(s.coveragePct) ?? 0,
    excluded: num(s.excluded) ?? 0,
    locations: s.locations.slice(0, 200).filter((l) => l && num(l.mean) != null).map((l) => ({
      key: str(l.key, 80),
      name: str(l.name, 80),
      mean: num(l.mean),
      category: str(l.category, 20),
      rank: num(l.rank) ?? 0,
      hotspot: Boolean(l.hotspot),
      reliability: l.reliability === 'low' ? 'low' : 'ok',
    })),
  };
}

function change(prev, curr) {
  const delta = Math.round((curr - prev) * 10) / 10;
  const deltaPct = prev ? Math.round((delta / prev) * 100) : 0;
  const direction = deltaPct >= CHANGE_THRESHOLD_PCT ? 'worse' : deltaPct <= -CHANGE_THRESHOLD_PCT ? 'better' : 'same';
  return { prev, curr, delta, deltaPct, direction };
}

function compareSnapshots(previous, current) {
  const prev = sanitizeSnapshot(previous);
  if (!prev) return { available: false };
  const base = {
    available: true,
    previous: { createdAt: prev.createdAt, period: prev.period, place: prev.place, overallMean: prev.overallMean, overallCategory: prev.overallCategory },
  };
  if (prev.primary !== current.primary) {
    return {
      ...base,
      comparable: false,
      summary: [{ text: `The previous brief measured ${prev.primaryLabel || 'a different pollutant'} and this one measures ${current.primaryLabel}, so the numbers cannot be compared directly.`, direction: 'same' }],
    };
  }
  const prevByKey = new Map(prev.locations.map((l) => [l.key, l]));
  const currKeys = new Set(current.locations.map((l) => l.key));
  const locations = current.locations.filter((l) => prevByKey.has(l.key)).map((l) => {
    const p = prevByKey.get(l.key);
    return { name: l.name, ...change(p.mean, l.mean), prevCategory: p.category, currCategory: l.category, lowConfidence: l.reliability === 'low' || p.reliability === 'low' };
  }).sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));

  const overall = { ...change(prev.overallMean, current.overallMean), prevCategory: prev.overallCategory, currCategory: current.overallCategory };
  const newHotspots = current.locations.filter((l) => l.hotspot && !(prevByKey.get(l.key) || {}).hotspot).map((l) => l.name);
  const resolvedHotspots = prev.locations.filter((l) => l.hotspot && currKeys.has(l.key) && !current.locations.find((c) => c.key === l.key).hotspot).map((l) => l.name);
  const addedLocations = current.locations.filter((l) => !prevByKey.has(l.key)).map((l) => l.name);
  const droppedLocations = prev.locations.filter((l) => !currKeys.has(l.key)).map((l) => l.name);

  const unit = current.unit ? ` ${current.unit}` : '';
  const word = { worse: 'worse', better: 'better', same: 'about the same' };
  const summary = [];
  const say = (text, direction) => summary.push({ text, direction });
  say(
    overall.direction === 'same'
      ? `Overall ${current.primaryLabel} is about the same as last time (${overall.prev} → ${overall.curr}${unit}).`
      : `Overall ${current.primaryLabel} is ${word[overall.direction]} than last time: ${overall.prev} → ${overall.curr}${unit} (${overall.deltaPct > 0 ? '+' : ''}${overall.deltaPct}%).`,
    overall.direction,
  );
  if (overall.prevCategory !== overall.currCategory) {
    say(`The overall category moved from ${overall.prevCategory} to ${overall.currCategory}.`, current.overallRank > prev.overallRank ? 'worse' : 'better');
  }
  locations.filter((l) => l.direction !== 'same').slice(0, 4).forEach((l) => {
    say(`${l.name} is ${word[l.direction]}: ${l.prev} → ${l.curr}${unit} (${l.deltaPct > 0 ? '+' : ''}${l.deltaPct}%)${l.prevCategory !== l.currCategory ? `, now ${l.currCategory}` : ''}.`, l.direction);
  });
  if (newHotspots.length) say(`New hotspot${newHotspots.length > 1 ? 's' : ''}: ${newHotspots.join(', ')}.`, 'new');
  if (resolvedHotspots.length) say(`No longer a hotspot: ${resolvedHotspots.join(', ')}.`, 'better');
  if (addedLocations.length) say(`Not in the previous brief: ${addedLocations.join(', ')}.`, 'new');
  if (droppedLocations.length) say(`In the previous brief but missing now: ${droppedLocations.join(', ')}.`, 'same');
  const coverage = change(prev.coveragePct, current.coveragePct);
  if (Math.abs(coverage.delta) >= 5) {
    say(`Usable data went from ${prev.coveragePct}% to ${current.coveragePct}% of readings.`, coverage.delta > 0 ? 'better' : 'worse');
  }

  return { ...base, comparable: true, overall, locations, newHotspots, resolvedHotspots, addedLocations, droppedLocations, coverage: { prev: prev.coveragePct, curr: current.coveragePct }, summary };
}

module.exports = { compareSnapshots, sanitizeSnapshot, CHANGE_THRESHOLD_PCT };
