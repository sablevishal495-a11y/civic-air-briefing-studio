'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTable } = require('../src/parse');
const { computeStats, makeSnapshot, categoryFor } = require('../src/analyze');
const { compareSnapshots, sanitizeSnapshot } = require('../src/compare');
const samples = require('../public/samples');

const statsFor = (raw) => computeStats(parseTable(raw));

test('CPCB band edges', () => {
  assert.equal(categoryFor('pm25', 30).label, 'Good');
  assert.equal(categoryFor('pm25', 30.1).label, 'Satisfactory');
  assert.equal(categoryFor('pm25', 90).label, 'Moderate');
  assert.equal(categoryFor('pm25', 121).label, 'Very Poor');
  assert.equal(categoryFor('pm25', 400).label, 'Severe');
  assert.equal(categoryFor('pm10', 100).label, 'Satisfactory');
  assert.equal(categoryFor('co', 1.5).label, 'Satisfactory');
  assert.equal(categoryFor('unknown', 5), null);
});

test('week 1 statistics exclude unreliable readings and rank hotspots', () => {
  const s = statsFor(samples.week1.raw);
  assert.equal(s.ok, true);
  assert.equal(s.primary, 'pm25');
  assert.deepEqual(s.totals, { rows: 30, locations: 5, readings: 90, usable: 81, missing: 2, excluded: 9, coveragePct: 90 });
  assert.equal(s.locations[0].name, 'Industrial Estate Road');
  assert.equal(s.locations[0].mean, 204, 'includes the converted mg/m3 reading');
  assert.deepEqual(s.hotspots, ['industrialestateroad', 'shivajinagarjunction']);
  const park = s.locations.find((l) => l.name === 'Riverside Park');
  assert.equal(park.mean, 42, 'stuck readings are left out of the mean');
  assert.equal(park.reliability, 'low');
  assert.equal(s.overall.maxRow, 'R14');
  assert.equal(s.period.label, '2 Nov 2026 to 3 Nov 2026');
});

test('time-of-day pattern and trends carry evidence rows', () => {
  const s = statsFor(samples.week1.raw);
  assert.equal(s.timeOfDay.peak, 'evening');
  assert.equal(s.timeOfDay.best, 'afternoon');
  assert.ok(s.timeOfDay.meaningful);
  const school = s.locations.find((l) => /School/.test(l.name));
  assert.equal(school.trend.direction, 'rising');
  assert.ok(school.trend.rows.length > 0);
  s.locations.forEach((l) => l.rows.forEach((id) => assert.match(id, /^R\d+$/)));
});

test('data quality summary lists each issue with its rows', () => {
  const s = statsFor(samples.week1.raw);
  const byType = Object.fromEntries(s.quality.map((q) => [q.type, q]));
  assert.deepEqual(byType.stuck.rows, ['R29', 'R30', 'R31', 'R32']);
  assert.deepEqual(byType.sentinel.rows, ['R14']);
  assert.deepEqual(byType.negative.rows, ['R25']);
  assert.equal(byType.missing.count, 2);
  assert.ok(byType.low_coverage.locations.includes('Riverside Park'));
});

test('fails clearly when nothing is usable', () => {
  const s = statsFor('Location,PM2.5\nA,N/A\nB,999');
  assert.equal(s.ok, false);
  assert.match(s.error, /No usable/);
});

test('comparison shows what changed between two briefs', () => {
  const prev = makeSnapshot(statsFor(samples.week1.raw), 'Ward 14');
  const curr = makeSnapshot(statsFor(samples.week2.raw), 'Ward 14');
  const c = compareSnapshots(prev, curr);
  assert.equal(c.available, true);
  assert.equal(c.comparable, true);
  assert.equal(c.overall.direction, 'same');
  assert.deepEqual(c.newHotspots, ['Govt Primary School No. 4']);
  const byName = Object.fromEntries(c.locations.map((l) => [l.name, l]));
  assert.equal(byName['Shivaji Nagar Junction'].direction, 'better');
  assert.equal(byName['Industrial Estate Road'].direction, 'worse');
  assert.equal(byName['Lakeview Housing Society Gate'].direction, 'same');
  assert.ok(c.summary.some((x) => x.direction === 'new' && /New hotspot/.test(x.text)));
});

test('comparison handles missing, malformed and incomparable snapshots', () => {
  const curr = makeSnapshot(statsFor(samples.week2.raw), '');
  assert.equal(compareSnapshots(null, curr).available, false);
  assert.equal(compareSnapshots({ overallMean: 'x' }, curr).available, false);
  assert.equal(sanitizeSnapshot({ overallMean: 5, locations: [{ name: '<b>x</b>'.repeat(50), mean: 1 }] }).locations[0].name.length, 80);
  const other = { ...curr, primary: 'aqi', primaryLabel: 'AQI' };
  assert.equal(compareSnapshots(other, curr).comparable, false);
});
