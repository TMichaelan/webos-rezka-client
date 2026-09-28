const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDevServer } = require('../scripts/dev-server.cjs');

test('development adapter accepts same-origin JSON RPC and denies cross-origin or oversized writes', async t => {
  let calls = 0;
  const server = createDevServer({ dispatch: async body => { calls++; return { returnValue: true, result: body.method }; } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (body, origin = base) => fetch(base + '/api/rpc', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body });
  assert.equal((await request('{"method":"status","params":{}}', 'https://evil.test')).status, 403);
  assert.equal((await request('x'.repeat(20000))).status, 413);
  assert.equal(calls, 0);
  assert.deepEqual(await (await request('{"method":"status","params":{}}')).json(), { returnValue: true, result: 'status' });
  assert.equal(calls, 1);
  assert.equal((await fetch(base + '/api/test/state')).status, 404);
});
