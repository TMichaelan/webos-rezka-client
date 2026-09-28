'use strict';
const nodeTest = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { RezkaTransport } = require('../service/transport.cjs');

// Node 16's experimental test context has no t.after; keep cleanup portable.
const test = (name, run) => nodeTest(name, async () => {
  const cleanups = [];
  try { await run({ after: cleanup => cleanups.push(cleanup) }); }
  finally { for (const cleanup of cleanups.reverse()) await cleanup(); }
});

async function server(t, handler, host = '127.0.0.1') {
  const s = http.createServer(handler);
  const sockets = new Set();
  s.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => s.listen(0, host, resolve));
  t.after(() => new Promise(resolve => { for (const socket of sockets) socket.destroy(); s.close(resolve); }));
  return `http://${host}:${s.address().port}`;
}
const transport = (mirror, extra = {}) => new RezkaTransport({ mirror, allowLocalhostForTests: true, ...extra });
const code = expected => e => e.code === expected && typeof e.retryable === 'boolean' && !/secret/.test(e.message);
const seed = '0123456789abcdef'.repeat(8);
const challengeId = '01998000-0000-7000-8000-000000000001';
function challenge({ version = '1.25.0', algorithm = 'fast', difficulty = 2, issuedAt = new Date().toISOString(), spent = false, prefix = '' } = {}) {
  const data = { rules: { algorithm, difficulty }, challenge: { issuedAt, metadata: { 'User-Agent': 'fixture', 'X-Real-Ip': '127.0.0.1' }, id: challengeId, method: algorithm, randomData: seed, policyRuleHash: 'fixture', difficulty, spent } };
  return `<html><script id="anubis_version" type="application/json">${JSON.stringify(version)}</script><script id="anubis_base_prefix" type="application/json">${JSON.stringify(prefix)}</script><script id="anubis_public_url" type="application/json">""</script><script id="anubis_challenge" type="application/json">${JSON.stringify(data)}</script><script>throw new Error('must not execute remote scripts')</script></html>`;
}
function verifyProof(req, url) {
  assert.match(req.headers.cookie || '', /techaro\.lol-anubis-cookie-verification=/);
  assert.equal(url.searchParams.get('id'), challengeId);
  assert.match(url.searchParams.get('nonce'), /^\d+$/);
  const hash = crypto.createHash('sha256').update(seed + url.searchParams.get('nonce')).digest('hex');
  assert.equal(url.searchParams.get('response'), hash);
  assert.match(hash, /^00/);
  assert.ok(Number(url.searchParams.get('elapsedTime')) >= 0);
  assert.equal(req.headers['user-agent'].includes('Chrome/120'), true);
}

test('sends same-origin form with scoped cookies and restores only the session from a private file', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rezka-session-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sessionFile = path.join(dir, 'session.json');
  const mirror = await server(t, (req, res) => {
    if (req.url === '/login') {
      let body = ''; req.on('data', chunk => body += chunk); req.on('end', () => {
        assert.equal(body, 'username=test&password=secret');
        res.setHeader('Set-Cookie', ['account=test-session; Path=/; HttpOnly', 'foreign=bad; Domain=example.com; Path=/']);
        res.end('logged in');
      });
    } else res.end(req.headers.cookie || 'none');
  });
  const first = transport(mirror, { sessionFile });
  assert.equal((await first.request('/login', { method: 'POST', form: { username: 'test', password: 'secret' } })).body, 'logged in');
  await first.saveSession();
  assert.equal(fs.statSync(sessionFile).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(sessionFile, 'utf8').includes('secret'), false);
  assert.deepEqual(fs.readdirSync(dir), ['session.json']);
  const restored = transport(mirror, { sessionFile });
  assert.equal((await restored.request('/')).body, 'account=test-session');
  await restored.clearSession();
  assert.equal((await transport(mirror, { sessionFile }).request('/')).body, 'none');
});

test('rejects invalid mirror URLs, unapproved hosts, private HTTP and caller cookie injection', async t => {
  for (const mirror of ['http://hdrezka-home.tv', 'https://hdrezka-home.tv.evil.example', 'https://u:secret@hdrezka-home.tv', 'https://hdrezka-home.tv:8443', 'https://hdrezka-home.tv/a', 'http://127.0.0.1']) {
    assert.throws(() => new RezkaTransport({ mirror }), code('BLOCKED_URL'));
  }
  const mirror = await server(t, (_req, res) => res.end('ok'));
  const client = transport(mirror);
  await assert.rejects(client.request('https://example.com/secret'), code('BLOCKED_URL'));
  await assert.rejects(client.request('/', { headers: { Cookie: 'secret=1' } }), code('INVALID_REQUEST'));
  await assert.rejects(client.request('/', { headers: { Host: 'example.com' } }), code('INVALID_REQUEST'));
});

test('blocks unknown redirect hosts and all cross-origin form redirects before forwarding credentials', async t => {
  let targetHits = 0;
  const target = await server(t, (_req, res) => { targetHits++; res.end('leaked'); }, 'localhost');
  const mirror = await server(t, (req, res) => { res.writeHead(req.url === '/unknown' ? 302 : 307, { Location: req.url === '/unknown' ? 'https://evil.example/secret' : target }); res.end(); });
  const client = transport(mirror);
  await assert.rejects(client.request('/unknown'), code('BLOCKED_URL'));
  await assert.rejects(client.request('/login', { method: 'POST', form: { password: 'secret' } }), code('BLOCKED_URL'));
  await assert.rejects(client.request(target, { method: 'POST', form: { password: 'secret' } }), code('BLOCKED_URL'));
  assert.equal(targetHits, 0);
});

test('allowed GET mirror redirect never forwards source cookies or caller authorization', async t => {
  const target = await server(t, (req, res) => res.end(JSON.stringify({ cookie: req.headers.cookie, authorization: req.headers.authorization, referer: req.headers.referer })), 'localhost');
  const mirror = await server(t, (_req, res) => { res.writeHead(302, { 'Set-Cookie': 'account=source; Path=/', Location: target }); res.end(); });
  const result = await transport(mirror).request('/', { headers: { Authorization: 'secret', Referer: mirror + '/secret' } });
  assert.deepEqual(JSON.parse(result.body), {});
  assert.equal(result.url, target + '/');
});

test('bounds redirect loops and decompressed response size', async t => {
  let redirects = 0;
  const mirror = await server(t, (req, res) => {
    if (req.url === '/bomb') { res.writeHead(200, { 'Content-Encoding': 'gzip' }); res.end(zlib.gzipSync(Buffer.alloc(9 * 1024 * 1024))); }
    else { redirects++; res.writeHead(302, { Location: '/loop' }); res.end(); }
  });
  const client = transport(mirror);
  await assert.rejects(client.request('/loop'), code('REDIRECT_LIMIT'));
  assert.ok(redirects <= 6);
  await assert.rejects(client.request('/bomb'), code('RESPONSE_TOO_LARGE'));
});

test('timeout and AbortSignal stop hanging requests', async t => {
  const mirror = await server(t, () => {});
  await assert.rejects(transport(mirror, { timeoutMs: 40 }).request('/'), code('TIMEOUT'));
  const controller = new AbortController();
  const pending = transport(mirror).request('/', { signal: controller.signal });
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(pending, code('ABORTED'));
  await assert.rejects(transport(mirror).request('/', { signal: controller.signal }), code('ABORTED'));
});

test('completes real Anubis fast protocol, retains verification cookie, and reuses admission cookie', async t => {
  let proofs = 0;
  const mirror = await server(t, (req, res) => {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname.endsWith('/api/pass-challenge')) {
      verifyProof(req, url); proofs++;
      assert.equal(url.searchParams.get('redir'), mirror + '/catalog');
      res.writeHead(302, { 'Set-Cookie': 'techaro.lol-anubis-auth=admitted; Path=/; HttpOnly', Location: '/catalog' }); res.end();
    } else if ((req.headers.cookie || '').includes('techaro.lol-anubis-auth=admitted')) res.end('real catalog');
    else { res.setHeader('Set-Cookie', `techaro.lol-anubis-cookie-verification=${challengeId}; Path=/`); res.end(challenge()); }
  });
  const client = transport(mirror);
  assert.equal((await client.request('/catalog')).body, 'real catalog');
  assert.equal((await client.request('/catalog')).body, 'real catalog');
  assert.equal(proofs, 1);
});

test('replays challenged POST once after admission and preserves its form without sending it to solver', async t => {
  let loginWrites = 0;
  const mirror = await server(t, (req, res) => {
    if (req.url.includes('/api/pass-challenge')) {
      assert.equal(req.method, 'GET'); assert.equal(req.headers['content-length'], undefined);
      verifyProof(req, new URL(req.url, mirror));
      res.writeHead(302, { 'Set-Cookie': 'techaro.lol-anubis-auth=admitted; Path=/', Location: '/' }); res.end();
    } else if ((req.headers.cookie || '').includes('techaro.lol-anubis-auth=admitted')) {
      let body = ''; req.on('data', chunk => body += chunk); req.on('end', () => { assert.equal(body, 'password=secret'); loginWrites++; res.end('account'); });
    } else { res.setHeader('Set-Cookie', `techaro.lol-anubis-cookie-verification=${challengeId}; Path=/`); res.end(challenge()); }
  });
  assert.equal((await transport(mirror).request('/login', { method: 'POST', form: { password: 'secret' } })).body, 'account');
  assert.equal(loginWrites, 1);
});

test('refreshes expired challenge instead of computing a spent proof', async t => {
  let pages = 0, proofs = 0;
  const mirror = await server(t, (req, res) => {
    if (req.url.includes('/api/pass-challenge')) { proofs++; verifyProof(req, new URL(req.url, mirror)); res.writeHead(302, { 'Set-Cookie': 'techaro.lol-anubis-auth=ok; Path=/', Location: '/' }); res.end(); }
    else if ((req.headers.cookie || '').includes('techaro.lol-anubis-auth=ok')) res.end('ok');
    else { pages++; res.setHeader('Set-Cookie', `techaro.lol-anubis-cookie-verification=${challengeId}; Path=/`); res.end(challenge(pages === 1 ? { issuedAt: '2000-01-01T00:00:00.000Z' } : {})); }
  });
  assert.equal((await transport(mirror).request('/')).body, 'ok');
  assert.equal(pages, 2); assert.equal(proofs, 1);
});

test('rejects unsupported, malformed and excessive-work challenge pages including HTTP 200', async t => {
  const bodies = [challenge({ algorithm: 'unknown' }), challenge({ version: '9.0.0' }), challenge({ difficulty: 30 }), challenge({ prefix: '//evil.example' }), '<script id="anubis_challenge" type="application/json">invalid</script>', '<html>Making sure you are not a bot!<script src="/.within.website/x/cmd/anubis/static/js/main.mjs"></script></html>'];
  const mirror = await server(t, (_req, res) => res.end(bodies.shift()));
  for (let i = 0; i < 6; i++) await assert.rejects(transport(mirror).request('/'), code('UNSUPPORTED_CHALLENGE'));
});

test('a repeated valid challenge terminates without returning challenge HTML as success', async t => {
  let proofs = 0;
  const mirror = await server(t, (req, res) => {
    if (req.url.includes('/api/pass-challenge')) { proofs++; res.writeHead(302, { Location: '/' }); res.end(); }
    else { res.setHeader('Set-Cookie', `techaro.lol-anubis-cookie-verification=${challengeId}; Path=/`); res.end(challenge()); }
  });
  await assert.rejects(transport(mirror).request('/'), code('CHALLENGE_LIMIT'));
  assert.ok(proofs <= 2);
});

test('clearing a session prevents an already running request from restoring old login cookies', async t => {
  let respond;
  const mirror = await server(t, (_req, res) => { respond = () => { res.setHeader('Set-Cookie', 'account=old; Path=/'); res.end('old account'); }; });
  const client = transport(mirror);
  const pending = client.request('/');
  while (!respond) await new Promise(resolve => setTimeout(resolve, 1));
  await client.clearSession(); respond();
  await assert.rejects(pending, code('SESSION_CHANGED'));
  assert.equal(client.jar.getCookieStringSync(mirror), '');
});

test('fresh challenge replaces a proof rejected as expired by the server', async t => {
  let proofs = 0;
  const mirror = await server(t, (req, res) => {
    if (req.url.includes('/api/pass-challenge')) {
      verifyProof(req, new URL(req.url, mirror)); proofs++;
      if (proofs === 1) { res.writeHead(400); res.end('challenge expired'); }
      else { res.writeHead(302, { 'Set-Cookie': 'techaro.lol-anubis-auth=ok; Path=/', Location: '/' }); res.end(); }
    } else if ((req.headers.cookie || '').includes('techaro.lol-anubis-auth=ok')) res.end('catalog');
    else { res.setHeader('Set-Cookie', `techaro.lol-anubis-cookie-verification=${challengeId}; Path=/`); res.end(challenge()); }
  });
  assert.equal((await transport(mirror).request('/')).body, 'catalog');
  assert.equal(proofs, 2);
});

test('refreshing an expired POST challenge does not mistake a public GET for the form result', async t => {
  let posts = 0;
  const mirror = await server(t, (req, res) => {
    if (req.method === 'GET') res.end('public home');
    else if (++posts === 1) res.end(challenge({ spent: true }));
    else res.end('actual login result');
  });
  const result = await transport(mirror).request('/login', { method: 'POST', form: { password: 'secret' } });
  assert.equal(result.body, 'actual login result');
  assert.equal(posts, 2);
});

test('abort stops ongoing proof work before a verification request is sent', async t => {
  const controller = new AbortController();
  let verificationCalls = 0;
  const mirror = await server(t, (req, res) => {
    if (req.url.includes('/api/pass-challenge')) verificationCalls++;
    res.end(challenge({ difficulty: 5 }));
    setTimeout(() => controller.abort(), 2);
  });
  await assert.rejects(transport(mirror).request('/', { signal: controller.signal }), code('ABORTED'));
  assert.equal(verificationCalls, 0);
});

test('corrupt and symlink session files are rejected without revealing their contents', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rezka-session-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'session.json'), link = path.join(dir, 'link.json');
  fs.writeFileSync(file, 'secret malformed session'); fs.symlinkSync(file, link);
  for (const sessionFile of [file, link]) assert.throws(() => new RezkaTransport({ sessionFile }), code('SESSION_STORAGE'));
});

test('decodes supported encodings and rejects damaged compression and truncated responses', async t => {
  const mirror = await server(t, (req, res) => {
    if (req.url === '/truncated') { res.writeHead(200, { 'Content-Length': 100 }); res.end('short'); }
    else if (req.url === '/bad') { res.writeHead(200, { 'Content-Encoding': 'gzip' }); res.end('bad'); }
    else { const encoding = req.url.slice(1); res.writeHead(200, { 'Content-Encoding': encoding }); res.end(({ gzip: zlib.gzipSync, deflate: zlib.deflateSync, br: zlib.brotliCompressSync })[encoding]('catalog')); }
  });
  const client = transport(mirror, { timeoutMs: 200 });
  for (const encoding of ['gzip', 'deflate', 'br']) assert.equal((await client.request('/' + encoding)).body, 'catalog');
  await assert.rejects(client.request('/bad'), code('INVALID_RESPONSE'));
  await assert.rejects(client.request('/truncated'), e => ['NETWORK_ERROR', 'TIMEOUT'].includes(e.code));
});

test('configured mirror and its scoped session survive restart with the constructor default', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rezka-mirror-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sessionFile = path.join(dir, 'session.json');
  const client = new RezkaTransport({ sessionFile });
  client.setMirror('https://rezka.ag');
  client.jar.setCookieSync('account=alternate-session; Path=/; Secure; HttpOnly', 'https://rezka.ag');
  client.saveSession();
  const restored = new RezkaTransport({ sessionFile });
  assert.equal(restored.mirror, 'https://rezka.ag');
  assert.equal(restored.jar.getCookieStringSync(restored.mirror), 'account=alternate-session');
  assert.equal(restored.jar.getCookieStringSync('https://hdrezka-home.tv'), '');
});

test('changing the mirror persists even when no later response sets cookies', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rezka-mirror-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sessionFile = path.join(dir, 'session.json');
  const client = new RezkaTransport({ sessionFile });
  client.setMirror('https://hdrezka.ag');
  assert.equal(new RezkaTransport({ sessionFile }).mirror, 'https://hdrezka.ag');
});

test('legacy jar-only files use the fallback mirror and unsafe persisted mirrors are rejected', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rezka-mirror-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sessionFile = path.join(dir, 'session.json');
  const client = new RezkaTransport();
  client.jar.setCookieSync('account=legacy; Path=/; Secure', 'https://hdrezka.ag');
  const legacy = { version: 1, jar: client.jar.serializeSync() };
  fs.writeFileSync(sessionFile, JSON.stringify(legacy));
  const restored = new RezkaTransport({ sessionFile, mirror: 'https://hdrezka.ag' });
  assert.equal(restored.mirror, 'https://hdrezka.ag');
  assert.equal(restored.jar.getCookieStringSync(restored.mirror), 'account=legacy');
  for (const mirror of ['https://evil.example', 'http://127.0.0.1', 'https://u:secret@rezka.ag', 'https://rezka.ag/login', null]) {
    fs.writeFileSync(sessionFile, JSON.stringify({ ...legacy, mirror }));
    assert.throws(() => new RezkaTransport({ sessionFile }), code('SESSION_STORAGE'));
  }
});
