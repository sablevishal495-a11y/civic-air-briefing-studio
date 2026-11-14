'use strict';

/**
 * Civic Air Quality Briefing Studio: HTTP server.
 *
 * Zero runtime dependencies (Node 20+ standard library only): serves the static
 * front end and three JSON endpoints. The Gemini API key lives only here.
 * Runs unchanged on Cloud Run, Render, a laptop, or Vercel (which detects
 * server.js and captures the listen() call below).
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { runAnalysis, runAdvisory, InputError, MAX_RAW_CHARS } = require('./src/pipeline');
const { LANGUAGES } = require('./src/prompts');
const { AUDIENCES } = require('./src/rules');
const { FLAGS, POLLUTANTS } = require('./src/parse');
const gemini = require('./src/gemini');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = 1024 * 1024;
const RATE_LIMIT = { windowMs: 60000, max: Number(process.env.RATE_LIMIT_PER_MIN) || 40 };
const CACHE_TTL_MS = 10 * 60000;
const CACHE_MAX = 60;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

/** Static files are tiny, so load them once and serve from memory with ETags. */
function loadStatic() {
  const files = new Map();
  // On Vercel the CDN serves public/ and the function bundle may not contain it.
  if (!fs.existsSync(PUBLIC_DIR)) return files;
  for (const name of fs.readdirSync(PUBLIC_DIR)) {
    const full = path.join(PUBLIC_DIR, name);
    if (!fs.statSync(full).isFile()) continue;
    const body = fs.readFileSync(full);
    files.set(`/${name}`, {
      body,
      type: MIME[path.extname(name)] || 'application/octet-stream',
      etag: `"${crypto.createHash('sha1').update(body).digest('hex').slice(0, 16)}"`,
    });
  }
  return files;
}

function createRateLimiter({ windowMs, max }) {
  const hits = new Map();
  return function allow(key, now = Date.now()) {
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) hits.clear();
    return true;
  };
}

/** Small TTL cache so repeating the same request does not call the model again. */
function createCache() {
  const store = new Map();
  return {
    get(key) {
      const hit = store.get(key);
      if (!hit || Date.now() - hit.at > CACHE_TTL_MS) return null;
      return hit.value;
    },
    set(key, value) {
      if (store.size >= CACHE_MAX) store.delete(store.keys().next().value);
      store.set(key, { at: Date.now(), value });
    },
  };
}

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
function createHandler(deps = {}) {
  const ai = deps.ai || gemini;
  const files = loadStatic();
  const allow = createRateLimiter(deps.rateLimit || RATE_LIMIT);
  const cache = createCache();

  const config = () => ({
    ai: ai.isConfigured(),
    model: ai.isConfigured() ? ai.currentModel() : null,
    audiences: Object.values(AUDIENCES).map((a) => ({ key: a.key, label: a.label })),
    languages: Object.values(LANGUAGES),
    flags: FLAGS,
    pollutants: POLLUTANTS,
    maxChars: MAX_RAW_CHARS, keyLikeEnvNames: Object.keys(process.env).filter((k) => /gemini|google|api_?key/i.test(k)),
  });

  async function handleApi(req, res, pathname) {
    if (pathname === '/api/health' || pathname === '/api/config') {
      if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed.' }, { Allow: 'GET' });
      return send(res, 200, pathname === '/api/health' ? { ok: true, ai: ai.isConfigured() } : config());
    }
    const handler = { '/api/analyze': runAnalysis, '/api/advisory': runAdvisory }[pathname];
    if (!handler) return send(res, 404, { error: 'Not found.' });
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' }, { Allow: 'POST' });
    if (!allow(clientIp(req))) return send(res, 429, { error: 'Too many requests. Please wait a minute and try again.' }, { 'Retry-After': '60' });

    const body = await readJson(req);
    const key = crypto.createHash('sha256').update(pathname + JSON.stringify(body)).digest('hex');
    const cached = cache.get(key);
    if (cached) return send(res, 200, { ...cached, cached: true });
    const result = await handler(body, { ai });
    // Only cache model-written results; rule results are instant and a retry should try the model again.
    if (result.mode === 'ai') cache.set(key, result);
    return send(res, 200, result);
  }

  function handleStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed.' }, { Allow: 'GET, HEAD' });
    const file = files.get(pathname === '/' ? '/index.html' : pathname);
    if (!file) return send(res, 404, 'Not found: ' + req.url, { 'Content-Type': 'text/plain; charset=utf-8' });
    const headers = { 'Content-Type': file.type, ETag: file.etag, 'Cache-Control': 'public, max-age=300' };
    if (req.headers['if-none-match'] === file.etag) return send(res, 304, '', headers);
    return send(res, 200, req.method === 'HEAD' ? '' : file.body, headers);
  }

  return async function handle(req, res) {
    const started = Date.now();
    let pathname = '/';
    try {
      pathname = ((u) => { if (u.pathname.startsWith('/api/')) return u.pathname; const seen = [u.pathname, u.searchParams.get('op') || ''].concat(['x-matched-path', 'x-forwarded-uri', 'x-original-url', 'x-vercel-original-path', 'x-invoke-path'].map((h) => String(req.headers[h] || '').split('?')[0])); const hit = seen.map((t) => t.match(/(?:^|\/)(health|config|analyze|advisory)\/?$/)).find(Boolean); return hit ? '/api/' + hit[1] : u.pathname; })(new URL(req.url, 'http://localhost'));
      if (pathname.startsWith('/api/')) await handleApi(req, res, pathname);
      else handleStatic(req, res, pathname);
    } catch (err) {
      if (err instanceof InputError) send(res, err.status, { error: err.message });
      else {
        console.error(JSON.stringify({ level: 'error', path: pathname, message: err.message }));
        if (!res.headersSent) send(res, 500, { error: 'Something went wrong on the server. Please try again.' });
      }
    } finally {
      if (pathname.startsWith('/api/') && process.env.NODE_ENV !== 'test') {
        console.log(JSON.stringify({ level: 'info', method: req.method, path: pathname, status: res.statusCode, ms: Date.now() - started }));
      }
    }
  };
}

function createApp(deps = {}) {
  return http.createServer(createHandler(deps));
}

// Start listening when run directly (node server.js) and on Vercel, whose Node
// server support imports this file and captures the listen() call. Tests import
// the module and start their own instances, so they are the one case that must not listen.
const underTest = process.env.NODE_ENV === 'test' || Boolean(process.env.NODE_TEST_CONTEXT);
if (require.main === module || false) {
  const port = Number(process.env.PORT) || 8080;
  createApp().listen(port, () => {
    console.log(JSON.stringify({ level: 'info', message: `Civic Air Quality Briefing Studio listening on :${port}`, ai: gemini.isConfigured() }));
  });
}

module.exports = createHandler();
module.exports.createApp = createApp;
module.exports.createHandler = createHandler;
module.exports.createRateLimiter = createRateLimiter;