'use strict';

/**
 * Request routing: maps a URL to a canonical API route or a static path.
 */

const API_ROUTES = ['health', 'config', 'analyze', 'advisory'];

const ROUTE_PATTERN = new RegExp(`(?:^|/)(${API_ROUTES.join('|')})/?$`);

/**
 * Map a request to a canonical path.
 *
 * Hosting platforms differ in how they forward paths (Vercel reserves the
 * "/api" prefix and may trim what follows), so an API route is recognised by
 * its final segment under any prefix, or by an explicit "?op=" parameter.
 * Anything else is returned unchanged and treated as a static file.
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {string} "/api/<route>" for API calls, otherwise the request path
 */
function resolveRoute(req) {
  const url = new URL(req.url, 'http://localhost');
  const byPath = url.pathname.match(ROUTE_PATTERN);
  if (byPath) return `/api/${byPath[1]}`;
  const op = url.searchParams.get('op');
  return API_ROUTES.includes(op) ? `/api/${op}` : url.pathname;
}

module.exports = { API_ROUTES, ROUTE_PATTERN, resolveRoute };
