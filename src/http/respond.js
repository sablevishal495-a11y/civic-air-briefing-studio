'use strict';

/**
 * Response helpers: security headers on every response, gzip for large JSON.
 */

const zlib = require('node:zlib');

const COMPRESS_MIN_BYTES = 1024;

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

const acceptsGzip = (req) => /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
    ...headers,
  });
  res.end(payload);
}

/** JSON responses can be large (every parsed row is returned), so compress them when the client allows. */
function sendJson(req, res, status, body) {
  const json = JSON.stringify(body);
  if (json.length < COMPRESS_MIN_BYTES || !acceptsGzip(req)) return send(res, status, json);
  return zlib.gzip(json, (err, zipped) => {
    if (err) send(res, status, json);
    else send(res, status, zipped, { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
  });
}

module.exports = { COMPRESS_MIN_BYTES, SECURITY_HEADERS, acceptsGzip, send, sendJson };
