'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createProvider } = require('../service/provider.cjs');
const { createFixtureProvider } = require('../scripts/fixture-provider.cjs');
const { parsePage, parseDetails, parseStreams, parseAccount, parseBookmarkLists } = require('../service/parsers.cjs');
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures/provider', `${name}.html`), 'utf8');
const mirror = 'https://rezka.ag';
const contentUrl = `${mirror}/series/drama/42-fixture.html`;
const progressDirectories = new Set();
function setup(responses, origin = mirror, providerOptions = {}) {
  const calls = [];
  const transport = { mirror: origin, clearSession: async () => {}, saveSession: async () => {}, setMirror: async value => { transport.mirror = value; }, request: async (url, options = {}) => {
    calls.push({ url, ...options });
    assert.ok(responses.length, `Unexpected request ${url}`);
    const value = responses.shift();
    if (value instanceof Error) throw value;
    return { status: 200, headers: {}, url: `${transport.mirror}${url}`, body: typeof value === 'string' ? value : JSON.stringify(value) };
  } };
  return { provider: createProvider({ transport, ...providerOptions }), calls, transport };
}
const failCode = code => error => error.code === code && typeof error.retryable === 'boolean';

test('public reads work without an account while account methods remain protected', async () => {
  const { provider } = setup([
    fixture('catalog'), fixture('catalog'), fixture('details'), fixture('details'),
    { success: true, url: '[720p]https://cdn.example.org/video.mp4' },
    ...Array(5).fill(fixture('catalog')),
  ], mirror, { progressFile: progressFile() });
  const guest = await provider.dispatch('status');
  assert.equal(guest.account, null);
  assert.deepEqual(guest.capabilities, { progress: false, episodeSync: false, watched: false });
  assert.equal((await provider.dispatch('catalog')).items[0].id, '42');
  assert.equal((await provider.dispatch('details', { url: contentUrl })).id, '42');
  assert.equal((await provider.dispatch('streams', { id: '42', url: contentUrl, translatorId: '1', season: 1, episode: 1 })).variants[0].height, 720);
  for (const [method, params] of [
    ['bookmarks', {}], ['progress', { id: '42', url: contentUrl }],
    ['saveProgress', { id: '42', url: contentUrl, translatorId: '1', season: 1, episode: 1, position: 5, duration: 100, completed: false, localOnly: true }],
    ['setEpisodeWatched', { url: contentUrl, season: 1, episode: 1, watched: true }],
    ['setBookmark', { id: '42', listId: '7', added: true }], ['continueWatching', {}],
  ]) await assert.rejects(provider.dispatch(method, params), failCode('AUTH_REQUIRED'), method);

  const local = createFixtureProvider();
  const localGuest = await local.dispatch('status');
  assert.equal(localGuest.account, null);
  assert.deepEqual(localGuest.capabilities, guest.capabilities);
  assert.equal((await local.dispatch('catalog', {})).items[0].id, '100');
  assert.equal((await local.dispatch('details', { url: 'https://hdrezka-home.tv/series/100-test.html' })).id, '100');
  assert.equal((await local.dispatch('streams', { translatorId: '1', season: 1, episode: 1 })).variants[0].height, 360);
  for (const [method, params] of [
    ['bookmarkLists', {}], ['bookmarks', {}], ['setBookmark', { id: '100', added: true }],
    ['continueWatching', {}], ['progress', { id: '100' }],
    ['saveProgress', { id: '100', position: 5 }],
    ['setEpisodeWatched', { url: 'https://hdrezka-home.tv/series/100-test.html', season: 1, episode: 1, watched: true }],
  ]) await assert.rejects(local.dispatch(method, params), error => error.code === 'AUTH_REQUIRED', method);
  assert.deepEqual(local.state.saves, []);
  assert.deepEqual(local.state.watched, {});
});

test('fixture details hides account watched flags after logout', async () => {
  const local = createFixtureProvider();
  const url = 'https://hdrezka-home.tv/series/100-test.html';
  await local.dispatch('login', { username: 'demo@example.test', password: 'demo-only' });
  await local.dispatch('setEpisodeWatched', { url, season: 1, episode: 1, watched: true });
  assert.equal((await local.dispatch('details', { url })).episodes[0].watched, true);
  await local.dispatch('logout');
  assert.equal((await local.dispatch('details', { url })).episodes[0].watched, false);
});

test('catalog parser preserves titles and finite pagination', () => {
  const page = parsePage(fixture('catalog'), mirror, 1);
  assert.equal(page.items[0].id, '42');
  assert.equal(page.items[0].title, 'Example & Story');
  assert.equal(page.items[0].type, 'series');
  assert.equal(page.items[0].url, contentUrl);
  assert.equal(page.hasMore, true);
  assert.equal(parsePage(fixture('catalog'), mirror, 2).hasMore, false);
  assert.throws(() => parsePage('<html>maintenance</html>', mirror, 1), failCode('UNSUPPORTED_PROTOCOL'));
});

test('verified account requires actual member id and server user menu; Premium badge is not inferred from local data', () => {
  assert.deepEqual(parseAccount(fixture('account')), { id: '91', name: 'Fixture User', premium: true, premiumDays: 17 });
  assert.equal(parseAccount(fixture('catalog')), null);
  assert.equal(parseAccount('<div id="main"><a href="/user/91/">comment author</a></div>'), null);
});

test('challenge, malformed JSON and success without authenticated server page never log in', async () => {
  for (const response of ['<html><title>Making sure you are not a bot!</title><script id="anubis_challenge">{}</script></html>', '<html>maintenance</html>', {}]) {
    const { provider } = setup([fixture('catalog'), response]);
    await assert.rejects(provider.dispatch('login', { username: 'fixture', password: 'fixture' }), error => ['CHALLENGE_REQUIRED','UNSUPPORTED_PROTOCOL'].includes(error.code));
  }
  const { provider } = setup([fixture('catalog'), { success: true }, fixture('catalog')]);
  await assert.rejects(provider.dispatch('login', { username: 'fixture', password: 'fixture' }), failCode('AUTH_REQUIRED'));
});

test('login validates server account before reporting success', async () => {
  const { provider, calls } = setup([fixture('catalog'), { success: true }, fixture('account')]);
  const status = await provider.dispatch('login', { username: 'fixture', password: 'fixture' });
  assert.equal(status.account.id, '91');
  assert.equal(calls[1].url, '/ajax/login/');
  assert.equal(calls[1].form.login_not_save, '0');
});

test('details parse translator and episode identity; alternate translator gets its actual episode list', async () => {
  const detail = parseDetails(fixture('details'), contentUrl, mirror);
  assert.equal(detail.id, '42');
  assert.equal(detail.selectedTranslatorId, '1');
  assert.deepEqual(detail.episodes.map(x => [x.season, x.episode]), [[1,1],[1,2]]);
  const { provider, calls } = setup([fixture('details'), { success: true, episodes: '<li class="b-simple_episode__item" data-season_id="2" data-episode_id="4">Fourth</li>', seasons: '' }]);
  const changed = await provider.dispatch('details', { url: contentUrl, translatorId: '2' });
  assert.equal(changed.selectedTranslatorId, '2');
  assert.deepEqual(changed.episodes.map(x => [x.season, x.episode]), [[2,4]]);
  assert.equal(calls[1].form.action, 'get_episodes');
});

test('metadata parser reads exact title facts and valid source ratings', () => {
  const html = fixture('details')
    .replace('<h1>Example &amp; Story</h1>', '<h1>Example &amp; Story</h1><div class="b-post__origtitle">Original Story</div>')
    .replace('<tr><td>Год:</td><td><a>2024</a></td></tr>', '<tr><td>Дата выхода:</td><td>15 сентября 2024 года</td></tr><tr><td>Страна:</td><td><a>США</a>, <a>Канада</a></td></tr><tr><td>Возраст:</td><td>18+</td></tr><tr><td>Время:</td><td>124 мин.</td></tr>')
    .replace('<a>Drama</a>', '<a>Drama</a>, <a>Adventure</a>')
    .replace('</main>', '<div class="b-post__info_rates imdb"><span class="bold">8.4</span> (12 345)</div><div class="b-post__info_rates kp"><span class="bold">7,9</span> (2 345)</div><div class="b-post__info_rates wa"><span class="bold">9.1</span> (55)</div><div class="b-post__rating"><span class="num">8.7</span> 456 оценок</div></main>');
  const details = parseDetails(html, contentUrl, mirror);
  assert.equal(details.originalTitle, 'Original Story');
  assert.equal(details.year, '2024');
  assert.equal(details.releaseDate, '15 сентября 2024 года');
  assert.deepEqual(details.countries, ['США', 'Канада']);
  assert.equal(details.ageRating, '18+');
  assert.equal(details.duration, '124 мин.');
  assert.deepEqual(details.genres, ['Drama', 'Adventure']);
  assert.deepEqual(details.ratings, [
    { source: 'IMDb', score: '8.4', votes: '12 345' },
    { source: 'Кинопоиск', score: '7,9', votes: '2 345' },
    { source: 'World Art', score: '9.1', votes: '55' },
    { source: 'HDRezka', score: '8.7', votes: '456' },
  ]);
});

test('rating parser omits malformed scores while preserving valid siblings and sparse facts', () => {
  const html = fixture('details').replace('</main>', '<div class="b-post__info_rates imdb"><span class="bold">Infinity</span> (100)</div><div class="b-post__info_rates kp"><span class="bold">7.2</span> votes unknown</div><div class="b-post__rating"><span class="num">8.0</span> (1 234)</div></main>');
  const details = parseDetails(html, contentUrl, mirror);
  assert.deepEqual(details.ratings, [
    { source: 'Кинопоиск', score: '7.2' },
    { source: 'HDRezka', score: '8.0', votes: '1 234' },
  ]);
  assert.equal(details.originalTitle, undefined);
  assert.equal(details.releaseDate, undefined);
  assert.equal(details.countries, undefined);
  assert.equal(details.ageRating, undefined);
});

test('series status comes from cover info and Continue keeps summary separate from episode progress', () => {
  const { parseContinue } = require('../service/parsers.cjs');
  const catalog = fixture('catalog').replace('<i class="cat series"></i>', '<i class="cat series"></i><div class="info">Завершен (все серии)</div>');
  assert.equal(parsePage(catalog, mirror, 1).items[0].status, 'Завершён');
  const ongoing = catalog.replace('Завершен (все серии)', 'Ожидается новая серия').replace('2024, Test country, Drama', '2022 - ..., Test country, Drama');
  assert.equal(parsePage(ongoing, mirror, 1).items[0].status, 'Выходит');
  const unknown = catalog.replace('Завершен (все серии)', 'Незавершен');
  assert.equal(parsePage(unknown, mirror, 1).items[0].status, undefined);
  const summary = fixture('continue-current').replace('(2010-2022, <b>проект завершен</b>)', '(2022 - ..., <b>проект выходит</b>)');
  const item = parseContinue(summary, 'https://hdrezka-home.tv')[0];
  assert.equal(item.meta, '(2022 - ..., проект выходит)');
  assert.equal(item.status, 'Выходит');
  assert.equal(item.progress.season, 9);
  assert.equal(item.progress.episode, 16);
  assert.equal(parseContinue(fixture('continue-current'), 'https://hdrezka-home.tv')[0].status, 'Завершён');
});

for (const { text, expected } of [
  { text: 'Сериал не завершен', expected: undefined },
  { text: '1 сезон завершен', expected: undefined },
  { text: 'Завершен (все серии)', expected: 'Завершён' },
  { text: 'проект завершен', expected: 'Завершён' },
  { text: '2022 - ...', expected: 'Выходит' },
]) test(`whole-series state requires affirmative completion: ${text}`, () => {
  const { parseContinue } = require('../service/parsers.cjs');
  const catalog = fixture('catalog').replace('<i class="cat series"></i>', `<i class="cat series"></i><div class="info">${text}</div>`);
  assert.equal(parsePage(catalog, mirror, 1).items[0].status, expected);
  const summary = fixture('continue-current').replace('проект завершен', text);
  assert.equal(parseContinue(summary, 'https://hdrezka-home.tv')[0].status, expected);
  if (!expected) {
    assert.equal(parsePage(catalog.replace('2024, Test country, Drama', '2022 - ..., Test country, Drama'), mirror, 1).items[0].status, 'Выходит');
    assert.equal(parseContinue(summary.replace('2010-2022', '2022 - ...'), 'https://hdrezka-home.tv')[0].status, 'Выходит');
  }
});

test('streams decode all provided formats including UHD, alternatives and subtitles without inventing URLs', () => {
  const clear = '[2160p HDR]https://cdn.example.org/uhd.m3u8 or https://cdn.example.org/uhd.mp4,[1080p]https://cdn.example.org/hd.mp4';
  const parsed = parseStreams({ url: '#h' + Buffer.from(clear).toString('base64'), subtitle: '[English]https://cdn.example.org/en.vtt', subtitle_lns: { English: 'en' } });
  assert.equal(parsed.variants.length, 3);
  assert.equal(parsed.variants[0].height, 2160);
  assert.equal(parsed.variants[0].hdr, 'HDR');
  assert.equal(parsed.subtitles[0].language, 'en');
  assert.throws(() => parseStreams({ url: '#hgarbage' }), failCode('UNSUPPORTED_PROTOCOL'));
  assert.throws(() => parseStreams({ url: '[720p]file:///etc/passwd' }), failCode('UNSUPPORTED_PROTOCOL'));
});

test('provider bounds input and rejects arbitrary content URLs before requesting them', async () => {
  const { provider, calls } = setup([]);
  for (const url of ['https://attacker.test/42-fixture.html', '/ajax/login/', `${mirror}/series/drama/42-fixture.html?redirect=x`]) {
    await assert.rejects(provider.dispatch('details', { url }), failCode('INVALID_INPUT'));
  }
  await assert.rejects(provider.dispatch('catalog', { page: Infinity }), failCode('INVALID_INPUT'));
  await assert.rejects(provider.dispatch('unknown', {}), failCode('UNKNOWN_METHOD'));
  assert.equal(calls.length, 0);
});

test('catalog and search build bounded encoded paths', async () => {
  const { provider, calls } = setup([fixture('catalog'), fixture('catalog')]);
  await provider.dispatch('catalog', { category: 'series', sort: 'popular', page: 2 });
  await provider.dispatch('search', { query: 'a & b', page: 3 });
  assert.equal(calls[0].url, '/series/page/2/?filter=popular');
  assert.equal(calls[1].url, '/search/?do=search&subaction=search&q=a+%26+b&page=3');
});

const favorites = (hasItem = false) => fixture('account').replace('<main id="main">', `<main id="main"><div id="user-favorites-holder"><div class="b-favorites_content__cats_list_item" data-cat_id="7"><a class="b-favorites_content__cats_list_link" href="/favorites/7/"><span class="name">Watch</span><span class="num-holder">(<b class="fb-1">13</b>)</span></a></div></div>${hasItem ? fixture('catalog').match(/<div class="b-content__inline_item"[\s\S]*?<\/div><\/div><\/div>/)[0] : ''}`);

test('bookmarks require authenticated server HTML and parse existing list ids', async () => {
  const { provider } = setup([favorites()]);
  assert.deepEqual(await provider.dispatch('bookmarkLists', {}), [{ id: '7', name: 'Watch', count: 13 }]);
  const guest = setup([fixture('catalog')]);
  await assert.rejects(guest.provider.dispatch('bookmarks', {}), failCode('AUTH_REQUIRED'));
});

test('bookmark counts support current and legacy markup without fabricating zero', () => {
  const html = fixture('account').replace('<main id="main">', '<main id="main"><div id="user-favorites-holder"><div class="b-favorites_content__cats_list_item" data-cat_id="1"><span class="name">Current</span><span class="num-holder">(<b class="fb-1">13</b>)</span></div><div class="b-favorites_content__cats_list_item" data-cat_id="2"><span class="name">Legacy</span><span class="num">7</span></div><div class="b-favorites_content__cats_list_item" data-cat_id="3"><span class="name">Missing</span></div><div class="b-favorites_content__cats_list_item" data-cat_id="4"><span class="name">Malformed</span><span class="num">13 items</span></div></div>');
  assert.deepEqual(parseBookmarkLists(html), [
    { id: '1', name: 'Current', count: 13 },
    { id: '2', name: 'Legacy', count: 7 },
    { id: '3', name: 'Missing' },
    { id: '4', name: 'Malformed' },
  ]);
});

test('bookmark endpoint toggles: repeated desired add is idempotent and mutation is read back', async () => {
  const existing = setup([favorites(true)]);
  assert.deepEqual(await existing.provider.dispatch('setBookmark', { id: '42', listId: '7', added: true }), { success: true });
  assert.equal(existing.calls.length, 1);
  const adding = setup([favorites(), { success: true }, favorites(true)]);
  assert.deepEqual(await adding.provider.dispatch('setBookmark', { id: '42', listId: '7', added: true }), { success: true });
  assert.deepEqual(adding.calls[1].form, { post_id: '42', cat_id: '7', action: 'add_post' });
  const failed = setup([favorites(), { success: true }, favorites()]);
  await assert.rejects(failed.provider.dispatch('setBookmark', { id: '42', listId: '7', added: true }), failCode('SYNC_FAILED'));
});

test('local progress cannot claim durability when no storage file is configured', async () => {
  const { provider, calls } = setup([]);
  await assert.rejects(provider.dispatch('saveProgress', { id: '42', url: contentUrl, translatorId: '1', position: 456.25, duration: 1000, completed: false }), failCode('UNSUPPORTED_PROTOCOL'));
  assert.equal(calls.length, 0);
});

test('catalog excludes sidebar suggestions when main grid exists', () => {
  const extra = '<div class="b-content__inline_item" data-id="99"><div class="b-content__inline_item-link"><a href="/films/drama/99-other.html">Other</a></div></div>';
  const result = parsePage(fixture('catalog').replace('</main>', `${extra}</main>`), mirror, 1);
  assert.deepEqual(result.items.map(item => item.id), ['42']);
});

test('details read real release-date metadata and per-episode watched flags from schedule', () => {
  const html = fixture('details').replace('Год:', 'Дата выхода:').replace('<a>2024</a>', '<a href="/year/2024/">2024 года</a>').replace('</main>', '<table class="b-post__schedule_table"><tr><td>1 сезон 2 серия</td><td>Second</td><td><i class="watch-episode-action watched" data-id="444"></i></td></tr></table></main>');
  const d = parseDetails(html, contentUrl, mirror);
  assert.equal(d.year, '2024');
  assert.equal(d.episodes[1].watched, true);
  assert.equal(d.episodes[0].watched, undefined);
});

test('continue preserves true server watched state but never fabricates unknown playback seconds', async () => {
  const row = '<div class="b-videosaves__list_item watched-row" id="videosave-888"><div class="td title"><a href="/series/drama/42-fixture.html#continue">Example</a></div><div class="td info">1 сезон 2 серия (Original)</div><span class="delete" data-id="888"></span></div>';
  const html = fixture('account').replace('</main>', `<div id="videosaves-list">${row}</div></main>`);
  const {provider} = setup([html, html, html]);
  const list = await provider.dispatch('continueWatching', {});
  assert.equal(list.items[0].progress.position, null);
  assert.equal(list.items[0].progress.completed, true);
  assert.equal(list.items[0].progress.saveId, '888');
  assert.equal(list.hasMore, false);
  assert.equal((await provider.dispatch('progress', { id:'42',url:contentUrl, season:1,episode:2 })).episode, 2);
  assert.equal(await provider.dispatch('progress', { id:'42',url:contentUrl, season:1,episode:1 }), null);
});

test('stream request uses documented page favs and flags and denies failed stream responses', async () => {
  const html = fixture('details').replace('</main>', '<input id="ctrl_favs" value="fixture-token"></main>');
  const {provider,calls} = setup([html, {success:true,url:'[720p]https://cdn.example.org/video.m3u8'}]);
  await provider.dispatch('streams', {id:'42',url:contentUrl,translatorId:'1',season:1,episode:2});
  assert.equal(calls[1].form.favs,'fixture-token');
  const rejected = setup([html,{success:false}]);
  await assert.rejects(rejected.provider.dispatch('streams',{id:'42',url:contentUrl,translatorId:'1',season:1,episode:2}),failCode('SERVER_REJECTED'));
});

test('empty known listing is valid but arbitrary page chrome is not an empty catalog', () => {
  assert.deepEqual(parsePage('<div id="main"><div class="b-content__inline_items"></div></div>',mirror,1), {items:[],page:1,hasMore:false});
  assert.throws(()=>parsePage('<div id="main">Server maintenance</div>',mirror,1),failCode('UNSUPPORTED_PROTOCOL'));
  assert.throws(()=>parsePage('',mirror,1),failCode('UNSUPPORTED_PROTOCOL'));
});

test('malformed subtitle payload produces a structured protocol error', () => {
  assert.throws(()=>parseStreams({url:'[720p]https://cdn.example.org/video.mp4',subtitle:{bad:true}}),failCode('UNSUPPORTED_PROTOCOL'));
});

test('JSON auth failures preserve AUTH_REQUIRED without returning arbitrary server messages', async () => {
  const {provider}=setup([fixture('catalog'),{success:false,message:'need_auth'}]);
  await assert.rejects(provider.dispatch('login',{username:'fixture',password:'fixture'}),failCode('AUTH_REQUIRED'));
});

test('episode-only translation accepts the site seasons:false response', async () => {
  const {provider} = setup([fixture('details'), {success:true,seasons:false,episodes:'<li class="b-simple_episode__item" data-episode_id="4">Fourth</li>'}]);
  const result=await provider.dispatch('details',{url:contentUrl,translatorId:'2'});
  assert.deepEqual(result.episodes.map(x=>[x.season,x.episode]),[[1,4]]);
});

test('documented continue hash retains translator and episode selection', async () => {
  const html=fixture('account').replace('</main>','<div id="videosaves-list"><div class="b-videosaves__list_item"><div class="title"><a href="/series/drama/42-fixture.html#t:2-s:3-e:4">Example</a></div><div class="info">3 сезон 4 серия</div></div></div></main>');
  const {provider}=setup([html,html]);
  const result=await provider.dispatch('progress',{id:'42',url:contentUrl,translatorId:'2',season:3,episode:4});
  assert.equal(result.translatorId,'2');
  assert.equal(result.position,null);
  assert.equal(await provider.dispatch('progress',{id:'42',url:contentUrl,translatorId:'1',season:3,episode:4}),null);
});

test('subtitle parser preserves VTT and converts only SRT cue timestamps', () => {
  const { subtitleText } = require('../service/parsers.cjs');
  const vtt='WEBVTT\n\n00:00:01.250 --> 00:00:03.500\nHello, world\n';
  assert.equal(subtitleText(vtt),vtt);
  assert.equal(subtitleText('\uFEFF1\r\n00:00:01,250 --> 00:00:03,500\r\nHello, world\r\n'), 'WEBVTT\n\n1\n00:00:01.250 --> 00:00:03.500\nHello, world\n');
  assert.throws(()=>subtitleText('<html>denied</html>'),failCode('UNSUPPORTED_PROTOCOL'));
});

test('subtitle retrieval only admits exact issued URLs, sends no account cookies and revokes on logout', async () => {
  const https=require('node:https'), {EventEmitter}=require('node:events');
  const original=https.get, mediaCalls=[];
  let mediaResponse={status:200,headers:{}};
  https.get=(url,options,callback)=>{
    mediaCalls.push({url:String(url),options});
    const req=new EventEmitter(); req.destroy=error=>req.emit('error',error);
    queueMicrotask(()=>{
      const res=new EventEmitter();res.statusCode=mediaResponse.status;res.headers=mediaResponse.headers;res.destroy=()=>{};
      callback(res);res.emit('data',Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nHello\n'));res.emit('end');
    });
    return req;
  };
  try {
    const url='https://cdn.example.org/captions.srt?token=fixture';
    const lookup=(_hostname,_options,callback)=>callback(null,[{address:'93.184.216.34',family:4}]);
    const {provider,calls}=setup([fixture('details'),{success:true,url:'[720p]https://cdn.example.org/video.mp4',subtitle:`[English]${url}` }],mirror,{lookup});
    await assert.rejects(provider.dispatch('subtitle',{url}),failCode('BLOCKED_URL'));
    await provider.dispatch('streams',{id:'42',url:contentUrl,translatorId:'1',season:1,episode:1});
    await assert.rejects(provider.dispatch('subtitle',{url:url.replace('fixture','changed')}),failCode('BLOCKED_URL'));
    const result=await provider.dispatch('subtitle',{url});
    assert.ok(result.text.startsWith('WEBVTT\n\n'));
    assert.equal(calls.length,2);
    assert.equal(mediaCalls.length,1);
    assert.equal(mediaCalls[0].options.rejectUnauthorized,true);
    assert.equal(Object.keys(mediaCalls[0].options.headers).some(key=>/cookie|authorization|referer/i.test(key)),false);
    mediaResponse={status:302,headers:{location:'https://unrelated.example.org/captions.vtt'}};
    await assert.rejects(provider.dispatch('subtitle',{url}),failCode('BLOCKED_URL'));
    mediaResponse={status:302,headers:{location:'/again'}};
    await assert.rejects(provider.dispatch('subtitle',{url}),failCode('REDIRECT_LIMIT'));
    mediaResponse={status:200,headers:{'content-length':String(1024*1024+1)}};
    await assert.rejects(provider.dispatch('subtitle',{url}),failCode('RESPONSE_TOO_LARGE'));
    await provider.dispatch('logout',{});
    await assert.rejects(provider.dispatch('subtitle',{url}),failCode('BLOCKED_URL'));
  } finally {https.get=original;}
});

test('subtitle retrieval rejects private or reserved DNS answers before HTTPS', async () => {
  const https=require('node:https'), {EventEmitter}=require('node:events');
  const original=https.get;let mediaCalls=0;
  https.get=(_url,_options,callback)=>{
    mediaCalls++;
    const req=new EventEmitter();req.destroy=error=>req.emit('error',error);
    queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=200;res.headers={};res.destroy=()=>{};callback(res);res.emit('data',Buffer.from('WEBVTT\n'));res.emit('end');});
    return req;
  };
  try {
    for (const addresses of [
      [{address:'127.0.0.1',family:4}],
      [{address:'172.20.0.1',family:4}],
      [{address:'::1',family:6}],
      [{address:'::192.0.2.1',family:6}],
      [{address:'64:ff9b:1::7f00:1',family:6}],
      [{address:'2001:10::1',family:6}],
      [{address:'2002:a00:1::',family:6}],
      [{address:'3fff::1',family:6}],
      [{address:'5f00::1',family:6}],
      [{address:'fec0::1',family:6}],
      [{address:'100:0:0:1::1',family:6}],
      [{address:'4000::1',family:6}],
      [{address:'6000::1',family:6}],
      [{address:'fe00::1',family:6}],
      [{address:'93.184.216.34',family:4},{address:'10.0.0.1',family:4}],
    ]) {
      const url='https://cdn.example.org/captions.vtt';
      const lookup=(_hostname,_options,callback)=>callback(null,addresses);
      const {provider}=setup([fixture('details'),{success:true,url:'[720p]https://cdn.example.org/video.mp4',subtitle:`[English]${url}`}],mirror,{lookup});
      await provider.dispatch('streams',{id:'42',url:contentUrl,translatorId:'1',season:1,episode:1});
      await assert.rejects(provider.dispatch('subtitle',{url}),failCode('BLOCKED_URL'));
    }
    assert.equal(mediaCalls,0);
  } finally {https.get=original;}
});

test('subtitle retrieval resolves once and pins the approved public address', async () => {
  const https=require('node:https'), {EventEmitter}=require('node:events');
  const original=https.get;let resolutions=0,pinned=[];
  https.get=(_url,options,callback)=>{
    options.lookup('cdn.example.org',{},(error,address,family)=>{assert.ifError(error);pinned.push({address,family});});
    options.lookup('cdn.example.org',{},(error,address,family)=>{assert.ifError(error);pinned.push({address,family});});
    const req=new EventEmitter();req.destroy=error=>req.emit('error',error);
    queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=200;res.headers={};res.destroy=()=>{};callback(res);res.emit('data',Buffer.from('WEBVTT\n'));res.emit('end');});
    return req;
  };
  try {
    const url='https://cdn.example.org/captions.vtt';
    const lookup=(_hostname,_options,callback)=>{resolutions++;callback(null,[{address:resolutions===1?'93.184.216.34':'127.0.0.1',family:4}]);};
    const {provider}=setup([fixture('details'),{success:true,url:'[720p]https://cdn.example.org/video.mp4',subtitle:`[English]${url}`}],mirror,{lookup});
    await provider.dispatch('streams',{id:'42',url:contentUrl,translatorId:'1',season:1,episode:1});
    assert.equal((await provider.dispatch('subtitle',{url})).text,'WEBVTT\n');
    assert.equal(resolutions,1);
    assert.deepEqual(pinned,[{address:'93.184.216.34',family:4},{address:'93.184.216.34',family:4}]);
  } finally {https.get=original;}
});

test('queued account changes cannot cross configure, login, logout or transport session changes', async () => {
  for (const method of ['setBookmark','setEpisodeWatched']) for (const change of ['configure', 'login', 'logout', 'transport']) {
    let release, started, firstRead=true, present=false;
    const ready=new Promise(resolve=>{started=resolve;});
    const paused=new Promise(resolve=>{release=resolve;});
    const posts=[];
    const transport={mirror,generation:1,saveSession:async()=>{},clearSession:async()=>{transport.generation++;},setMirror:async value=>{transport.mirror=value;transport.generation++;},request:async (url,options={})=>{
      const generation=transport.generation;
      if ((url.startsWith('/favorites/') || url==='/series/drama/42-fixture.html') && firstRead) {firstRead=false;started();await paused;if(generation!==transport.generation) throw Object.assign(new Error('changed'),{code:'SESSION_CHANGED',retryable:true});}
      if (url==='/ajax/favorites/' || url==='/engine/ajax/schedule_watched.php') {posts.push(transport.mirror);present=!present;}
      const body=options.method==='POST'?JSON.stringify({success:true}):url.startsWith('/favorites/')?favorites(present):url==='/series/drama/42-fixture.html'?watchedPage(present):fixture('account');
      return {status:200,headers:{},url:transport.mirror+url,body};
    }};
    const provider=createProvider({transport});
    const params=method==='setBookmark'?{id:'42',listId:'7',added:true}:{url:contentUrl,season:1,episode:1,watched:true};
    const first=provider.dispatch(method,params);
    const second=provider.dispatch(method,params);
    const results=Promise.allSettled([first,second]);
    await Promise.race([ready,results]);
    if(change==='transport') transport.generation++;
    else await provider.dispatch(change,change==='configure'?{mirror:'https://hdrezka-home.tv'}:change==='login'?{username:'fixture',password:'fixture'}:{});
    release();
    const settled=await results;
    assert.ok(settled.every(result=>result.status==='rejected' && result.reason.code==='SESSION_CHANGED'), `${method}/${change}: both queued operations must reject`);
    assert.deepEqual(posts,[],`${method}/${change}: no account writes may reach a changed session`);
  }
});

test('root GET adopts approved canonical mirror before parsing catalog and posting login', async () => {
  const canonical='https://hdrezka-home.tv';
  const origins=[];let saved=0,loggedIn=false;
  const transport={mirror:'https://hdrezka.ag',generation:1,saveSession:async()=>{saved++;},clearSession:async()=>{},setMirror:async value=>{
    if(!['https://hdrezka.ag',canonical].includes(value)) throw Object.assign(new Error('blocked'),{code:'BLOCKED_URL',retryable:false});
    transport.mirror=value;transport.generation++;
  },request:async (url,options={})=>{
    if(options.method==='POST') {origins.push(transport.mirror);loggedIn=true;}
    const body=options.method==='POST'?JSON.stringify({success:true}):loggedIn?fixture('account'):fixture('catalog').replace('/series/drama/42-fixture.html',canonical+'/series/drama/42-fixture.html');
    return {status:200,headers:{},url:canonical+url,body};
  }};
  const provider=createProvider({transport});
  const status=await provider.dispatch('status',{});
  assert.equal(status.mirror,canonical);
  assert.ok(saved>0);
  assert.equal((await provider.dispatch('catalog',{})).items[0].url,canonical+'/series/drama/42-fixture.html');
  await provider.dispatch('configure',{mirror:'https://hdrezka.ag'});
  assert.equal(transport.mirror,canonical);
  transport.mirror='https://hdrezka.ag';transport.generation++;
  await provider.dispatch('login',{username:'fixture',password:'fixture'});
  assert.deepEqual(origins,[canonical]);
});

test('canonical bootstrap rejects unapproved origins before credentials and ignores stream response origins', async () => {
  const {RezkaTransport}=require('../service/transport.cjs');
  for(const destination of ['https://unapproved.example.org/','http://hdrezka-home.tv/']) {
    const transport=new RezkaTransport({mirror:'https://hdrezka.ag'});
    let posts=0;
    transport.request=async (_path,options={})=>{if(options.method==='POST')posts++;return {status:200,headers:{},url:destination,body:fixture('catalog')};};
    await assert.rejects(createProvider({transport}).dispatch('login',{username:'fixture',password:'fixture'}),failCode('BLOCKED_URL'));
    assert.equal(transport.mirror,'https://hdrezka.ag');
    assert.equal(posts,0);
  }
  const transport=new RezkaTransport({mirror});
  transport.request=async (_path,options={})=>({status:200,headers:{},url:options.method==='POST'?'https://cdn.example.org/media.json':contentUrl,body:options.method==='POST'?JSON.stringify({success:true,url:'[720p]https://cdn.example.org/movie.mp4'}):fixture('details')});
  await createProvider({transport}).dispatch('streams',{id:'42',url:contentUrl,translatorId:'1',season:1,episode:1});
  assert.equal(transport.mirror,mirror);
});

test('current account header confirms ID plus settings and logout even without a username link', async () => {
  const expected={id:'91',name:'Пользователь HDRezka',premium:true,premiumDays:17};
  assert.deepEqual(parseAccount(fixture('account-current')),expected);
  assert.deepEqual(parseAccount(fixture('account-current').replaceAll('https://hdrezka-home.tv',''),'https://hdrezka-home.tv'),expected);
  assert.throws(()=>parseAccount(fixture('account-current'),'https://rezka.ag'),failCode('UNSUPPORTED_PROTOCOL'));
  for(const html of [fixture('account-current').replace('<a href="https://hdrezka-home.tv/logout/">Выйти</a>',''),fixture('account-current').replace('<a href="https://hdrezka-home.tv/settings/">Профиль</a>','')]) {
    assert.throws(()=>parseAccount(html),failCode('UNSUPPORTED_PROTOCOL'));
  }
  assert.equal(parseAccount(fixture('account-current').replace('value="91"','value="0"')),null);
  const {provider}=setup([fixture('account-current'),fixture('account-current'),fixture('account-current')],'https://hdrezka-home.tv');
  assert.deepEqual((await provider.dispatch('status',{})).account,expected);
  assert.deepEqual((await provider.dispatch('bookmarks',{})).items,[]);
});

test('sanitized current continue response preserves actual episode without inventing playback time', () => {
  const {parseContinue}=require('../service/parsers.cjs');
  const html=fixture('continue-current').replace('<div class="b-videosaves__list">','<div class="b-videosaves__list"><div class="b-videosaves__list_item"><div class="th">Название</div></div>');
  const account=parseAccount(html);
  assert.equal(account.id,'42');
  assert.equal(account.premium,true);
  const items=parseContinue(html,'https://hdrezka-home.tv');
  assert.equal(items.length,1);
  assert.equal(items[0].id,'100');
  assert.equal(items[0].progress.saveId,'42');
  assert.equal(items[0].progress.season,9);
  assert.equal(items[0].progress.episode,16);
  assert.equal(items[0].progress.completed,false);
  assert.equal(items[0].progress.position,null);
});

function watchedPage(watched=false) {
  return fixture('details').replace('value="0"','value="91"').replace('</div><main id="main">','<a class="b-userset__username" href="/user/91/">Fixture User</a></div><main id="main">').replace('</main>',`<table class="b-post__schedule_table"><tr><td>1 сезон 1 серия</td><td>First</td><td><i class="watch-episode-action${watched?' watched':''}" data-id="444"></i></td></tr><tr><td>1 сезон 2 серия</td><td>Second</td><td><i class="watch-episode-action" data-id="445"></i></td></tr></table></main>`);
}
const episodeChange={url:contentUrl,season:1,episode:1,watched:true};

test('episode watched mutation uses the actual schedule id and verifies its marker in a fresh page', async () => {
  const {provider,calls}=setup([watchedPage(),{success:true},watchedPage(true)]);
  assert.deepEqual(await provider.dispatch('setEpisodeWatched',episodeChange),{success:true});
  assert.deepEqual(calls.map(call=>call.url),['/series/drama/42-fixture.html','/engine/ajax/schedule_watched.php','/series/drama/42-fixture.html']);
  assert.deepEqual(calls[1].form,{id:'444'});
  const unchanged=setup([watchedPage(true)]);
  assert.deepEqual(await unchanged.provider.dispatch('setEpisodeWatched',episodeChange),{success:true});
  assert.equal(unchanged.calls.length,1);
  const repeated=setup([watchedPage(),{success:true},watchedPage(true),watchedPage(true)]);
  await Promise.all([repeated.provider.dispatch('setEpisodeWatched',episodeChange),repeated.provider.dispatch('setEpisodeWatched',episodeChange)]);
  assert.equal(repeated.calls.filter(call=>call.method==='POST').length,1);
  const remove=setup([watchedPage(true),{success:true},watchedPage()]);
  assert.deepEqual(await remove.provider.dispatch('setEpisodeWatched',{...episodeChange,watched:false}),{success:true});
});

test('episode watched mutation does not acknowledge failed, missing or unchanged server markers', async () => {
  const failed=setup([watchedPage(),{success:false}]);
  await assert.rejects(failed.provider.dispatch('setEpisodeWatched',episodeChange),failCode('SERVER_REJECTED'));
  const unverified=setup([watchedPage(),{success:true},watchedPage()]);
  await assert.rejects(unverified.provider.dispatch('setEpisodeWatched',episodeChange),failCode('SYNC_FAILED'));
  for(const html of [fixture('details'),watchedPage().replace('1 сезон 1 серия','1 сезон 8 серия'),watchedPage().replace('id="post_id" value="42"','id="post_id" value="99"')]) {
    const {provider,calls}=setup([html]);
    await assert.rejects(provider.dispatch('setEpisodeWatched',episodeChange),error=>['AUTH_REQUIRED','UNSUPPORTED_PROTOCOL'].includes(error.code));
    assert.equal(calls.length,1);
  }
  const invalid=setup([]);
  for(const params of [{...episodeChange,season:0},{...episodeChange,episode:Infinity},{...episodeChange,watched:'true'},{...episodeChange,url:'https://unapproved.example.org/series/drama/42-fixture.html'}]) {
    await assert.rejects(invalid.provider.dispatch('setEpisodeWatched',params),failCode('INVALID_INPUT'));
  }
  assert.equal(invalid.calls.length,0);
});

test('authenticated status exposes watched support without pretending a missing local store is durable', async () => {
  const {provider}=setup([fixture('account')]);
  const status=await provider.dispatch('status',{});
  assert.equal(status.capabilities.watched,true);
  assert.equal(status.capabilities.progress,false);
});

process.once('exit', () => {
  for (const dir of progressDirectories) fs.rmSync(dir, { recursive: true, force: true });
});
function progressFile() {
  const dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'rezka-progress-'));
  progressDirectories.add(dir);
  return path.join(dir,'progress.json');
}
function continuePage(season=1,episode=1,translator='1') {
  const row=season===null?'':`<div class="b-videosaves__list_item"><div class="td title"><a href="${contentUrl}#t:${translator}-s:${season}-e:${episode}">Example</a></div><div class="td info">${season} сезон ${episode} серия (Original)</div><a class="delete" data-id="88"></a></div>`;
  return fixture('account').replace('</main>',`<div id="videosaves-list">${row}</div></main>`);
}
const localSave={id:'42',url:contentUrl,translatorId:'1',season:1,episode:1,position:123.5,duration:1000,completed:false};

test('local position is durable and shared episode success requires server readback', async t=>{
  const file=progressFile(t);
  const {provider,calls}=setup([fixture('account'),continuePage(1,2),{success:true},continuePage()],mirror,{progressFile:file});
  const status=await provider.dispatch('status',{});
  assert.equal(status.capabilities.progress,true);
  assert.equal(status.capabilities.episodeSync,true);
  const saved=await provider.dispatch('saveProgress',localSave);
  assert.equal(saved.localSaved,true);assert.equal(saved.episodeSynced,true);
  assert.equal(saved.progress.positionSource,'local');assert.equal(saved.progress.position,123.5);
  assert.match(calls[2].url,/^\/ajax\/send_save\/\?t=\d+$/);
  assert.equal(calls[2].headers.Referer,contentUrl);
  assert.deepEqual(calls[2].form,{post_id:'42',translator_id:'1',season:'1',episode:'1',current_time:123.5,duration:1000});
  assert.equal(fs.statSync(file).mode&0o777,0o600);
  const restored=setup([fixture('account'),continuePage()],mirror,{progressFile:file});
  await restored.provider.dispatch('status',{});
  const value=await restored.provider.dispatch('progress',{id:'42',url:contentUrl,translatorId:'1',season:1,episode:1});
  assert.equal(value.position,123.5);assert.equal(value.positionSource,'local');
});

test('a changed server episode or voice never inherits another local position', async t=>{
  const file=progressFile(t);
  const {provider}=setup([fixture('account'),continuePage(1,2),{success:true},continuePage(),continuePage(1,2),continuePage(1,2),continuePage(1,1,'2')],mirror,{progressFile:file});
  await provider.dispatch('status',{});await provider.dispatch('saveProgress',localSave);
  const current=await provider.dispatch('continueWatching',{});
  assert.equal(current.items[0].progress.episode,2);assert.equal(current.items[0].progress.position,null);
  assert.equal((await provider.dispatch('progress',{id:'42',url:contentUrl,translatorId:'1',season:1,episode:2})).position,null);
  assert.equal((await provider.dispatch('progress',{id:'42',url:contentUrl,translatorId:'2',season:1,episode:1})).position,null);
  const account2=fixture('account').replaceAll('91','92');
  const other=setup([account2,continuePage().replaceAll('91','92')],mirror,{progressFile:file});
  await other.provider.dispatch('status',{});
  assert.equal((await other.provider.dispatch('progress',{id:'42',url:contentUrl,translatorId:'1',season:1,episode:1})).position,null);
});

test('offline server failure preserves local seconds and explicit retry saves a deliberate rewind', async t=>{
  const file=progressFile(t), offline=Object.assign(new Error('private upstream details'),{code:'NETWORK_ERROR',retryable:true});
  const {provider,calls}=setup([fixture('account'),offline,offline,continuePage(1,2),{success:true},continuePage()],mirror,{progressFile:file});
  await provider.dispatch('status',{});
  const failed=await provider.dispatch('saveProgress',localSave);
  assert.equal(failed.localSaved,true);assert.equal(failed.episodeSynced,false);assert.equal(failed.syncError.code,'NETWORK_ERROR');
  assert.equal(failed.syncError.message.includes('private upstream'),false);
  const cached=await provider.dispatch('progress',{id:'42',url:contentUrl,translatorId:'1',season:1,episode:1});
  assert.equal(cached.position,123.5);
  const retried=await provider.dispatch('saveProgress',{...localSave,position:70});
  assert.equal(retried.episodeSynced,true);assert.equal(retried.progress.position,70);
  assert.equal(calls.filter(call=>call.url.startsWith('/ajax/send_save/')).at(-1).form.current_time,70);
});

test('confirmed shared episode writes are throttled while local saves and context changes remain immediate', async t=>{
  const file=progressFile(t);
  const {provider,calls}=setup([fixture('account'),continuePage(1,2),{success:true},continuePage(),continuePage(),{success:true},continuePage(1,2),continuePage(1,2),{success:true,iterator:'minus'},continuePage(null)],mirror,{progressFile:file});
  await provider.dispatch('status',{});
  await provider.dispatch('saveProgress',localSave);
  const second=await provider.dispatch('saveProgress',{...localSave,position:160});
  assert.equal(second.progress.position,160);assert.equal(second.episodeSynced,true);
  assert.equal(calls.filter(call=>call.url.startsWith('/ajax/send_save/')).length,1);
  await provider.dispatch('saveProgress',{...localSave,episode:2,position:10});
  const completed=await provider.dispatch('saveProgress',{...localSave,episode:2,position:1000,completed:true});
  assert.equal(completed.episodeSynced,true);
  assert.equal(calls.filter(call=>call.url.startsWith('/ajax/send_save/')).length,3);
});

test('server success alone or ambiguous completion removal never claims the episode was synchronized', async t=>{
  const file=progressFile(t);
  const {provider}=setup([fixture('account'),continuePage(1,2),{success:true},continuePage(1,2),continuePage(1,2),{success:true},continuePage(null)],mirror,{progressFile:file});
  await provider.dispatch('status',{});
  const wrong=await provider.dispatch('saveProgress',localSave);
  assert.equal(wrong.localSaved,true);assert.equal(wrong.episodeSynced,false);assert.equal(wrong.syncError.code,'SYNC_FAILED');
  const absent=await provider.dispatch('saveProgress',{...localSave,position:1000,completed:true});
  assert.equal(absent.episodeSynced,false);
});

test('corrupt or unsafe local progress storage is not silently overwritten or reported saved', async t=>{
  const file=progressFile(t);fs.writeFileSync(file,'not JSON');
  const {provider,calls}=setup([fixture('account')],mirror,{progressFile:file});
  await provider.dispatch('status',{});
  await assert.rejects(provider.dispatch('saveProgress',localSave),failCode('PROGRESS_STORAGE'));
  assert.equal(fs.readFileSync(file,'utf8'),'not JSON');assert.equal(calls.length,1);
});

test('progress rejects mismatched content and invalid episode selections before reading local or remote state', async t=>{
  const {provider,calls}=setup([],mirror,{progressFile:progressFile(t)});
  for(const params of [{id:'42',url:contentUrl.replace('42-fixture','99-fixture'),translatorId:'1',season:1,episode:1},{id:'42',url:contentUrl,translatorId:'1',season:1,episode:-1}]) {
    await assert.rejects(provider.dispatch('progress',params),failCode('INVALID_INPUT'));
  }
  assert.equal(calls.length,0);
});

test('a known change to the remote episode invalidates a previous sync throttle', async t=>{
  const {provider,calls}=setup([fixture('account'),continuePage(1,2),{success:true},continuePage(),continuePage(1,2),continuePage(1,2),{success:true},continuePage()],mirror,{progressFile:progressFile(t)});
  await provider.dispatch('status',{});await provider.dispatch('saveProgress',localSave);
  await provider.dispatch('continueWatching',{});
  const result=await provider.dispatch('saveProgress',{...localSave,position:140});
  assert.equal(result.episodeSynced,true);
  assert.equal(calls.filter(call=>call.url.startsWith('/ajax/send_save/')).length,2);
});

test('queued episode sync stops after logout while all captured local positions remain saved', async t=>{
  const file=progressFile(t);const {provider,transport,calls}=setup([fixture('account')],mirror,{progressFile:file});
  await provider.dispatch('status',{});
  let started,release;const ready=new Promise(resolve=>{started=resolve;});const paused=new Promise(resolve=>{release=resolve;});
  transport.request=async (url,options)=>{calls.push({url,...options});if(url==='/continue/')return {status:200,headers:{},url:mirror+url,body:continuePage(1,2)};started();await paused;return {status:200,headers:{},url:mirror+url,body:JSON.stringify({success:true})};};
  const first=provider.dispatch('saveProgress',localSave);
  await ready;
  const second=provider.dispatch('saveProgress',{...localSave,position:150});
  await provider.dispatch('logout',{});release();
  const results=await Promise.all([first,second]);
  assert.ok(results.every(value=>value.localSaved && !value.episodeSynced && value.syncError.code==='SESSION_CHANGED'));
  assert.equal(calls.filter(call=>call.url.startsWith('/ajax/send_save/')).length,1);
  const entries=Object.entries(JSON.parse(fs.readFileSync(file,'utf8')).entries);
  assert.equal(entries[0][0],'91:42:1:1:1');assert.equal(entries[0][1].position,150);
});

test('verified local owner cannot silently survive an out-of-band transport session change', async t=>{
  const file=progressFile(t),{provider,transport,calls}=setup([fixture('account')],mirror,{progressFile:file});
  await provider.dispatch('status',{});transport.generation=10;
  await assert.rejects(provider.dispatch('saveProgress',localSave),failCode('SESSION_CHANGED'));
  assert.equal(calls.length,1);assert.equal(fs.existsSync(file),false);
});

test('an unconfirmed episode change invalidates older sync acknowledgements', async t=>{
  const failure=Object.assign(new Error('offline'),{code:'NETWORK_ERROR',retryable:true});
  const {provider,calls}=setup([fixture('account'),continuePage(1,2),{success:true},continuePage(),continuePage(),failure,continuePage(1,2),{success:true},continuePage()],mirror,{progressFile:progressFile(t)});
  await provider.dispatch('status',{});await provider.dispatch('saveProgress',localSave);
  assert.equal((await provider.dispatch('saveProgress',{...localSave,episode:2,position:5})).episodeSynced,false);
  assert.equal((await provider.dispatch('saveProgress',{...localSave,position:150})).episodeSynced,true);
  assert.equal(calls.filter(call=>call.url.startsWith('/ajax/send_save/')).length,3);
});

test('the one-minute episode throttle expires and never survives a backwards clock jump', async t=>{
  const {provider,calls}=setup([fixture('account'),continuePage(1,2),{success:true},continuePage(),continuePage(1,2),{success:true},continuePage(),continuePage(1,2),{success:true},continuePage()],mirror,{progressFile:progressFile(t)});
  await provider.dispatch('status',{});await provider.dispatch('saveProgress',localSave);
  const original=Date.now;
  try {
    Date.now=()=>original()+61000;
    await provider.dispatch('saveProgress',{...localSave,position:160});
    Date.now=()=>original()-61000;
    await provider.dispatch('saveProgress',{...localSave,position:180});
  } finally {Date.now=original;}
  assert.equal(calls.filter(call=>call.url.startsWith('/ajax/send_save/')).length,3);
});

test('local progress storage refuses symlinks and startup never replays pending server writes', async t=>{
  const file=progressFile(t), target=path.join(path.dirname(file),'target.json');
  const contents=JSON.stringify({version:1,entries:{}});fs.writeFileSync(target,contents);fs.symlinkSync(target,file);
  const unsafe=setup([fixture('account')],mirror,{progressFile:file});
  await unsafe.provider.dispatch('status',{});
  await assert.rejects(unsafe.provider.dispatch('saveProgress',localSave),failCode('PROGRESS_STORAGE'));
  assert.equal(fs.readFileSync(target,'utf8'),contents);
  fs.unlinkSync(file);
  const offline=setup([fixture('account'),Object.assign(new Error('offline'),{code:'NETWORK_ERROR'})],mirror,{progressFile:file});
  await offline.provider.dispatch('status',{});await offline.provider.dispatch('saveProgress',localSave);
  const restarted=setup([fixture('account')],mirror,{progressFile:file});
  await restarted.provider.dispatch('status',{});
  assert.equal(restarted.calls.length,1);assert.equal(restarted.calls[0].method,undefined);
});

test('server watched marks do not suppress an unfinished local rewatch position', async t=>{
  const watched=continuePage().replace('class="b-videosaves__list_item"','class="b-videosaves__list_item watched-row"');
  const {provider}=setup([fixture('account'),continuePage(1,2),{success:true},continuePage(),watched,watched],mirror,{progressFile:progressFile(t)});
  await provider.dispatch('status',{});
  await provider.dispatch('saveProgress',{...localSave,position:170,completed:false});
  const listing=(await provider.dispatch('continueWatching',{})).items[0].progress;
  const selected=await provider.dispatch('progress',{id:'42',url:contentUrl,translatorId:'1',season:1,episode:1});
  assert.deepEqual([listing,selected].map(value=>({position:value.position,completed:value.completed,source:value.positionSource})),[
    {position:170,completed:false,source:'local'},
    {position:170,completed:false,source:'local'}
  ]);
});

test('local-only recovery persists offline without server requests or changing confirmed episode throttle', async t=>{
  const file=progressFile(t),{provider,transport,calls}=setup([fixture('account'),continuePage(1,2),{success:true},continuePage()],mirror,{progressFile:file});
  await provider.dispatch('status',{});await provider.dispatch('saveProgress',localSave);
  const count=calls.length;
  transport.request=async ()=>{throw new Error('local-only recovery must not contact an offline server');};
  const recovered=await provider.dispatch('saveProgress',{...localSave,episode:2,position:170,updatedAt:new Date(Date.now()+1000).toISOString(),localOnly:true});
  assert.equal(recovered.localSaved,true);assert.equal(recovered.episodeSynced,false);assert.equal(recovered.syncError,undefined);
  assert.equal(recovered.progress.position,170);assert.equal(recovered.progress.positionSource,'local');
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).entries['91:42:1:1:2'].position,170);
  const unchanged=await provider.dispatch('saveProgress',{...localSave,position:190});
  assert.equal(unchanged.episodeSynced,true);
  assert.equal(calls.length,count);
  await assert.rejects(provider.dispatch('saveProgress',{...localSave,localOnly:'true'}),failCode('INVALID_INPUT'));
});

test('cold local-only recovery never makes an HTTP request before explicit account verification', async t=>{
  const {provider,calls}=setup([fixture('account')],mirror,{progressFile:progressFile(t)});
  await assert.rejects(provider.dispatch('saveProgress',{...localSave,localOnly:true}),failCode('AUTH_REQUIRED'));
  assert.equal(calls.length,0);
  await provider.dispatch('status',{});
  const recovered=await provider.dispatch('saveProgress',{...localSave,localOnly:true});
  assert.equal(recovered.localSaved,true);assert.equal(recovered.episodeSynced,false);
  assert.equal(calls.length,1);
});

test('send_save success:false is accepted only when authenticated readback proves the desired episode', async t=>{
  const {provider}=setup([fixture('account'),continuePage(1,2),{success:false},continuePage()],mirror,{progressFile:progressFile(t)});
  await provider.dispatch('status',{});
  const result=await provider.dispatch('saveProgress',localSave);
  assert.equal(result.episodeSynced,true);assert.equal(result.localSaved,true);
});

test('already-current shared episode is confirmed without a no-op send_save request', async t=>{
  const {provider,calls}=setup([fixture('account'),continuePage()],mirror,{progressFile:progressFile(t)});
  await provider.dispatch('status',{});
  const result=await provider.dispatch('saveProgress',localSave);
  assert.equal(result.episodeSynced,true);
  assert.equal(calls.some(call=>call.method==='POST'),false);
});

test('send_save false replies do not hide authentication, TLS, wrong readback or unproved completion removal', async t=>{
  for(const scenario of [
    {reply:{success:false},after:continuePage(1,2),code:'SERVER_REJECTED'},
    {reply:{success:false},after:fixture('catalog'),code:'AUTH_REQUIRED'},
    {reply:{success:false,iterator:'minus'},after:continuePage(null),code:'SERVER_REJECTED',completed:true},
    {reply:{success:false,message:'need_auth'},code:'AUTH_REQUIRED'},
    {reply:Object.assign(new Error('certificate failure'),{code:'TLS_ERROR'}),code:'TLS_ERROR'}
  ]) {
    const responses=[fixture('account'),continuePage(1,2),scenario.reply];
    if(scenario.after)responses.push(scenario.after);
    const {provider,calls}=setup(responses,mirror,{progressFile:progressFile(t)});
    await provider.dispatch('status',{});
    const result=await provider.dispatch('saveProgress',{...localSave,...(scenario.completed?{completed:true,position:1000}:{})});
    assert.equal(result.localSaved,true);assert.equal(result.episodeSynced,false);assert.equal(result.syncError.code,scenario.code);
    if(!scenario.after)assert.equal(calls.length,3);
  }
});

test('an unknown Continue voice cannot skip sending a newly requested translator', async t=>{
  const noVoice=continuePage().replace('#t:1-s:1-e:1','#continue');
  const {provider,calls}=setup([fixture('account'),noVoice,{success:false},noVoice],mirror,{progressFile:progressFile(t)});
  await provider.dispatch('status',{});
  const result=await provider.dispatch('saveProgress',{...localSave,translatorId:'2'});
  const writes=calls.filter(call=>call.url.startsWith('/ajax/send_save/'));
  assert.equal(writes.length,1);assert.equal(writes[0].form.translator_id,'2');
  assert.equal(result.localSaved,true);assert.equal(result.episodeSynced,true);
});

const movieUrl=mirror+'/films/drama/42-fixture.html';
test('same numeric translator with director flags produces distinct selectable source variants', async()=>{
  const detail=parseDetails(fixture('movie-variants'),movieUrl,mirror);
  assert.deepEqual(detail.translators.map(item=>item.id),['56','56~0~0~1']);
  assert.equal(detail.selectedTranslatorId,'56~0~0~1');
  assert.equal(detail.translators.filter(item=>item.id===detail.selectedTranslatorId).length,1);
  const single=parseDetails(fixture('movie-variants').replace(/<ul id="translators-list">[\s\S]*?<\/ul>/,''),movieUrl,mirror);
  assert.equal(single.selectedTranslatorId,'56~0~0~1');
  assert.equal(single.translators[0].id,'56~0~0~1');
  const {provider,calls}=setup([fixture('movie-variants'),{success:true,url:'[720p]https://cdn.example.org/movie.mp4'},fixture('movie-variants'),{success:true,url:'[720p]https://cdn.example.org/movie.mp4'}]);
  const director=await provider.dispatch('streams',{id:'42',url:movieUrl,translatorId:'56~0~0~1'});
  const standard=await provider.dispatch('streams',{id:'42',url:movieUrl,translatorId:'56'});
  assert.equal(director.translatorId,'56~0~0~1');assert.equal(standard.translatorId,'56');
  assert.equal(calls[1].form.translator_id,'56');assert.equal(calls[1].form.is_director,'1');
  assert.equal(calls[3].form.translator_id,'56');assert.equal(calls[3].form.is_director,'0');
  await assert.rejects(provider.dispatch('streams',{id:'42',url:movieUrl,translatorId:'56~0~0~2'}),failCode('INVALID_INPUT'));
  assert.equal(calls.length,4);
});

test('director and standard positions persist separately and site saves receive numeric translator ids', async t=>{
  const file=progressFile(t),movieContinue=continuePage(0,0,'56').replaceAll(contentUrl,movieUrl);
  const {provider,calls}=setup([fixture('account'),movieContinue,movieContinue,continuePage(null),{success:false},movieContinue],mirror,{progressFile:file});
  await provider.dispatch('status',{});
  const movieSave={id:'42',url:movieUrl,position:100,duration:1000,completed:false,translatorId:'56',localOnly:true};
  await provider.dispatch('saveProgress',movieSave);
  await provider.dispatch('saveProgress',{...movieSave,translatorId:'56~0~0~1',position:200});
  assert.equal((await provider.dispatch('progress',{id:'42',url:movieUrl,translatorId:'56'})).position,100);
  assert.equal((await provider.dispatch('progress',{id:'42',url:movieUrl,translatorId:'56~0~0~1'})).position,200);
  const synced=await provider.dispatch('saveProgress',{...movieSave,translatorId:'56~0~0~1',position:210,localOnly:false});
  assert.equal(synced.episodeSynced,true);
  assert.equal(calls.find(call=>call.url.startsWith('/ajax/send_save/')).form.translator_id,'56');
  const entries=JSON.parse(fs.readFileSync(file,'utf8')).entries;
  assert.equal(entries['91:42:56:0:0'].position,100);assert.equal(entries['91:42:56~0~0~1:0:0'].position,210);
  const restarted=setup([fixture('account'),movieContinue],mirror,{progressFile:file});
  await restarted.provider.dispatch('status',{});
  assert.equal((await restarted.provider.dispatch('progress',{id:'42',url:movieUrl,translatorId:'56~0~0~1'})).position,210);
});

test('actual username is read only from verified own settings and retained within the session', async()=>{
  const {parseAccountName}=require('../service/parsers.cjs');
  assert.equal(parseAccountName(fixture('account-profile'),'91','https://hdrezka-home.tv'),'Fixture.User');
  assert.throws(()=>parseAccountName(fixture('account-profile').replace('name="username_id" type="hidden" value="91"','name="username_id" type="hidden" value="92"'),'91','https://hdrezka-home.tv'),failCode('UNSUPPORTED_PROTOCOL'));
  assert.throws(()=>parseAccountName(fixture('account-profile').replace('value="91"','value="0"'),'91','https://hdrezka-home.tv'),failCode('AUTH_REQUIRED'));
  const {provider,calls}=setup([fixture('account-current'),fixture('account-profile'),fixture('account-current')],'https://hdrezka-home.tv');
  assert.equal((await provider.dispatch('status',{})).account.name,'Fixture.User');
  assert.equal((await provider.dispatch('status',{})).account.name,'Fixture.User');
  assert.deepEqual(calls.map(call=>call.url),['/','/settings/','/']);
});

test('movie Continue exposes a raw voice hint without borrowing a standard-cut position', async t=>{
  const movieContinue=continuePage(0,0,'56').replaceAll(contentUrl,movieUrl).replace('0 сезон 0 серия (Original)','(Дубляж)');
  const {provider,calls}=setup([fixture('account'),movieContinue,movieContinue,movieContinue,movieContinue],mirror,{progressFile:progressFile(t)});
  await provider.dispatch('status',{});
  const standard={id:'42',url:movieUrl,translatorId:'56',position:100,duration:1000,completed:false,localOnly:true};
  await provider.dispatch('saveProgress',standard);
  await provider.dispatch('saveProgress',{...standard,translatorId:'56~0~0~1',position:200});
  const fromContinue=(await provider.dispatch('continueWatching',{})).items[0].progress;
  const withoutVariant=await provider.dispatch('progress',{id:'42',url:movieUrl});
  for(const value of [fromContinue,withoutVariant]) {
    assert.equal(value.providerTranslatorId,'56');
    assert.equal(Object.prototype.hasOwnProperty.call(value,'translatorId'),false);
    assert.equal(value.position,null);assert.equal(value.positionSource,'unavailable');
  }
  assert.equal((await provider.dispatch('progress',{id:'42',url:movieUrl,translatorId:'56'})).position,100);
  assert.equal((await provider.dispatch('progress',{id:'42',url:movieUrl,translatorId:'56~0~0~1'})).position,200);
  assert.equal(calls.length,5);assert.equal(calls.some(call=>call.method==='POST'),false);
});

test('a series retains only its latest local episode and voice while movies and other accounts remain separate', async t=>{
  const {createProgressStore}=require('../service/progress.cjs');const file=progressFile(t),store=createProgressStore(file);
  store.set('91',{...localSave,updatedAt:'2026-09-28T08:00:00.000Z'});
  store.set('92',{...localSave,position:80,updatedAt:'2026-09-28T08:00:01.000Z'});
  store.set('91',{...localSave,id:'99',position:90,updatedAt:'2026-09-28T08:00:02.000Z'});
  const movie={id:'43',translatorId:'56',position:100,duration:1000,completed:false,updatedAt:'2026-09-28T08:00:03.000Z'};
  store.set('91',movie);store.set('91',{...movie,translatorId:'56~0~0~1',position:200});
  store.set('91',{...localSave,episode:2,position:160,updatedAt:'2026-09-28T08:00:04.000Z'});
  store.set('91',{...localSave,episode:2,translatorId:'2',position:170,updatedAt:'2026-09-28T08:00:05.000Z'});
  assert.equal(store.get('91',localSave),null);
  assert.equal(store.get('91',{...localSave,episode:2}),null);
  assert.equal(store.get('91',{...localSave,episode:2,translatorId:'2'}).position,170);
  assert.equal(store.get('92',localSave).position,80);assert.equal(store.get('91',{...localSave,id:'99'}).position,90);
  assert.equal(store.get('91',movie).position,100);assert.equal(store.get('91',{...movie,translatorId:'56~0~0~1'}).position,200);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file,'utf8')).entries).filter(key=>key.startsWith('91:42:')),['91:42:2:1:2']);
});

test('legacy series histories migrate atomically to the most recent updatedAt per account and series', t=>{
  const {createProgressStore}=require('../service/progress.cjs');const file=progressFile(t);
  const first={...localSave,updatedAt:'2026-09-28T08:00:00.000Z'};
  const latest={...localSave,translatorId:'2',episode:3,position:300,updatedAt:'2026-09-28T09:00:00.000Z'};
  const insertedLastButOlder={...localSave,episode:9,position:900,updatedAt:'2026-09-28T07:00:00.000Z'};
  const movie={id:'43',translatorId:'56',position:100,duration:1000,completed:false};
  fs.writeFileSync(file,JSON.stringify({version:1,entries:{'91:42:1:1:1':first,'91:42:2:1:3':latest,'91:42:1:1:9':insertedLastButOlder,'92:42:1:1:1':first,'91:43:56:0:0':movie,'91:43:56~0~0~1:0:0':{...movie,translatorId:'56~0~0~1',position:200}}}));
  const store=createProgressStore(file);
  assert.equal(store.get('91',first),null);assert.equal(store.get('91',latest).position,300);
  const retained=JSON.parse(fs.readFileSync(file,'utf8')).entries;
  assert.deepEqual(Object.keys(retained).filter(key=>key.startsWith('91:42:')),['91:42:2:1:3']);
  assert.equal(Object.keys(retained).length,4);assert.equal(fs.statSync(file).mode&0o777,0o600);
  const restarted=createProgressStore(file);assert.equal(restarted.get('91',insertedLastButOlder),null);assert.equal(restarted.get('91',latest).position,300);
});

test('past series episodes no longer expose local resume positions through provider progress or Continue', async t=>{
  const {provider}=setup([fixture('account'),continuePage(),continuePage(1,2),continuePage(1,2)],mirror,{progressFile:progressFile(t)});
  await provider.dispatch('status',{});
  await provider.dispatch('saveProgress',{...localSave,updatedAt:'2026-09-28T08:00:00.000Z',localOnly:true});
  await provider.dispatch('saveProgress',{...localSave,episode:2,position:220,updatedAt:'2026-09-28T08:01:00.000Z',localOnly:true});
  assert.equal((await provider.dispatch('progress',{id:'42',url:contentUrl,translatorId:'1',season:1,episode:1})).position,null);
  assert.equal((await provider.dispatch('progress',{id:'42',url:contentUrl,translatorId:'1',season:1,episode:2})).position,220);
  assert.equal((await provider.dispatch('continueWatching',{})).items[0].progress.position,220);
});

test('explicit episode zero survives voice parsing, streams and local progress while missing ids stay invalid', async t=>{
  const {parseEpisodes}=require('../service/parsers.cjs');
  const special='<li class="b-simple_episode__item" data-season_id="10" data-episode_id="0">Серия 0</li>';
  assert.deepEqual(parseEpisodes(special).map(x=>[x.season,x.episode]),[[10,0]]);
  for(const invalid of [special.replace('data-episode_id="0"','data-episode_id=""'),special.replace(' data-episode_id="0"','')])assert.throws(()=>parseEpisodes(invalid),failCode('UNSUPPORTED_PROTOCOL'));
  const {provider,calls}=setup([fixture('account'),fixture('details'),{success:true,seasons:'',episodes:special},fixture('details'),{success:true,url:'[720p]https://cdn.example.org/zero.mp4'},continuePage(10,0,'2')],mirror,{progressFile:progressFile(t)});
  await provider.dispatch('status',{});
  assert.equal((await provider.dispatch('details',{url:contentUrl,translatorId:'2'})).episodes[0].episode,0);
  assert.equal((await provider.dispatch('streams',{id:'42',url:contentUrl,translatorId:'2',season:10,episode:0})).episode,0);
  assert.equal(calls[4].form.episode,'0');
  const saved=await provider.dispatch('saveProgress',{...localSave,translatorId:'2',season:10,episode:0,localOnly:true});
  assert.equal(saved.localSaved,true);
  assert.equal((await provider.dispatch('progress',{id:'42',url:contentUrl,translatorId:'2',season:10,episode:0})).position,123.5);
  const zeroWatch=value=>watchedPage(value).replace('1 сезон 1 серия','10 сезон 0 серия');
  const marked=setup([zeroWatch(false),{success:true},zeroWatch(true)]);
  assert.equal((await marked.provider.dispatch('setEpisodeWatched',{url:contentUrl,season:10,episode:0,watched:true})).success,true);
});

test('stale or untimed local-only recovery cannot replace the current durable series record', async t=>{
  const file=progressFile(t),network=Object.assign(new Error('offline'),{code:'NETWORK_ERROR'});
  const {provider,calls}=setup([fixture('account'),network],mirror,{progressFile:file});
  await provider.dispatch('status',{});
  const latest={...localSave,episode:2,position:220,updatedAt:'2026-09-28T09:00:00.000Z',localOnly:true};
  await provider.dispatch('saveProgress',latest);
  for(const snapshot of [
    {...localSave,updatedAt:'2026-09-28T08:00:00.000Z',localOnly:true},
    {...localSave,saveId:String(Date.parse('2026-09-28T08:00:00.000Z'))+'-fixture',localOnly:true},
    {...localSave,saveId:'legacy-unknown',localOnly:true}
  ]) {
    const result=await provider.dispatch('saveProgress',snapshot);
    assert.equal(result.localSaved,true);assert.equal(result.episodeSynced,false);
    assert.equal(result.progress.episode,2);assert.equal(result.progress.position,220);
    assert.equal(result.progress.updatedAt,latest.updatedAt);
  }
  assert.equal(calls.length,1);
  const newer=await provider.dispatch('saveProgress',{...localSave,position:70,updatedAt:'2026-09-28T10:00:00.000Z',localOnly:true});
  assert.equal(newer.progress.episode,1);assert.equal(newer.progress.position,70);
  const fromSaveId=await provider.dispatch('saveProgress',{...localSave,episode:4,position:80,saveId:String(Date.parse('2026-09-28T11:00:00.000Z'))+'-fixture',localOnly:true});
  assert.equal(fromSaveId.progress.episode,4);assert.equal(fromSaveId.progress.updatedAt,'2026-09-28T11:00:00.000Z');
  await assert.rejects(provider.dispatch('saveProgress',{...localSave,updatedAt:'invalid',localOnly:true}),failCode('INVALID_INPUT'));
  const live=await provider.dispatch('saveProgress',{...localSave,episode:3,position:5,updatedAt:'2026-09-28T07:00:00.000Z'});
  assert.equal(live.localSaved,true);assert.equal(live.progress.episode,3);assert.equal(live.progress.position,5);
  assert.equal(live.progress.updatedAt,'2026-09-28T07:00:00.000Z');
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file,'utf8')).entries),['91:42:1:1:3']);
});

test('migration validates all records before deleting histories and resolves undated ties deterministically', t=>{
  const {createProgressStore}=require('../service/progress.cjs');const file=progressFile(t);
  const records={'91:42:1:1:1':{...localSave},'91:42:2:1:2':{...localSave,translatorId:'2',episode:2,position:200}};
  const invalid=JSON.stringify({version:1,entries:{...records,'92:42:1:1:1':{...localSave,position:-1}}});fs.writeFileSync(file,invalid);
  assert.throws(()=>createProgressStore(file).get('91',localSave),failCode('PROGRESS_STORAGE'));
  assert.equal(fs.readFileSync(file,'utf8'),invalid);
  fs.writeFileSync(file,JSON.stringify({version:1,entries:records}));
  const store=createProgressStore(file);assert.equal(store.get('91',localSave),null);
  assert.equal(store.get('91',{...localSave,translatorId:'2',episode:2}).position,200);
});
