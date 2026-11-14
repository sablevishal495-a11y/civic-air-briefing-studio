'use strict';

/**
 * Fixed-window rate limiter.
 *
 * O(1) time and one small record per client: each key stores only the start of
 * its current window and a counter. Expired records are swept at most once per
 * window, so memory stays proportional to the clients seen in the last window.
 */

/**
 * @param {{windowMs: number, max: number}} options
 * @returns {(key: string, now?: number) => boolean} true when the request is allowed
 */
function createRateLimiter({ windowMs, max }) {
  const windows = new Map();
  let lastSweep = 0;

  const sweep = (now) => {
    if (now - lastSweep < windowMs) return;
    lastSweep = now;
    for (const [key, entry] of windows) {
      if (now - entry.start >= windowMs) windows.delete(key);
    }
  };

  return function allow(key, now = Date.now()) {
    sweep(now);
    const entry = windows.get(key);
    if (!entry || now - entry.start >= windowMs) {
      windows.set(key, { start: now, count: 1 });
      return true;
    }
    entry.count += 1;
    return entry.count <= max;
  };
}

module.exports = { createRateLimiter };
