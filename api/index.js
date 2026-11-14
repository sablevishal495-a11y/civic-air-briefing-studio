'use strict';

/**S
 * Vercel entry point. vercel.json sends every /api/* request here; the same
 * handler that powers the standalone server answers it. Static files in
 * public/ are served directly by Vercel's CDN.
 */
const { createHandler } = require('../server');

module.exports = createHandler();