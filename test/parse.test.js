'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTable, parseValue, parseTime, detectPollutant, classifyHeader } = require('../src/parse');
const samples = require('../public/samples');

const cell = (parsed, rowId, pollutant) => parsed.rows.find((r) => r.id === rowId).cells[pollutant];

test('recognises pollutant names written in different ways', () => {
  assert.equal(detectPollutant('PM2.5 (ug/m3)'), 'pm25');
  assert.equal(detectPollutant('pm2_5'), 'pm25');
  assert.equal(detectPollutant('PM 10'), 'pm10');
  assert.equal(detectPollutant('no2_ppb'), 'no2');
  assert.equal(detectPollutant('Ozone'), 'o3');
  assert.equal(detectPollutant('CO2'), null);
  assert.equal(detectPollutant('Station'), null);
});

test('classifies header cells by meaning', () => {
  assert.equal(classifyHeader('Station name').role, 'location');
  assert.equal(classifyHeader('Timestamp').role, 'datetime');
  assert.equal(classifyHeader('Time').role, 'time');
  assert.equal(classifyHeader('Sr. No.').role, 'ignore');
  assert.deepEqual(classifyHeader('NO2 (ppb)'), { role: 'value', pollutant: 'no2', unit: 'ppb' });
});

test('parses values, converts units and flags bad readings', () => {
  assert.equal(parseValue('85', 'pm25').value, 85);
  assert.equal(parseValue('171 ug/m3', 'pm25').value, 171);
  const mg = parseValue('0.189 mg/m3', 'pm25');
  assert.equal(mg.value, 189);
  assert.ok(mg.flags.includes('converted'));
  assert.equal(parseValue('41', 'no2', 'ppb').value, 77.1);
  assert.deepEqual(parseValue('N/A', 'pm25').flags, ['missing']);
  assert.deepEqual(parseValue('999', 'pm10').flags, ['sentinel']);
  assert.deepEqual(parseValue('-12', 'pm10').flags, ['negative']);
  assert.deepEqual(parseValue('0', 'pm25').flags, ['zero']);
  assert.deepEqual(parseValue('sensor offline', 'no2').flags, ['unreadable']);
  assert.ok(parseValue('<5', 'so2').flags.includes('censored'));
  assert.ok(parseValue('5000', 'pm25').flags.includes('implausible'));
  assert.equal(parseValue('1,234', 'pm10').value, 1234);
});

test('reads dates in many formats, day-first when ambiguous', () => {
  const iso = parseTime('2026-11-03', '08:00', 2026);
  assert.equal(new Date(iso.t).toISOString(), '2026-11-03T08:00:00.000Z');
  assert.equal(parseTime('03/11/2026', '8:00 PM', 2026).t, Date.UTC(2026, 10, 3, 20, 0));
  assert.equal(parseTime('3 Nov 2026', '20:00', 2026).t, Date.UTC(2026, 10, 3, 20, 0));
  assert.equal(parseTime('Nov 3, 2026', '', 2026).t, Date.UTC(2026, 10, 3));
  assert.equal(parseTime('11/25/2026', '', 2026).t, Date.UTC(2026, 10, 25));
  assert.equal(parseTime('evening', '', 2026).hour, 19);
  assert.equal(parseTime('31/02/2026', '', 2026).t, null);
  assert.equal(parseTime('', '', 2026).t, null);
});

test('messy CSV sample: every problem is flagged and traceable to its row', () => {
  const p = parseTable(samples.week1.raw);
  assert.equal(p.ok, true);
  assert.equal(p.delimiter, 'comma');
  assert.equal(p.rows.length, 30);
  assert.equal(p.locations.length, 5, 'spelling variants are merged');
  assert.deepEqual(p.pollutants, ['pm25', 'pm10', 'no2']);
  assert.equal(p.ignored[0].line, 1, 'title line is ignored');
  assert.equal(p.rows[0].id, 'R3', 'row IDs are source line numbers');
  assert.deepEqual(cell(p, 'R7', 'pm10').flags, ['missing']);
  assert.equal(cell(p, 'R13', 'pm25').value, 189);
  assert.deepEqual(cell(p, 'R14', 'pm10').flags, ['sentinel']);
  assert.deepEqual(cell(p, 'R25', 'pm10').flags, ['negative']);
  assert.deepEqual(cell(p, 'R31', 'no2').flags, ['unreadable']);
  ['R29', 'R30', 'R31', 'R32'].forEach((id) => assert.ok(cell(p, id, 'pm25').flags.includes('stuck'), `${id} stuck`));
  assert.equal(cell(p, 'R5', 'pm25').t, Date.UTC(2026, 10, 2, 20, 0));
  assert.ok(p.notes.some((n) => /different styles/.test(n)));
  assert.ok(p.notes.some((n) => /ppb/.test(n)));
});

test('Markdown pipe table with a duplicate row', () => {
  const p = parseTable(samples.week2.raw);
  assert.equal(p.ok, true);
  assert.equal(p.delimiter, 'pipe');
  assert.equal(p.rows.length, 31);
  assert.ok(cell(p, 'R7', 'pm25').flags.includes('duplicate'));
  assert.equal(cell(p, 'R6', 'pm25').ok, true);
});

test('long layout with a unit column', () => {
  const p = parseTable('site\tdate\tparameter\tvalue\tunit\nGate\t2026-11-01\tPM2.5\t80\tug/m3\nGate\t2026-11-01\tNO2\t40\tppb\nGate\t2026-11-01\tNoise\t70\tdB');
  assert.equal(p.ok, true);
  assert.equal(p.format, 'long');
  assert.equal(p.rows[0].cells.pm25.value, 80);
  assert.equal(p.rows[1].cells.no2.value, 75.2);
  assert.deepEqual(p.rows[2].flags, ['unknown_pollutant']);
});

test('semicolon CSV with decimal commas, JSON arrays and aligned columns', () => {
  const semi = parseTable('Ort;Datum;PM10\nA;01.11.2026;45,5\nB;01.11.2026;60,0');
  assert.equal(semi.rows[0].cells.pm10.value, 45.5);
  const json = parseTable(JSON.stringify([{ station: 'A', date: '2026-11-01', pm25: 55 }, { station: 'B', date: '2026-11-01', pm25: null }]));
  assert.equal(json.ok, true);
  assert.equal(json.rows[0].cells.pm25.value, 55);
  assert.deepEqual(json.rows[1].cells.pm25.flags, ['missing']);
  const spaced = parseTable('Location      Date          PM2.5\nMain Road     01/11/2026    120\nPark Gate     01/11/2026    45');
  assert.equal(spaced.rows[1].location, 'Park Gate');
});

test('no header row: columns are guessed and the guess is disclosed', () => {
  const p = parseTable('Main Road,01/11/2026,120\nPark,01/11/2026,45\nMain Road,02/11/2026,130');
  assert.equal(p.ok, true);
  assert.equal(p.rows[0].cells.pm25.value, 120);
  assert.ok(p.notes.some((n) => /No header row/.test(n)));
});

test('blank locations are filled down, summary rows skipped', () => {
  const p = parseTable('Location,Date,PM2.5\nGate,01/11/2026,80\n,02/11/2026,90\nAverage,,85');
  assert.equal(p.rows.length, 2);
  assert.equal(p.rows[1].location, 'Gate');
  assert.deepEqual(p.rows[1].flags, ['location_filled']);
});

test('rejects empty input and free text, asking for AI help on the latter', () => {
  assert.equal(parseTable('').ok, false);
  assert.equal(parseTable('   \n  ').ok, false);
  assert.equal(parseTable('just one line').ok, false);
  const notes = parseTable(samples.notes.raw);
  assert.equal(notes.ok, false);
  assert.equal(notes.needsAI, true);
});
