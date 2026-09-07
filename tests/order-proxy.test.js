'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { BACKEND_ORIGIN, ROUTES, clientKey, makeHandler } = require('../lib/order-proxy');

const SECRET = 'proxy-secret-that-is-long-enough-for-tests';

function request(method = 'GET', url = '/api/order/v1/seats', body = undefined, headers = {}) {
  return {
    method,
    url,
    body,
    headers: { 'x-vercel-forwarded-for': '203.0.113.7', ...headers },
  };
}

function response() {
  const headers = new Map();
  return {
    headers,
    statusCode: 0,
    body: '',
    setHeader(name, value) { headers.set(name.toLowerCase(), String(value)); },
    end(value = '') { this.body += Buffer.isBuffer(value) ? value.toString('utf8') : String(value); },
  };
}

async function withSecret(fn) {
  const old = process.env.ORDER_PROXY_SECRET;
  process.env.ORDER_PROXY_SECRET = SECRET;
  try { return await fn(); }
  finally {
    if (old === undefined) delete process.env.ORDER_PROXY_SECRET;
    else process.env.ORDER_PROXY_SECRET = old;
  }
}

test('fixed route and method allowlist reject arbitrary upstreams', async () => {
  assert.throws(() => makeHandler('https://evil.example'), /unknown fixed route/);
  let called = false;
  const handler = makeHandler('challenge', { fetch: async () => { called = true; } });
  const res = response();
  await withSecret(() => handler(request('GET'), res));
  assert.equal(res.statusCode, 405);
  assert.equal(called, false);
  assert.equal(res.headers.get('allow'), 'POST');
});

test('client address is HMACed and only fixed secret/client headers are sent', async () => {
  let captured;
  const handler = makeHandler('seats', {
    fetch: async (url, options) => {
      captured = { url, options };
      return new Response(JSON.stringify({ items: [], next_cursor: null }), {
        status: 200,
        headers: { 'Set-Cookie': 'bad=1', 'Access-Control-Allow-Origin': '*' },
      });
    },
  });
  const res = response();
  await withSecret(() => handler(request('GET', '/api/order/v1/seats?limit=2'), res));
  assert.equal(captured.url, `${BACKEND_ORIGIN}${ROUTES.seats.path}?limit=2`);
  assert.equal(captured.options.redirect, 'manual');
  assert.equal(captured.options.headers['X-Order-Proxy-Secret'], SECRET);
  const expected = crypto.createHmac('sha256', SECRET).update('empty-chair-client-v1\n').update('203.0.113.7').digest('hex');
  assert.equal(captured.options.headers['X-Order-Client-Key'], expected);
  assert.equal(clientKey(SECRET, '203.0.113.7'), expected);
  assert.equal(Object.keys(captured.options.headers).sort().join(','), 'Accept,Content-Type,X-Order-Client-Key,X-Order-Proxy-Secret');
  assert.equal(res.headers.has('set-cookie'), false);
  assert.equal(res.headers.has('access-control-allow-origin'), false);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.doesNotMatch(res.body, /proxy-secret/);
  assert.doesNotMatch(res.body, /203\.0\.113\.7/);
});

test('strict query, content type, and request cap', async () => {
  const noFetch = async () => { throw new Error('must not fetch'); };
  await withSecret(async () => {
    for (const [req, expected] of [
      [request('GET', '/api/order/v1/seats?evil=1'), 400],
      [request('POST', '/api/order/v1/seats', '{}', { 'content-type': 'text/plain' }), 415],
      [request('POST', '/api/order/v1/seats', 'x'.repeat(8193), { 'content-type': 'application/json' }), 413],
    ]) {
      const res = response();
      await makeHandler('seats', { fetch: noFetch })(req, res);
      assert.equal(res.statusCode, expected);
    }
  });
});

test('redirects, invalid JSON, and oversized upstreams are normalized', async () => {
  const cases = [
    [async () => new Response('', { status: 302, headers: { Location: 'https://evil.example' } }), 502],
    [async () => new Response('not-json', { status: 200 }), 502],
    [async () => new Response(JSON.stringify({ padding: 'x'.repeat(70000) }), { status: 200 }), 502],
  ];
  await withSecret(async () => {
    for (const [fetchImpl, expected] of cases) {
      const res = response();
      await makeHandler('seats', { fetch: fetchImpl })(request(), res);
      assert.equal(res.statusCode, expected);
      assert.match(res.body, /upstream_error/);
      assert.doesNotMatch(res.body, /evil\.example|padding/);
    }
  });
});

test('deadline aborts and normalizes without logging', async () => {
  const calls = [];
  const oldLog = console.log;
  const oldError = console.error;
  console.log = (...args) => calls.push(args);
  console.error = (...args) => calls.push(args);
  try {
    const handler = makeHandler('seats', {
      deadlineMs: 10,
      fetch: async (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }),
    });
    const res = response();
    await withSecret(() => handler(request(), res));
    assert.equal(res.statusCode, 504);
    assert.equal(calls.length, 0);
    assert.equal(res.headers.has('access-control-allow-origin'), false);
  } finally {
    console.log = oldLog;
    console.error = oldError;
  }
});

test('missing client binding or service secret fails closed', async () => {
  const handler = makeHandler('seats', { fetch: async () => { throw new Error('must not fetch'); } });
  const res1 = response();
  await handler(request(), res1);
  assert.equal(res1.statusCode, 503);
  const res2 = response();
  await withSecret(() => handler(request('GET', '/', undefined, { 'x-vercel-forwarded-for': 'not an ip' }), res2));
  assert.equal(res2.statusCode, 503);
});
