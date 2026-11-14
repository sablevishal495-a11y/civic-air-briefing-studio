'use strict';

/**
 * Small least-recently-used cache with expiry.
 *
 * Used so that repeating an identical request does not call the language model
 * again. A Map keeps insertion order, so the first key is always the least
 * recently used one: get, set and eviction are all O(1).
 */

/**
 * @param {{ttlMs: number, maxEntries: number}} options
 */
function createCache({ ttlMs, maxEntries }) {
  const store = new Map();
  return {
    get(key, now = Date.now()) {
      const hit = store.get(key);
      if (!hit) return null;
      store.delete(key);
      if (now - hit.at > ttlMs) return null;
      store.set(key, hit); // re-insert to mark as most recently used
      return hit.value;
    },
    set(key, value, now = Date.now()) {
      store.delete(key);
      if (store.size >= maxEntries) store.delete(store.keys().next().value);
      store.set(key, { at: now, value });
    },
    get size() {
      return store.size;
    },
  };
}

module.exports = { createCache };
