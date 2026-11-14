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
const path = require('node:path');
const crypto = require('node:crypto');

const { runAnalysis, runAdvisory, InputError, MAX_RAW_CHARS } = require('./src/pipeline');
const { LANGUAGES } = require('./src/prompts');
const { AUDIENCES } = require('./src/rules');
const { FLAGS, POLLUTANTS } = require('./src/parse');
const gemini = require('./src/gemini');

const { resolveRoute } = require('./src/http/routes');
const { loadStatic } = require('./src/http/static-files');
const { acceptsGzip, send, sendJson } = require('./src/http/respond');
const { readJson, clientIp } = require('./src/http/request');
const { createRateLimiter } = require('./src/http/rate-limiter');
const { createCache } = require('./src/http/ttl-cache');

const PUBLIC_DIR = path.join(__dirname, 'public');
const RATE_LIMIT = { windowMs: 60000, max: Number(process.env.RATE_LIMIT_PER_MIN) || 40 };
const CACHE = { ttlMs: 10 * 60000, maxEntries: 60 };

function createHandler(deps = {}) {
  const ai = deps.ai || gemini;
  const files = loadStatic(PUBLIC_DIR);
  const allow = createRateLimiter(deps.rateLimit || RATE_LIMIT);
  const cache = createCache(CACHE);

  const config = () => ({
    ai: ai.isConfigured(),
    model: ai.isConfigured() ? ai.currentModel() : null,
    audiences: Object.values(AUDIENCES).map((a) => ({ key: a.key, label: a.label })),
    languages: Object.values(LANGUAGES),
    flags: FLAGS,
    pollutants: POLLUTANTS,
    maxChars: MAX_RAW_CHARS,
  });

  async function handleApi(req, res, pathname) {
    if (pathname === '/api/health' || pathname === '/api/config') {
      if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed.' }, { Allow: 'GET' });
      return sendJson(req, res, 200, pathname === '/api/health' ? { ok: true, ai: ai.isConfigured() } : config());
    }
    const handler = { '/api/analyze': runAnalysis, '/api/advisory': runAdvisory }[pathname];
    if (!handler) return send(res, 404, { error: 'Not found.' });
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' }, { Allow: 'POST' });
    if (!allow(clientIp(req))) return send(res, 429, { error: 'Too many requests. Please wait a minute and try again.' }, { 'Retry-After': '60' });

    const body = await readJson(req);
    const key = crypto.createHash('sha256').update(pathname + JSON.stringify(body)).digest('hex');
    const cached = cache.get(key);
    if (cached) return sendJson(req, res, 200, { ...cached, cached: true });
    const result = await handler(body, { ai });
    // Only cache model-written results; rule results are instant and a retry should try the model again.
    if (result.mode === 'ai') cache.set(key, result);
    return sendJson(req, res, 200, result);
  }

  function handleStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed.' }, { Allow: 'GET, HEAD' });
    const file = files.get(pathname === '/' ? '/index.html' : pathname);
    if (!file) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    const headers = { 'Content-Type': file.type, ETag: file.etag, 'Cache-Control': 'public, max-age=300', Vary: 'Accept-Encoding' };
    if (req.headers['if-none-match'] === file.etag) return send(res, 304, '', headers);
    if (req.method === 'HEAD') return send(res, 200, '', headers);
    if (acceptsGzip(req)) return send(res, 200, file.gzip, { ...headers, 'Content-Encoding': 'gzip' });
    return send(res, 200, file.body, headers);
  }

  return async function handle(req, res) {
    const started = Date.now();
    let pathname = '/';
    try {
      pathname = resolveRoute(req);
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

if (require.main === module) {
  const port = Number(process.env.PORT) || 8080;
  createApp().listen(port, () => {
    console.log(JSON.stringify({ level: 'info', message: `Civic Air Quality Briefing Studio listening on :${port}`, ai: gemini.isConfigured() }));
  });
}

module.exports = createHandler();
module.exports.createApp = createApp;
module.exports.createHandler = createHandler;
module.exports.createRateLimiter = createRateLimiter;