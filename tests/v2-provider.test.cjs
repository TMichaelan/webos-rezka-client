'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createProvider } = require('../service/provider.cjs');
const { createDispatcher } = require('../service/dispatch.cjs');

const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures/provider', `${name}.html`), 'utf8');
const mirror = 'https://rezka.ag';
const personUrl = `${mirror}/person/7-name/`;
const contentUrl = `${mirror}/series/drama/42-fixture.html`;
const youtubeSource = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0';
const youtubeUrl = youtubeSource + '&autoplay=1';
const personHtml = '<main id="main"><article class="b-post b-person"><div class="b-post__title"><div class="t1">Name</div><div class="t2">Original</div></div><div class="b-sidecover"><img src="/people/7.jpg"></div><table class="b-post__info"><tr><td>Born:</td><td>1970</td></tr></table><section class="b-person__career"><h2>Actor</h2><div class="b-person__career_stats">10 works</div><div class="b-content__inline_item" data-id="42"><div class="b-content__inline_item-cover"><img src="/poster.jpg"><i class="cat series"></i></div><div class="b-content__inline_item-link"><a href="/series/drama/42-example.html">Example</a><div>2024, Drama</div></div></div></section></article></main>';
const detailsWithTrailer = () => fixture('details').replace('</main>', '<a class="b-sidelinks__link show-trailer" data-id="42">Trailer</a></main>');
const failCode = code => error => error?.code === code && typeof error.retryable === 'boolean';

function setup(responses) {
  const calls = [];
  const transport = {
    mirror,
    clearSession: async () => {},
    saveSession: async () => {},
    setMirror: async value => { transport.mirror = value; },
    request: async (url, options = {}) => {
      calls.push({ url, ...options });
      assert.ok(responses.length, `Unexpected request ${url}`);
      const value = responses.shift();
      if (value instanceof Error) throw value;
      return {
        status: 200,
        headers: {},
        url: `${transport.mirror}${url}`,
        body: typeof value === 'string' ? value : JSON.stringify(value),
      };
    },
  };
  return { provider: createProvider({ transport }), calls };
}

test('person reads the validated canonical pathname and parses the profile', async () => {
  const { provider, calls } = setup([personHtml]);

  const result = await provider.dispatch('person', { url: personUrl });

  assert.equal(result.id, '7');
  assert.equal(result.name, 'Name');
  assert.equal(result.url, personUrl);
  assert.equal(result.careers[0].items[0].id, '42');
  assert.deepEqual(calls, [{ url: '/person/7-name/' }]);
});

test('person rejects external and malformed profile URLs before making a request', async () => {
  const invalid = [
    'https://attacker.test/person/7-name/',
    `${personUrl}?next=https://attacker.test/`,
    `${mirror}/person/not-numeric-name/`,
    contentUrl,
  ];

  for (const url of invalid) {
    const { provider, calls } = setup([]);
    await assert.rejects(provider.dispatch('person', { url }), failCode('INVALID_INPUT'));
    assert.equal(calls.length, 0);
  }
});

test('trailer rejects malformed or mismatched content identity before making a request', async () => {
  for (const params of [
    { id: 'not-numeric', url: contentUrl },
    { id: '41', url: contentUrl },
    { id: '42', url: 'https://attacker.test/series/drama/42-fixture.html' },
  ]) {
    const { provider, calls } = setup([]);
    await assert.rejects(provider.dispatch('trailer', params), failCode('INVALID_INPUT'));
    assert.equal(calls.length, 0);
  }
});

test('trailer does not POST when the content page has no trailer marker', async () => {
  const { provider, calls } = setup([fixture('details')]);

  await assert.rejects(provider.dispatch('trailer', { id: '42', url: contentUrl }), failCode('INVALID_INPUT'));

  assert.deepEqual(calls, [{ url: '/series/drama/42-fixture.html' }]);
});

test('trailer rejects a server page whose content id differs from the requested URL', async () => {
  const wrongPage = detailsWithTrailer()
    .replace('id="post_id" value="42"', 'id="post_id" value="43"')
    .replace('data-id="42">Trailer', 'data-id="43">Trailer');
  const { provider, calls } = setup([wrongPage]);

  await assert.rejects(provider.dispatch('trailer', { id: '42', url: contentUrl }), failCode('INVALID_INPUT'));

  assert.deepEqual(calls, [{ url: '/series/drama/42-fixture.html' }]);
});

test('trailer propagates parser rejection for hostile iframe hosts and paths', async () => {
  const hostileCodes = [
    '<iframe src="https://attacker.test/embed/dQw4w9WgXcQ"></iframe>',
    '<iframe src="https://www.youtube.com/watch?v=dQw4w9WgXcQ"></iframe>',
  ];

  for (const code of hostileCodes) {
    const { provider, calls } = setup([detailsWithTrailer(), { success: true, code }]);
    await assert.rejects(provider.dispatch('trailer', { id: '42', url: contentUrl }), failCode('UNSUPPORTED_PROTOCOL'));
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url, '/engine/ajax/gettrailervideo.php');
  }
});

test('trailer returns only a validated YouTube embed URL and sends the canonical referer', async () => {
  const data = {
    success: true,
    code: `<div><iframe src="${youtubeSource}" title="Server title"></iframe></div>`,
    title: '<b>Untrusted title</b>',
    description: '<script>untrusted()</script>',
  };
  const { provider, calls } = setup([detailsWithTrailer(), data]);

  assert.deepEqual(await provider.dispatch('trailer', { id: '42', url: contentUrl }), { url: youtubeUrl });
  assert.deepEqual(calls[0], { url: '/series/drama/42-fixture.html' });
  assert.equal(calls[1].url, '/engine/ajax/gettrailervideo.php');
  assert.equal(calls[1].method, 'POST');
  assert.deepEqual(calls[1].form, { id: '42' });
  assert.equal(calls[1].headers.Referer, contentUrl);
});

test('RPC allowlist dispatches person and trailer while still rejecting unknown methods', async () => {
  const seen = [];
  const rpc = createDispatcher({
    async dispatch(method, params) {
      seen.push({ method, params });
      return { method };
    },
  });

  assert.deepEqual(await rpc({ method: 'person', params: { url: personUrl } }), {
    returnValue: true,
    result: { method: 'person' },
  });
  assert.deepEqual(await rpc({ method: 'trailer', params: { id: '42', url: contentUrl } }), {
    returnValue: true,
    result: { method: 'trailer' },
  });
  assert.deepEqual(await rpc({ method: 'unknown', params: {} }), {
    returnValue: false,
    errorCode: 'INVALID_INPUT',
    errorText: 'Проверьте введённые данные.',
    retryable: false,
  });
  assert.deepEqual(seen.map(call => call.method), ['person', 'trailer']);
});
