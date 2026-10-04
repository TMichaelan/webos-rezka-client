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
const filmUrl = `${mirror}/films/action/757-gladiator-2000.html`;
const youtubeSource = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0';
const youtubeUrl = youtubeSource + '&autoplay=1';
const personHtml = '<main id="main"><article class="b-post b-person"><div class="b-post__title"><div class="t1">Name</div><div class="t2">Original</div></div><div class="b-sidecover"><img src="/people/7.jpg"></div><table class="b-post__info"><tr><td>Born:</td><td>1970</td></tr></table><section class="b-person__career"><h2>Actor</h2><div class="b-person__career_stats">10 works</div><div class="b-content__inline_item" data-id="42"><div class="b-content__inline_item-cover"><img src="/poster.jpg"><i class="cat series"></i></div><div class="b-content__inline_item-link"><a href="/series/drama/42-example.html">Example</a><div>2024, Drama</div></div></div></section></article></main>';
const detailsWithTrailer = () => fixture('details').replace('</main>', '<a class="b-sidelinks__link show-trailer" data-id="42">Trailer</a></main>');
const failCode = code => error => error?.code === code && typeof error.retryable === 'boolean';
const quickRating = (url, score = '6.56', votes = '6 050') => `<div class="b-content__bubble"><div class="b-content__bubble_title"><a href="${url}">Title</a></div><div class="b-content__bubble_rating">Рейтинг фильма: <b>${score}</b>${votes ? ` (${votes})` : ''}</div></div>`;

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

test('partRatings fetches each unique part once with the exact quick-content request', async () => {
  const { provider, calls } = setup([
    quickRating('/series/drama/42-fixture.html', '8.91', '10 203'),
    quickRating(filmUrl, '6.56', '6 050'),
  ]);

  assert.deepEqual(await provider.dispatch('partRatings', { parts: [
    { id: '42', url: contentUrl },
    { id: '757', url: filmUrl },
    { id: '42', url: contentUrl },
  ] }), {
    ratings: [
      { id: '42', score: '8.91', votes: '10 203' },
      { id: '757', score: '6.56', votes: '6 050' },
    ],
  });
  assert.deepEqual(calls, [
    {
      url: '/engine/ajax/quick_content.php',
      method: 'POST',
      form: { id: '42', is_touch: '1' },
      headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: contentUrl },
    },
    {
      url: '/engine/ajax/quick_content.php',
      method: 'POST',
      form: { id: '757', is_touch: '1' },
      headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: filmUrl },
    },
  ]);
});

test('partRatings validates count and bounded numeric ids before making requests', async () => {
  const tooMany = Array.from({ length: 21 }, (_, index) => ({ id: String(index + 1), url: `${mirror}/films/action/${index + 1}-part.html` }));
  for (const parts of [undefined, [], tooMany, [{ id: '0', url: `${mirror}/films/action/0-part.html` }], [{ id: '12345678901234567', url: `${mirror}/films/action/12345678901234567-part.html` }]]) {
    const { provider, calls } = setup([]);
    await assert.rejects(provider.dispatch('partRatings', { parts }), failCode('INVALID_INPUT'));
    assert.equal(calls.length, 0);
  }
});

test('partRatings rejects hostile and mismatched URLs before making any request', async () => {
  for (const invalid of [
    { id: '42', url: 'https://attacker.test/series/drama/42-fixture.html' },
    { id: '41', url: contentUrl },
    { id: '42', url: `${contentUrl}?next=https://attacker.test/` },
  ]) {
    const { provider, calls } = setup([]);
    await assert.rejects(provider.dispatch('partRatings', { parts: [{ id: '42', url: contentUrl }, { id: '42', url: contentUrl }, invalid] }), failCode('INVALID_INPUT'));
    assert.equal(calls.length, 0);
  }
});

test('partRatings fails the whole call when one quick-content response is malformed', async () => {
  const { provider, calls } = setup([quickRating(contentUrl, '10.01')]);

  await assert.rejects(provider.dispatch('partRatings', { parts: [{ id: '42', url: contentUrl }] }), failCode('UNSUPPORTED_PROTOCOL'));
  assert.equal(calls.length, 1);
});

test('partRatings never runs more than three quick-content requests concurrently', async () => {
  const parts = Array.from({ length: 8 }, (_, index) => ({ id: String(index + 1), url: `${mirror}/series/drama/${index + 1}-part.html` }));
  let active = 0;
  let maximum = 0;
  const transport = {
    mirror,
    clearSession: async () => {},
    saveSession: async () => {},
    setMirror: async value => { transport.mirror = value; },
    request: async (_url, options) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 10));
      active--;
      const part = parts.find(item => item.id === options.form.id);
      return { status: 200, headers: {}, url: `${mirror}/engine/ajax/quick_content.php`, body: quickRating(part.url, '7.5') };
    },
  };

  const result = await createProvider({ transport }).dispatch('partRatings', { parts });

  assert.equal(result.ratings.length, parts.length);
  assert.equal(maximum, 3);
});

test('partRatings shares request slots across concurrent calls and releases them after rejection', async () => {
  const first = Array.from({ length: 3 }, (_, index) => ({ id: String(index + 1), url: `${mirror}/series/drama/${index + 1}-first.html` }));
  const second = Array.from({ length: 3 }, (_, index) => ({ id: String(index + 4), url: `${mirror}/series/drama/${index + 4}-second.html` }));
  const retry = { id: '7', url: `${mirror}/series/drama/7-retry.html` };
  const parts = [...first, ...second, retry];
  let active = 0;
  let maximum = 0;
  const transport = {
    mirror,
    clearSession: async () => {},
    saveSession: async () => {},
    setMirror: async value => { transport.mirror = value; },
    request: async (_url, options) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 10));
      active--;
      const part = parts.find(item => item.id === options.form.id);
      return { status: 200, headers: {}, url: `${mirror}/engine/ajax/quick_content.php`, body: quickRating(part.url, part.id === '2' ? '10.01' : '7.5') };
    },
  };
  const provider = createProvider({ transport });

  const results = await Promise.allSettled([
    provider.dispatch('partRatings', { parts: first }),
    provider.dispatch('partRatings', { parts: second }),
  ]);

  assert.equal(results[0].status, 'rejected');
  assert.equal(results[0].reason.code, 'UNSUPPORTED_PROTOCOL');
  assert.equal(results[1].status, 'fulfilled');
  assert.equal(maximum, 3);
  assert.deepEqual(await provider.dispatch('partRatings', { parts: [retry] }), { ratings: [{ id: '7', score: '7.5', votes: '6 050' }] });
});

test('queued partRatings requests never cross a session change', async () => {
  const activeParts = Array.from({ length: 3 }, (_, index) => ({ id: String(index + 1), url: `${mirror}/series/drama/${index + 1}-active.html` }));
  const queuedPart = { id: '4', url: `${mirror}/series/drama/4-queued.html` };
  const calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const transport = {
    mirror,
    clearSession: async () => {},
    saveSession: async () => {},
    setMirror: async value => { transport.mirror = value; },
    request: async (_url, options) => {
      calls.push(options.form.id);
      if (options.form.id !== queuedPart.id) await gate;
      const part = [...activeParts, queuedPart].find(item => item.id === options.form.id);
      return { status: 200, headers: {}, url: `${mirror}/engine/ajax/quick_content.php`, body: quickRating(part.url, '7.5') };
    },
  };
  const provider = createProvider({ transport });
  const active = provider.dispatch('partRatings', { parts: activeParts });
  const queued = provider.dispatch('partRatings', { parts: [queuedPart] });
  assert.deepEqual(calls, ['1', '2', '3']);
  await provider.dispatch('logout', {});
  const settled = Promise.allSettled([active, queued]);

  release();
  const results = await settled;

  assert.equal(results[0].status, 'rejected');
  assert.equal(results[0].reason.code, 'SESSION_CHANGED');
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[1].reason.code, 'SESSION_CHANGED');
  assert.deepEqual(calls, ['1', '2', '3']);
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

test('RPC allowlist dispatches person, trailer, and partRatings while still rejecting unknown methods', async () => {
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
  assert.deepEqual(await rpc({ method: 'partRatings', params: { parts: [{ id: '42', url: contentUrl }] } }), {
    returnValue: true,
    result: { method: 'partRatings' },
  });
  assert.deepEqual(await rpc({ method: 'unknown', params: {} }), {
    returnValue: false,
    errorCode: 'INVALID_INPUT',
    errorText: 'Проверьте введённые данные.',
    retryable: false,
  });
  assert.deepEqual(seen.map(call => call.method), ['person', 'trailer', 'partRatings']);
});
