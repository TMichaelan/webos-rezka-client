const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDispatcher } = require('../service/dispatch.cjs');

test('RPC rejects unregistered methods and malformed parameters before calling provider', async () => {
  const rpc = createDispatcher({ dispatch() { throw new Error('must not be reached'); } });
  for (const request of [null, { method: 'constructor' }, { method: 'search', params: [] }]) {
    assert.equal((await rpc(request)).returnValue, false);
    assert.equal((await rpc(request)).errorCode, 'INVALID_INPUT');
  }
});

test('RPC returns provider data and keeps unexpected error secrets out of responses', async () => {
  const rpc = createDispatcher({ async dispatch(method, params) {
    if (method === 'search') return { items: [], query: params.query };
    throw new Error('secret-cookie-and-password');
  } });
  assert.deepEqual(await rpc({ method: 'search', params: { query: 'test' } }), {
    returnValue: true, result: { items: [], query: 'test' },
  });
  const failure = await rpc({ method: 'status', params: {} });
  assert.equal(failure.returnValue, false);
  assert.equal(failure.errorCode, 'INTERNAL_ERROR');
  assert.ok(!JSON.stringify(failure).includes('secret-cookie'));
});

test('RPC exposes safe, actionable known error categories', async () => {
  const rpc = createDispatcher({ async dispatch() {
    throw Object.assign(new Error('URL with secret query'), { code: 'AUTH_REQUIRED', retryable: false });
  } });
  const failure = await rpc({ method: 'bookmarkLists', params: {} });
  assert.equal(failure.errorCode, 'AUTH_REQUIRED');
  assert.equal(failure.retryable, false);
  assert.match(failure.errorText, /Войдите/);
  assert.ok(!failure.errorText.includes('secret'));
});

test('RPC preserves explicitly public provider diagnostics but never raw error text', async () => {
  const { fail } = require('../service/parsers.cjs');
  const rpc = createDispatcher({ async dispatch() { throw fail('UNSUPPORTED_PROTOCOL', 'Сервер не подтвердил активный аккаунт.'); } });
  assert.equal((await rpc({ method: 'status', params: {} })).errorText, 'Сервер не подтвердил активный аккаунт.');
});
