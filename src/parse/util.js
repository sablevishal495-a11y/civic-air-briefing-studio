'use strict';

/**
 * Small pure helpers shared by the parser and the statistics.
 */

const { FLAGS } = require('./constants');

function clean(cell) {
  let s = String(cell == null ? '' : cell).replace(/\s+/g, ' ').trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).trim();
  return s;
}

function round(v, dp = 1) {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function isReliable(flags) {
  return !flags.some((f) => FLAGS[f] && FLAGS[f].exclude);
}

function locationKey(name) {
  return name.toLowerCase().replace(/[^a-z0-9ऀ-෿]+/g, '');
}

function isNumericLike(cell) {
  return /^[<>~≤≥]?\s*-?\d/.test(cell);
}

function groupBy(list, keyFn) {
  const map = new Map();
  list.forEach((item) => {
    const k = keyFn(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  });
  return map;
}

/** Chronological when every reading has a time; otherwise source-row order. */
function orderSeries(list) {
  if (list.length && list.every((r) => r.t != null)) return [...list].sort((a, b) => a.t - b.t);
  return list;
}

module.exports = { clean, round, median, isReliable, locationKey, isNumericLike, groupBy, orderSeries };
