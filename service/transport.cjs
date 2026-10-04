'use strict';
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { CookieJar } = require('tough-cookie');
const { parse } = require('node-html-parser');

const DEFAULT_HOSTS = ['hdrezka-home.tv', 'hdrezka.ag', 'rezka.ag'];
const USER_AGENT = 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
const MAX_BODY = 8 * 1024 * 1024;
const MAX_SESSION = 1024 * 1024;
const ANUBIS_PATH = '/.within.website/x/cmd/anubis/api/pass-challenge';
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
function failure(code, message, retryable = false) { return Object.assign(new Error(message), { code, retryable }); }
function unsupported() { return failure('UNSUPPORTED_CHALLENGE', 'Mirror protection changed. Try another approved mirror or update the client.'); }

class RezkaTransport {
  constructor({ mirror = 'https://hdrezka-home.tv', sessionFile, timeoutMs = 20000, allowedHosts = DEFAULT_HOSTS, allowLocalhostForTests = false } = {}) {
    this.allowedHosts = new Set(allowedHosts.map(host => String(host).toLowerCase()));
    this.allowLocalhostForTests = allowLocalhostForTests === true;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120000) throw failure('INVALID_REQUEST', 'Invalid request timeout.');
    this.timeoutMs = timeoutMs;
    this.generation = 0;
    this.jar = new CookieJar();
    this.setMirror(mirror);
    if (sessionFile) {
      let fd;
      try {
        fd = fs.openSync(sessionFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        const info = fs.fstatSync(fd);
        if (!info.isFile() || info.size > MAX_SESSION) throw new Error('invalid session');
        const data = JSON.parse(fs.readFileSync(fd, 'utf8'));
        if (data.version !== 1) throw new Error('unknown session');
        if (data.mirror !== undefined) this.setMirror(data.mirror);
        this.jar = CookieJar.deserializeSync(data.jar);
        fs.fchmodSync(fd, 0o600);
      } catch (error) {
        if (error.code !== 'ENOENT') throw failure('SESSION_STORAGE', 'Stored session could not be opened. Clear the saved session and sign in again.');
      } finally { if (fd !== undefined) fs.closeSync(fd); }
    }
    // Enable writes only after restoring; the boot fallback must not overwrite saved configuration.
    this.sessionFile = sessionFile;
  }

  _url(value, base = this.mirror) {
    let url;
    try {
      if (typeof value !== 'string' || value.length > 8192 || /[\u0000-\u0020\u007f\\]/.test(value)) throw new Error('invalid URL');
      url = new URL(value, base);
    } catch (_) { throw failure('BLOCKED_URL', 'Invalid mirror address.'); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.hash || (local ? !this.allowLocalhostForTests : !this.allowedHosts.has(url.hostname)) ||
        (url.protocol !== 'https:' && !(local && this.allowLocalhostForTests && url.protocol === 'http:')) || (!local && url.port)) {
      throw failure('BLOCKED_URL', 'This address is outside the approved mirror list.');
    }
    return url;
  }

  setMirror(value) {
    const url = this._url(value);
    if (url.pathname !== '/' || url.search) throw failure('BLOCKED_URL', 'Enter a mirror origin without a path or query.');
    this.mirror = url.origin;
    this.generation++;
    this.saveSession();
  }

  clearSession() { this.generation++; this.jar.removeAllCookiesSync(); this.saveSession(); }

  saveSession() {
    if (!this.sessionFile) return;
    const temporary = this.sessionFile + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    let fd;
    try {
      const data = JSON.stringify({ version: 1, mirror: this.mirror, jar: this.jar.serializeSync() });
      if (Buffer.byteLength(data) > MAX_SESSION) throw new Error('session too large');
      fs.mkdirSync(path.dirname(this.sessionFile), { recursive: true, mode: 0o700 });
      fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, data); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(temporary, this.sessionFile);
    } catch (_) { throw failure('SESSION_STORAGE', 'The session could not be saved. Check service storage permissions.'); }
    finally {
      if (fd !== undefined) fs.closeSync(fd);
      try { fs.unlinkSync(temporary); } catch (_) { /* Already renamed or never created. */ }
    }
  }

  _check(context) {
    if (context.signal && context.signal.aborted) throw failure('ABORTED', 'Request cancelled.');
    if (context.generation !== this.generation) throw failure('SESSION_CHANGED', 'The account or mirror changed. Retry the request.', true);
    if (Date.now() >= context.deadline) throw failure('TIMEOUT', 'The mirror did not respond in time. Please retry.', true);
  }

  async request(value, { method = 'GET', form, headers = {}, signal } = {}) {
    method = String(method).toUpperCase();
    if (!['GET', 'HEAD', 'POST'].includes(method) || (form !== undefined && method !== 'POST')) throw failure('INVALID_REQUEST', 'Unsupported request method.');
    const url = this._url(value);
    if (method === 'POST' && url.origin !== this.mirror) throw failure('BLOCKED_URL', 'Account forms can only be sent to the active mirror.');
    const cleanHeaders = {};
    for (const [key, value] of Object.entries(headers)) {
      if (!/^[a-z0-9-]+$/i.test(key) || /^(cookie|host|connection|content-length|transfer-encoding|accept-encoding|proxy-.*)$/i.test(key) || typeof value !== 'string' || /[\r\n]/.test(value)) throw failure('INVALID_REQUEST', 'Unsafe request headers.');
      cleanHeaders[key.toLowerCase()] = value;
    }
    let body;
    if (form !== undefined) {
      if (!form || typeof form !== 'object' || Array.isArray(form) || Object.values(form).some(value => !['string', 'number', 'boolean'].includes(typeof value))) throw failure('INVALID_REQUEST', 'Invalid account form.');
      body = new URLSearchParams(form).toString();
      if (Buffer.byteLength(body) > 65536) throw failure('INVALID_REQUEST', 'Account form is too large.');
    }
    const context = { deadline: Date.now() + this.timeoutMs, generation: this.generation, signal };
    let result = await this._follow(url, method, body, cleanHeaders, context);
    for (let attempts = 0; ; attempts++) {
      const challenge = this._challenge(result.body);
      if (!challenge) return result;
      if (attempts >= 2) throw failure('CHALLENGE_LIMIT', 'Mirror verification did not complete. Please retry or select another mirror.', true);
      if (challenge.expired) {
        result = await this._follow(this._url(method === 'POST' ? '/' : result.url), 'GET', undefined, { 'cache-control': 'no-cache' }, context);
        if (method === 'POST' && !this._challenge(result.body)) result = await this._follow(url, method, body, cleanHeaders, context);
        continue;
      }
      const proof = await this._solve(challenge, context);
      const pass = this._url(challenge.prefix + ANUBIS_PATH, result.url);
      pass.search = new URLSearchParams({ id: challenge.id, response: proof.hash, nonce: String(proof.nonce), redir: method === 'POST' ? this.mirror + '/' : result.url, elapsedTime: String(proof.elapsedTime) }).toString();
      const answer = await this._single(pass, 'GET', undefined, { 'user-agent': cleanHeaders['user-agent'] || USER_AGENT }, context);
      if (REDIRECTS.has(answer.status) && answer.headers.location) {
        const destination = this._url(answer.headers.location, pass.href);
        if (destination.origin !== pass.origin) throw failure('BLOCKED_URL', 'Mirror verification redirected outside its origin.');
        result = await this._follow(url, method, body, cleanHeaders, context);
      } else {
        // The short-lived server challenge may expire between fetching and submitting it.
        result = await this._follow(this._url(method === 'POST' ? '/' : result.url), 'GET', undefined, { 'cache-control': 'no-cache' }, context);
        if (!this._challenge(result.body)) throw failure('CHALLENGE_FAILED', 'Mirror verification was rejected. Please retry.', true);
      }
    }
  }

  async _follow(initial, method, body, headers, context) {
    let url = initial;
    for (let redirects = 0; ; redirects++) {
      const result = await this._single(url, method, body, headers, context);
      if (!REDIRECTS.has(result.status) || !result.headers.location) return result;
      if (redirects >= 5) throw failure('REDIRECT_LIMIT', 'The mirror redirected too many times.', true);
      const next = this._url(result.headers.location, url.href);
      if (next.origin !== url.origin) {
        if (method === 'POST') throw failure('BLOCKED_URL', 'Account forms cannot follow a redirect to a different mirror. Select that mirror and sign in again.');
        headers = {};
      }
      if (result.status === 303 || ((result.status === 301 || result.status === 302) && method === 'POST')) {
        method = 'GET'; body = undefined;
        headers = Object.fromEntries(Object.entries(headers).filter(([key]) => !['content-type', 'content-length', 'origin'].includes(key)));
      }
      url = next;
    }
  }

  _single(url, method, body, headers, context) {
    this._check(context);
    const requestHeaders = { 'user-agent': USER_AGENT, accept: '*/*', 'accept-encoding': 'gzip, deflate, br', ...headers };
    const cookies = this.jar.getCookieStringSync(url.href);
    if (cookies) requestHeaders.cookie = cookies;
    if (method === 'POST') {
      requestHeaders['content-type'] = headers['content-type'] || 'application/x-www-form-urlencoded; charset=UTF-8';
      requestHeaders['content-length'] = Buffer.byteLength(body || '');
      requestHeaders.origin = url.origin;
      requestHeaders.referer = headers.referer || url.origin + '/';
    }
    return new Promise((resolve, reject) => {
      let req, response, decoded, timer, settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (context.signal) context.signal.removeEventListener('abort', abort);
        if (error) {
          if (req) req.destroy();
          if (response) response.destroy();
          if (decoded && decoded !== response) decoded.destroy();
          reject(error);
        } else resolve(result);
      };
      const abort = () => finish(failure('ABORTED', 'Request cancelled.'));
      timer = setTimeout(() => finish(failure('TIMEOUT', 'The mirror did not respond in time. Please retry.', true)), Math.max(1, context.deadline - Date.now()));
      if (context.signal) context.signal.addEventListener('abort', abort, { once: true });
      try {
        req = (url.protocol === 'https:' ? https : http).request(url, { method, headers: requestHeaders, rejectUnauthorized: true }, res => {
          response = res;
          let wireSize = 0, bodySize = 0;
          const chunks = [];
          const encoding = String(res.headers['content-encoding'] || 'identity').toLowerCase();
          if (encoding === 'identity') decoded = res;
          else if (encoding === 'gzip') decoded = zlib.createGunzip();
          else if (encoding === 'deflate') decoded = zlib.createInflate();
          else if (encoding === 'br') decoded = zlib.createBrotliDecompress();
          else return finish(failure('INVALID_RESPONSE', 'Unsupported response compression.'));
          res.on('data', chunk => { wireSize += chunk.length; if (wireSize > MAX_BODY) finish(failure('RESPONSE_TOO_LARGE', 'Mirror response exceeded the size limit.')); });
          res.on('aborted', () => finish(failure('NETWORK_ERROR', 'Mirror response was interrupted. Please retry.', true)));
          res.on('error', () => finish(failure('NETWORK_ERROR', 'Mirror response was interrupted. Please retry.', true)));
          decoded.on('error', () => finish(failure('INVALID_RESPONSE', 'The mirror returned damaged compressed data.', true)));
          decoded.on('data', chunk => {
            bodySize += chunk.length;
            if (bodySize > MAX_BODY) finish(failure('RESPONSE_TOO_LARGE', 'Mirror response exceeded the size limit.'));
            else chunks.push(chunk);
          });
          decoded.on('end', () => {
            if (settled) return;
            try {
              this._check(context);
              const cookies = res.headers['set-cookie'] || [];
              for (const cookie of cookies) this.jar.setCookieSync(cookie, url.href, { ignoreError: true });
              if (cookies.length) this.saveSession();
              finish(null, { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8'), url: url.href });
            } catch (error) { finish(error); }
          });
          if (decoded !== res) res.pipe(decoded);
        });
        req.on('error', error => finish(failure(/CERT|TLS|SSL/.test(error.code || '') ? 'TLS_ERROR' : 'NETWORK_ERROR', 'Could not securely connect to the mirror. Check your connection and mirror settings.', true)));
        req.end(body);
      } catch (_) { finish(failure('INVALID_REQUEST', 'The request could not be created.')); }
    });
  }

  _challenge(body) {
    if (!body.includes('anubis_challenge') && !body.includes('/.within.website/x/cmd/anubis/')) return null;
    try {
      const doc = parse(body);
      const json = id => {
        const nodes = doc.querySelectorAll('script#' + id);
        if (nodes.length !== 1 || nodes[0].getAttribute('type') !== 'application/json') throw unsupported();
        return JSON.parse(nodes[0].textContent);
      };
      const version = json('anubis_version');
      if (typeof version !== 'string' || !/^v?1\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version)) throw unsupported();
      const data = json('anubis_challenge'), prefix = json('anubis_base_prefix');
      const rules = data && data.rules, challenge = data && data.challenge;
      if (!rules || !challenge || rules.algorithm !== 'fast' || challenge.method !== 'fast' ||
          !Number.isInteger(rules.difficulty) || rules.difficulty < 1 || rules.difficulty > 5 || challenge.difficulty !== rules.difficulty ||
          typeof challenge.id !== 'string' || !/^[\da-f-]{36}$/i.test(challenge.id) ||
          typeof challenge.randomData !== 'string' || !/^[\da-f]{128}$/i.test(challenge.randomData) ||
          typeof challenge.spent !== 'boolean' || !Number.isFinite(Date.parse(challenge.issuedAt)) ||
          typeof prefix !== 'string' || (prefix !== '' && !/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/.test(prefix))) throw unsupported();
      return { id: challenge.id, data: challenge.randomData, difficulty: rules.difficulty, prefix, expired: challenge.spent || Date.now() - Date.parse(challenge.issuedAt) >= 30 * 60 * 1000 };
    } catch (_) { throw unsupported(); }
  }

  async _solve(challenge, context) {
    const started = Date.now(), prefix = '0'.repeat(challenge.difficulty);
    // ponytail: one cooperative SHA-256 loop; use worker threads only if measured TV latency requires them.
    for (let nonce = 0; nonce < 1000000; nonce++) {
      if (nonce % 1024 === 0) {
        await new Promise(resolve => setImmediate(resolve));
        this._check(context);
        if (Date.now() - started > 3000) break;
      }
      const hash = crypto.createHash('sha256').update(challenge.data + nonce).digest('hex');
      if (hash.startsWith(prefix)) return { hash, nonce, elapsedTime: Date.now() - started };
    }
    throw failure('CHALLENGE_LIMIT', 'Mirror verification exceeded its work limit. Please retry or select another mirror.', true);
  }
}

module.exports = { RezkaTransport };
