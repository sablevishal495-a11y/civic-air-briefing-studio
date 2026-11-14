'use strict';

/**
 * Static front-end files, loaded once and served from memory.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

/** Static files are tiny, so load them once and serve from memory with ETags. */
function loadStatic(publicDir) {
  const files = new Map();
  // On Vercel the CDN serves public/ and the function bundle may not contain it.
  if (!fs.existsSync(publicDir)) return files;
  for (const name of fs.readdirSync(publicDir)) {
    const full = path.join(publicDir, name);
    if (!fs.statSync(full).isFile()) continue;
    const body = fs.readFileSync(full);
    files.set(`/${name}`, {
      body,
      gzip: zlib.gzipSync(body),
      type: MIME[path.extname(name)] || 'application/octet-stream',
      etag: `"${crypto.createHash('sha1').update(body).digest('hex').slice(0, 16)}"`,
    });
  }
  return files;
}

module.exports = { MIME, loadStatic };
