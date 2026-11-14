'use strict';

/**
 * Request helpers: bounded JSON body reading and client identification.
 */

const { InputError } = require('../pipeline');

const MAX_BODY_BYTES = 1024 * 1024;

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!/application\/json/i.test(req.headers['content-type'] || '')) {
      reject(new InputError('Content-Type must be application/json.', 415));
      return;
    }
    // Serverless platforms such as Vercel read the body before the handler runs
    // and expose it as req.body; the stream is then already finished.
    if (req.readableEnded) {
      try {
        const body = req.body;
        if (Buffer.isBuffer(body) || typeof body === 'string') resolve(JSON.parse(String(body)));
        else if (body && typeof body === 'object') resolve(body);
        else reject(new InputError('Request body is not valid JSON.'));
      } catch {
        reject(new InputError('Request body is not valid JSON.'));
      }
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      // Past the limit, stop buffering but let the upload finish so the client gets a clean 413.
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > MAX_BODY_BYTES) {
        reject(new InputError('Request is too large.', 413));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new InputError('Request body is not valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}

/** The request handler on its own, so it can run under http.createServer or as a serverless function. */

module.exports = { MAX_BODY_BYTES, readJson, clientIp };
