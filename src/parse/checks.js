'use strict';

/**
 * Quality checks that need a whole series rather than one cell: unit
 * mismatches, duplicates, stuck sensors and spikes.
 */

const { median, isReliable, groupBy, orderSeries } = require('./util');

function flag(reading, name) {
  if (!reading.flags.includes(name)) reading.flags.push(name);
  reading.ok = isReliable(reading.flags);
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

module.exports = { flag, postProcess };
