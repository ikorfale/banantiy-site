'use strict';

const crypto = require('node:crypto');
const net = require('node:net');

const BACKEND_ORIGIN = 'https://104.243.37.38.sslip.io';
const ROUTES = Object.freeze({
  challenge: Object.freeze({ path: '/order-api/v1/challenge', methods: ['POST'], requestCap: 8192, responseCap: 16384 }),
  seats: Object.freeze({ path: '/order-api/v1/seats', methods: ['GET', 'POST'], requestCap: 8192, responseCap: 65536 }),
  leave: Object.freeze({ path: '/order-api/v1/leave', methods: ['POST'], requestCap: 4096, responseCap: 8192 }),
});
const DEADLINE_MS = 4500;

function securityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function send(res, status, body) {
  securityHeaders(res);
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function clientAddress(req) {
  const raw = req.headers['x-vercel-forwarded-for'];
  if (typeof raw !== 'string') return null;
  const first = raw.split(',', 1)[0].trim();
  const family = net.isIP(first);
  if (!family || first.length > 64) return null;
  if (family === 4) return first;
  const host = new URL(`http://[${first}]/`).hostname;
  return host.slice(1, -1).toLowerCase();
}

function clientKey(secret, address) {
  return crypto.createHmac('sha256', secret).update('empty-chair-client-v1\n').update(address).digest('hex');
}

function queryFor(req, route) {
  if (route !== 'seats' || req.method !== 'GET') return '';
  const parsed = new URL(req.url, 'https://same-origin.invalid');
  const allowed = new Set(['limit', 'cursor']);
  for (const key of parsed.searchParams.keys()) {
    if (!allowed.has(key) || parsed.searchParams.getAll(key).length !== 1) throw new Error('invalid-query');
  }
  if (parsed.search.length > 768) throw new Error('invalid-query');
  return parsed.search;
}

async function readBody(req, cap) {
  if (req.method === 'GET') return null;
  const type = req.headers['content-type'];
  if (typeof type !== 'string' || !['application/json', 'application/json; charset=utf-8'].includes(type.toLowerCase())) {
    throw Object.assign(new Error('content-type'), { status: 415 });
  }
  let body;
  if (Buffer.isBuffer(req.body)) body = req.body;
  else if (typeof req.body === 'string') body = Buffer.from(req.body, 'utf8');
  else if (req.body && typeof req.body === 'object') body = Buffer.from(JSON.stringify(req.body), 'utf8');
  else {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > cap) throw Object.assign(new Error('too-large'), { status: 413 });
      chunks.push(buffer);
    }
    body = Buffer.concat(chunks);
  }
  if (body.length < 2 || body.length > cap) throw Object.assign(new Error('too-large'), { status: 413 });
  return body;
}

async function readCapped(response, cap) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel();
      throw Object.assign(new Error('upstream-too-large'), { status: 502 });
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function makeHandler(routeName, dependencies = {}) {
  const route = ROUTES[routeName];
  if (!route) throw new Error('unknown fixed route');
  const fetchImpl = dependencies.fetch || globalThis.fetch;
  const deadlineMs = dependencies.deadlineMs || DEADLINE_MS;
  return async function handler(req, res) {
    if (!route.methods.includes(req.method)) {
      res.setHeader('Allow', route.methods.join(', '));
      return send(res, 405, { error: { code: 'method_not_allowed', message: 'method not allowed' } });
    }
    const secret = process.env.ORDER_PROXY_SECRET;
    const address = clientAddress(req);
    if (typeof secret !== 'string' || secret.length < 32 || !address) {
      return send(res, 503, { error: { code: 'registry_unavailable', message: 'registry is unavailable' } });
    }
    let query = '';
    let body = null;
    try {
      query = queryFor(req, routeName);
      body = await readBody(req, route.requestCap);
    } catch (error) {
      const status = error.status || 400;
      const code = status === 413 ? 'request_too_large' : status === 415 ? 'unsupported_media_type' : 'invalid_request';
      return send(res, status, { error: { code, message: status === 413 ? 'request body is too large' : 'request is invalid' } });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deadlineMs);
    try {
      const upstream = await fetchImpl(`${BACKEND_ORIGIN}${route.path}${query}`, {
        method: req.method,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json; charset=utf-8',
          'X-Order-Client-Key': clientKey(secret, address),
          'X-Order-Proxy-Secret': secret,
        },
        body,
        redirect: 'manual',
        signal: controller.signal,
      });
      if (upstream.status >= 300 && upstream.status < 400) {
        return send(res, 502, { error: { code: 'upstream_error', message: 'registry request failed' } });
      }
      const responseBody = await readCapped(upstream, route.responseCap);
      let parsed;
      try {
        parsed = JSON.parse(responseBody.toString('utf8'));
      } catch {
        return send(res, 502, { error: { code: 'upstream_error', message: 'registry request failed' } });
      }
      const status = upstream.status >= 200 && upstream.status <= 599 ? upstream.status : 502;
      securityHeaders(res);
      res.statusCode = status;
      return res.end(JSON.stringify(parsed));
    } catch (error) {
      const timedOut = error && (error.name === 'AbortError' || controller.signal.aborted);
      return send(res, timedOut ? 504 : 502, {
        error: { code: timedOut ? 'upstream_timeout' : 'upstream_error', message: 'registry request failed' },
      });
    } finally {
      clearTimeout(timer);
    }
  };
}

module.exports = { BACKEND_ORIGIN, DEADLINE_MS, ROUTES, clientAddress, clientKey, makeHandler, readBody, readCapped };
