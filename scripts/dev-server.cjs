'use strict';
const http = require('http');
const fs = require('fs');

function createDevServer({ dispatch, fixture, mediaFile }) {
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const host = req.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) { res.writeHead(403).end(); return; }
    const origin = req.headers.origin;
    if (origin && ![`http://${host}`, 'http://127.0.0.1:5173', 'http://localhost:5173'].includes(origin)) { res.writeHead(403).end(); return; }
    const url = new URL(req.url, `http://${host}`);
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    if (req.method === 'GET' && url.pathname === '/api/health') { json(200, { mode: fixture ? 'fixture' : 'live' }); return; }
    if (fixture && req.method === 'GET' && url.pathname === '/api/test/state') { json(200, fixture.state); return; }
    if (fixture && req.method === 'POST' && url.pathname === '/api/test/reset') { fixture.reset(); json(200, { ok: true }); return; }
    if (fixture && req.method === 'POST' && url.pathname === '/api/test/fail-save') { fixture.state.failSave = url.searchParams.get('value') !== 'false'; json(200, { ok: true }); return; }
    if (fixture && req.method === 'POST' && url.pathname === '/api/test/fail-episode-sync') { fixture.state.failEpisodeSync = url.searchParams.get('value') !== 'false'; json(200, { ok: true }); return; }
    if (fixture && req.method === 'GET' && url.pathname === '/api/test-video' && mediaFile) {
      const size = fs.statSync(mediaFile).size;
      const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      const start = range ? Number(range[1]) : 0;
      const end = range && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return; }
      const headers = { 'Content-Type': 'video/mp4', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' };
      if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
      res.writeHead(range ? 206 : 200, headers);
      fs.createReadStream(mediaFile, { start, end }).pipe(res);
      return;
    }
    if (req.method !== 'POST' || url.pathname !== '/api/rpc') { json(404, { error: 'Not found' }); return; }
    if (!(req.headers['content-type'] || '').startsWith('application/json')) { json(415, { error: 'JSON required' }); return; }
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 16384) { json(413, { error: 'Request too large' }); return; }
        chunks.push(chunk);
      }
      let payload;
      try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { json(400, { error: 'Invalid JSON' }); return; }
      json(200, await dispatch(payload));
    } catch { if (!res.headersSent) json(500, { returnValue: false, errorCode: 'INTERNAL_ERROR', errorText: 'Ошибка локального сервиса.', retryable: true }); }
  });
}
module.exports = { createDevServer };
