/**
 * Shared constants and the single mutable UI state object.
 */

export const API_BASE = '/svc/';

export const HISTORY_KEY = 'caq.briefs.v1';

export const MAX_LANGUAGES = 4;

export const MAX_FILE_BYTES = 200 * 1024;

export const DEFAULT_CONFIG = {
  ai: false,
  model: null,
  maxChars: 200000,
  languages: [
    { code: 'en', name: 'English', native: 'English', dir: 'ltr' },
    { code: 'hi', name: 'Hindi', native: 'हिन्दी', dir: 'ltr' }
  ],
  flags: {},
  pollutants: {}
};

/** Fired when the user asks for the same data to be re-run for another audience. */
export const REGENERATE_EVENT = 'caq:regenerate';

export const state = { config: DEFAULT_CONFIG, result: null, advisory: null, busy: false, lastChip: null };

export const $ = function (id) { return document.getElementById(id); };
