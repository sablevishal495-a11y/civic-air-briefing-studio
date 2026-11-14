'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp, createRateLimiter } = require('../server');
const samples = require('../public/samples');

const noAI = { isConfigured: () => false, currentModel: () => null };

async function withServer(deps, fn) {
  const server = createApp({ ai: noAI, ...deps });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
const post = (base, path, body, headers = { 'Content-Type': 'application/json' }) => fetch(base + path, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('serves the app with security headers and caching', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    const again = await fetch(`${base}/`, { headers: { 'If-None-Match': res.headers.get('etag') } });
    assert.equal(again.status, 304);
    assert.equal((await fetch(`${base}/app.js`)).status, 200);
  });
});

test('unknown paths, traversal attempts and wrong methods are refused', async () => {
  await withServer({}, async (base) => {
    assert.equal((await fetch(`${base}/nope`)).status, 404);
    assert.equal((await fetch(`${base}/..%2Fserver.js`)).status, 404);
    assert.equal((await fetch(`${base}/api/unknown`)).status, 404);
    assert.equal((await fetch(`${base}/api/analyze`)).status, 405);
    assert.equal((await fetch(`${base}/`, { method: 'DELETE' })).status, 405);
  });
});

test('health and config endpoints', async () => {
  await withServer({}, async (base) => {
    assert.deepEqual(await (await fetch(`${base}/api/health`)).json(), { ok: true, ai: false });
    const config = await (await fetch(`${base}/api/config`)).json();
    assert.equal(config.ai, false);
    assert.ok(config.languages.length >= 10);
    assert.deepEqual(config.audiences.map((a) => a.key), ['ward', 'society', 'school']);
  });
});

test('analyze and advisory work end to end', async () => {
  await withServer({}, async (base) => {
    const res = await post(base, '/api/analyze', { raw: samples.week2.raw, previousRaw: samples.week1.raw, audience: 'society', place: 'Ward 14' });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.stats.totals.locations, 5);
    assert.equal(data.comparison.available, true);
    assert.equal(data.audienceLabel, 'Housing society');
    const adv = await post(base, '/api/advisory', { facts: data.advisoryFacts, language: 'hi', audience: 'society' });
    assert.equal(adv.status, 200);
    assert.equal((await adv.json()).language.code, 'hi');
  });
});

test('bad requests get clear errors, not crashes', async () => {
  await withServer({}, async (base) => {
    assert.equal((await post(base, '/api/analyze', '{not json')).status, 400);
    assert.equal((await post(base, '/api/analyze', { raw: 'x' }, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await post(base, '/api/analyze', { raw: 'x'.repeat(1100000), audience: 'ward' })).status, 413);
    const unreadable = await post(base, '/api/analyze', { raw: 'hello there\nthis is not data', audience: 'ward' });
    assert.equal(unreadable.status, 422);
    assert.ok((await unreadable.json()).error.length > 10);
  });
});

test('rate limiting', async () => {
  const allow = createRateLimiter({ windowMs: 1000, max: 2 });
  assert.equal(allow('a', 0), true);
  assert.equal(allow('a', 1), true);
  assert.equal(allow('a', 2), false);
  assert.equal(allow('b', 2), true);
  assert.equal(allow('a', 1500), true);
  await withServer({ rateLimit: { windowMs: 60000, max: 1 } }, async (base) => {
    const body = { raw: samples.week1.raw, audience: 'ward' };
    assert.equal((await post(base, '/api/analyze', body)).status, 200);
    const limited = await post(base, '/api/analyze', body);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '60');
  });
});

test('model-written results are cached for identical requests', async () => {
  let calls = 0;
  const ai = { isConfigured: () => true, currentModel: () => 'fake', async generateJson() { calls++; return { data: { headline: 'H' }, model: 'fake' }; } };
  await withServer({ ai }, async (base) => {
    const body = { raw: samples.week1.raw, audience: 'ward' };
    const first = await (await post(base, '/api/analyze', body)).json();
    const second = await (await post(base, '/api/analyze', body)).json();
    assert.equal(first.mode, 'ai');
    assert.equal(second.cached, true);
    assert.equal(calls, 1);
  });
});
