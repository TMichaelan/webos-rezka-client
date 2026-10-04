'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseDetails,
  parseWatched,
  personUrl,
  parsePerson,
  parseQuickRating,
  parseTrailer,
} = require('../service/parsers.cjs');

const mirror = 'https://hdrezka-home.tv';
const detailUrl = `${mirror}/series/drama/42-example.html`;

function details(extra = '', info = '') {
  return `<!doctype html><html><head><meta property="og:type" content="video.tv_series"></head><body>
    <main id="main">
      <input id="post_id" value="42">
      <div class="b-post__title"><h1>Example &amp; Story</h1></div>
      <div class="b-sidecover"><img src="/posters/42.jpg"></div>
      <div class="b-post__description_text">Description</div>
      <table class="b-post__info">
        <tr><td>Год:</td><td><a>2025</a></td></tr>
        ${info}
      </table>
      ${extra}
    </main>
  </body></html>`;
}

function card(id, title = `Title ${id}`, path = `/series/drama/${id}-title-${id}.html`) {
  return `<div class="b-content__inline_item" data-id="${id}">
    <div class="b-content__inline_item-cover"><img src="/posters/${id}.jpg"><i class="cat ${path.startsWith('/series/') ? 'series' : 'films'}"></i></div>
    <div class="b-content__inline_item-link"><a href="${path}">${title}</a><div>2025, Drama</div></div>
  </div>`;
}

function quickRating(url, score, votes) {
  return `<div class="b-content__bubble">
    <div class="b-content__bubble_title"><a href="${url}">Title</a></div>
    <div class="b-content__bubble_rating">Рейтинг фильма: <b>${score}</b>${votes ? ` (${votes})` : ''}</div>
  </div>`;
}

test('quick rating parses validated film and series fragments', () => {
  const filmUrl = `${mirror}/films/action/757-gladiator-2000.html`;
  const seriesUrl = `${mirror}/series/horror/76-hodyachie-mertvecy-2010-latest.html`;

  assert.deepEqual(parseQuickRating(quickRating('/films/action/757-gladiator-2000.html', '6.56', '6 050'), filmUrl, mirror), {
    score: '6.56',
    votes: '6 050',
  });
  assert.deepEqual(parseQuickRating(quickRating(seriesUrl, '8.2'), seriesUrl, mirror), { score: '8.2' });
  const liveFragment = `<div class="b-content__catlabel films"></div>
    <div class="b-content__bubble_title"><a href="${filmUrl}">Gladiator</a></div>
    <div class="b-content__bubble_rating"><span>Рейтинг фильма:</span> <b>9.46</b> (10 937)</div>`;
  assert.deepEqual(parseQuickRating(liveFragment, filmUrl, mirror), { score: '9.46', votes: '10 937' });
});

test('quick rating rejects mismatched content links and malformed scores', () => {
  const expectedUrl = `${mirror}/films/action/757-gladiator-2000.html`;
  assert.throws(
    () => parseQuickRating(quickRating('/films/action/758-wrong.html', '6.56', '6 050'), expectedUrl, mirror),
    error => error?.code === 'UNSUPPORTED_PROTOCOL',
  );
  for (const score of ['', '-1', '10.01', 'Infinity', '6.5 stars']) {
    assert.throws(
      () => parseQuickRating(quickRating('/films/action/757-gladiator-2000.html', score), expectedUrl, mirror),
      error => error?.code === 'UNSUPPORTED_PROTOCOL',
    );
  }
});

test('quick rating never combines a title link and score from separate bubbles', () => {
  const expectedUrl = `${mirror}/films/action/757-gladiator-2000.html`;
  const html = `<div class="b-content__bubble">
    <div class="b-content__bubble_title"><a href="${expectedUrl}">Expected title</a></div>
  </div>
  <div class="b-content__bubble">
    <div class="b-content__bubble_rating">Рейтинг другого фильма: <b>9.9</b> (1)</div>
  </div>`;

  assert.throws(() => parseQuickRating(html, expectedUrl, mirror), error => error?.code === 'UNSUPPORTED_PROTOCOL');
});

test('details expose validated people, schedule, franchise, rankings, and trailer availability', () => {
  const html = details(`
    <div class="person-name-item" itemprop="director" data-id="7" data-photo="/people/7.jpg">
      <a itemprop="url" href="/person/7-ridley-scott/"><span itemprop="name">Ridley Scott</span></a>
    </div>
    <div class="person-name-item" itemprop="actor" data-id="8" data-photo="null">
      <a itemprop="url" href="${mirror}/person/8-performer/"><span itemprop="name">Performer</span></a>
    </div>
    <div class="person-name-item" itemprop="actor" data-id="9">
      <a itemprop="url" href="https://attacker.test/person/9-bad/"><span itemprop="name">Bad actor</span></a>
    </div>
    <div class="b-post__schedule_block"><table>
      <tr class="current-episode">
        <td class="td-1" data-id="501">2 сезон 3 серия</td>
        <td class="td-2"><b>Новый мир</b><span>New World</span></td>
        <td class="td-3"><i class="watch-episode-action watched" data-id="501"></i></td>
        <td class="td-4">4 октября 2026</td><td class="td-5">вышла вчера</td>
      </tr>
      <tr>
        <td class="td-1" data-id="502">2 сезон 4 серия</td>
        <td class="td-2"><b>Дальше</b><span>Next</span></td><td class="td-3"></td>
        <td class="td-4">11 октября 2026</td><td class="td-5">через 7 дней</td>
      </tr>
      <tr class="schedule-load-more"><td>Показать ещё</td></tr>
    </table></div>
    <div class="b-post__franchise_link_title">Гладиатор: все части</div>
    <div class="b-post__partcontent_item" data-url="/films/action/41-first.html">
      <div class="td num">1</div><div class="td title"><a>First</a></div>
      <div class="td year">2000</div><div class="td rating"><i>8.5</i></div>
    </div>
    <div class="b-post__partcontent_item current">
      <div class="td num">2</div><div class="td title"><a>Example &amp; Story</a></div>
      <div class="td year">2025</div><div class="td rating"><i>8.9</i></div>
    </div>
    <a class="b-sidelinks__link show-trailer" data-id="42">Трейлер</a>
    <a class="b-sidelinks__link show-trailer" data-id="999">Чужой трейлер</a>
  `, `<tr><td>Входит в списки:</td><td>
    <a href="/collections/best/">Лучшие фильмы</a> (12 место)
    <a href="https://attacker.test/top/">Выбор злоумышленника</a> (2 место)
    <a>Без ссылки</a> (7 место)
  </td></tr>`);

  const result = parseDetails(html, detailUrl, mirror);
  assert.deepEqual(result.directors, [{
    id: '7',
    name: 'Ridley Scott',
    url: `${mirror}/person/7-ridley-scott/`,
    photo: `${mirror}/people/7.jpg`,
  }]);
  assert.deepEqual(result.actors, [{ id: '8', name: 'Performer', url: `${mirror}/person/8-performer/` }]);
  assert.deepEqual(result.schedule, [
    {
      season: 2,
      episode: 3,
      title: 'Новый мир',
      originalTitle: 'New World',
      airDate: '4 октября 2026',
      relative: 'вышла вчера',
      state: 'aired',
      current: true,
      watched: true,
    },
    {
      season: 2,
      episode: 4,
      title: 'Дальше',
      originalTitle: 'Next',
      airDate: '11 октября 2026',
      relative: 'через 7 дней',
      state: 'upcoming',
    },
  ]);
  assert.equal(result.franchiseTitle, 'Гладиатор: все части');
  assert.deepEqual(result.parts, [
    { id: '41', url: `${mirror}/films/action/41-first.html`, title: 'First', type: 'movie', order: 1, year: '2000', rating: '8.5' },
    { id: '42', url: detailUrl, title: 'Example & Story', type: 'series', order: 2, current: true, year: '2025', rating: '8.9' },
  ]);
  assert.deepEqual(result.rankings, [
    { name: 'Лучшие фильмы', place: 12, url: `${mirror}/collections/best/` },
    { name: 'Выбор злоумышленника', place: 2 },
    { name: 'Без ссылки', place: 7 },
  ]);
  assert.equal(result.trailerAvailable, true);
  assert.deepEqual(parseWatched(html), [{ season: 2, episode: 3, watched: true, watchId: '501' }]);
});

test('malformed optional details markup is ignored without breaking the core details result', () => {
  const html = details(`
    <div class="person-name-item" itemprop="director" data-id="7"><a itemprop="url" href="/person/8-mismatch/"><span itemprop="name">Mismatch</span></a></div>
    <div class="b-post__schedule_block"><table>
      <tr><td class="td-1" data-id="bad">season soon</td></tr>
      <tr><td class="td-1" data-id="10">999999999999999999999999999999999999 сезон 1 серия</td></tr>
    </table></div>
    <div class="b-post__partcontent_item" data-url="https://attacker.test/films/1-bad.html"><div class="td num">1</div><div class="td title"><a>Bad</a></div></div>
    <a class="b-sidelinks__link show-trailer" data-id="0042">Wrong marker</a>
  `);

  const result = parseDetails(html, detailUrl, mirror);
  assert.equal(result.id, '42');
  assert.equal(result.title, 'Example & Story');
  assert.equal(result.directors, undefined);
  assert.equal(result.schedule, undefined);
  assert.equal(result.parts, undefined);
  assert.equal(result.trailerAvailable, undefined);
});

test('the shared schedule scanner preserves watched ids and caps public schedule rows', () => {
  const rows = Array.from({ length: 1001 }, (_, index) => `<tr${index === 0 ? ' class="current-episode"' : ''}>
    <td class="td-1" data-id="${index + 1}">1 сезон ${index + 1} серия</td>
    <td class="td-2"><b>Episode ${index + 1}</b></td>
    <td class="td-3"><i class="watch-episode-action${index === 0 ? ' watched' : ''}" data-id="${index + 1}"></i></td>
    <td class="td-4"></td><td class="td-5"></td>
  </tr>`).join('');
  const html = details(`<div class="b-post__schedule_block"><table><tr class="schedule-load-more"><td>Показать ещё</td></tr>${rows}</table></div>`);

  assert.deepEqual(parseWatched(html).slice(0, 2), [
    { season: 1, episode: 1, watched: true, watchId: '1' },
    { season: 1, episode: 2, watched: false, watchId: '2' },
  ]);
  const result = parseDetails(html, detailUrl, mirror);
  assert.equal(result.schedule.length, 1000);
  assert.equal(result.schedule.at(-1).episode, 1000);
});

test('details cap people and franchise parts while preserving source order', () => {
  const people = Array.from({ length: 21 }, (_, index) => `<div class="person-name-item" itemprop="${index % 2 ? 'actor' : 'director'}" data-id="${index + 1}"><a itemprop="url" href="/person/${index + 1}-person-${index + 1}/"><span itemprop="name">Person ${index + 1}</span></a></div>`).join('');
  const parts = Array.from({ length: 101 }, (_, index) => `<div class="b-post__partcontent_item" data-url="/films/action/${index + 100}-part.html"><div class="td num">${index + 1}</div><div class="td title"><a>Part ${index + 1}</a></div></div>`).join('');
  const result = parseDetails(details(people + parts), detailUrl, mirror);

  assert.equal(result.directors.length + result.actors.length, 20);
  assert.equal(result.directors[0].name, 'Person 1');
  assert.equal(result.actors.at(-1).name, 'Person 20');
  assert.equal(result.parts.length, 100);
  assert.equal(result.parts.at(-1).order, 100);
});

test('details cap optional ranking rows before they reach the TV UI', () => {
  const links = Array.from({ length: 25 }, (_, index) => `<a href="/best/${index + 1}/">List ${index + 1}</a> (${index + 1} место)`).join('');
  const result = parseDetails(details('', `<tr><td>Входит в списки:</td><td>${links}</td></tr>`), detailUrl, mirror);

  assert.equal(result.rankings.length, 20);
  assert.equal(result.rankings.at(-1).name, 'List 20');
});

test('person pages parse identity, facts, grouped careers, and reuse catalog card mapping', () => {
  const html = `<!doctype html><html><body><main id="main"><article class="b-post b-person">
    <div class="b-post__title"><div class="t1">Pedro Pascal</div><div class="t2">Pedro Pascal</div></div>
    <div class="b-sidecover"><img src="/people/77.jpg"></div>
    <table class="b-post__info"><tr><td>Дата рождения:</td><td>2 апреля 1975</td></tr><tr><td></td><td>ignored</td></tr></table>
    <section class="b-person__career"><h2>Актёр</h2><div class="b-person__career_stats">57 работ</div>${card(101, 'The Last of Us')}</section>
    <section class="b-person__career"><h2>Продюсер</h2>${card(102, 'Prospect', '/films/drama/102-prospect.html')}</section>
  </article></main></body></html>`;

  assert.equal(personUrl('/person/77-pedro-pascal/', mirror), `${mirror}/person/77-pedro-pascal/`);
  assert.throws(() => personUrl('https://attacker.test/person/77-pedro-pascal/', mirror), error => error.code === 'INVALID_INPUT');
  assert.throws(() => personUrl('/person/77-pedro-pascal/?next=x', mirror), error => error.code === 'INVALID_INPUT');
  assert.deepEqual(parsePerson(html, `${mirror}/person/77-pedro-pascal/`, mirror), {
    id: '77',
    name: 'Pedro Pascal',
    originalName: 'Pedro Pascal',
    url: `${mirror}/person/77-pedro-pascal/`,
    photo: `${mirror}/people/77.jpg`,
    facts: [{ label: 'Дата рождения', value: '2 апреля 1975' }],
    careers: [
      {
        role: 'Актёр',
        summary: '57 работ',
        items: [{ id: '101', url: `${mirror}/series/drama/101-title-101.html`, title: 'The Last of Us', poster: `${mirror}/posters/101.jpg`, meta: '2025, Drama', type: 'series' }],
      },
      {
        role: 'Продюсер',
        items: [{ id: '102', url: `${mirror}/films/drama/102-prospect.html`, title: 'Prospect', poster: `${mirror}/posters/102.jpg`, meta: '2025, Drama', type: 'movie' }],
      },
    ],
  });
});

test('person filmography is capped at 500 cards across career groups', () => {
  const first = Array.from({ length: 499 }, (_, index) => card(index + 1)).join('');
  const second = card(700) + card(701);
  const html = `<main id="main"><article class="b-post b-person"><div class="b-post__title"><div class="t1">Person</div></div><section class="b-person__career"><h2>Actor</h2>${first}</section><section class="b-person__career"><h2>Producer</h2>${second}</section></article></main>`;
  const result = parsePerson(html, `${mirror}/person/9-person/`, mirror);

  assert.equal(result.careers[0].items.length, 499);
  assert.equal(result.careers[1].items.length, 1);
  assert.equal(result.careers[1].items[0].id, '700');
});

test('person facts and career groups are bounded independently of filmography cards', () => {
  const facts = Array.from({ length: 100 }, (_, index) => `<tr><td>Fact ${index + 1}:</td><td>Value ${index + 1}</td></tr>`).join('');
  const careers = Array.from({ length: 30 }, (_, index) => `<section class="b-person__career"><h2>Role ${index + 1}</h2></section>`).join('');
  const html = `<main id="main"><article class="b-post b-person"><div class="b-post__title"><div class="t1">Person</div></div><table class="b-post__info">${facts}</table>${careers}</article></main>`;
  const result = parsePerson(html, `${mirror}/person/9-person/`, mirror);

  assert.equal(result.facts.length, 32);
  assert.equal(result.careers.length, 20);
  assert.equal(result.careers.at(-1).role, 'Role 20');
});

test('trailer parser returns only canonical HTTPS YouTube embed URLs', () => {
  assert.deepEqual(parseTrailer('<iframe src="https://www.youtube.com/embed/AbCdEf123_-?autoplay=1&amp;rel=0&amp;origin=javascript%3Aalert(1)&amp;unknown=value#ignored"></iframe>'), {
    url: 'https://www.youtube.com/embed/AbCdEf123_-?autoplay=1&rel=0',
  });
  assert.deepEqual(parseTrailer('<iframe src="https://www.youtube-nocookie.com/embed/12345678901"></iframe>'), {
    url: 'https://www.youtube-nocookie.com/embed/12345678901?autoplay=1',
  });
  assert.deepEqual(parseTrailer(`<iframe src="https://www.youtube.com/embed/12345678901?${Array.from({ length: 100 }, () => 'autoplay=1').join('&')}"></iframe>`), {
    url: 'https://www.youtube.com/embed/12345678901?autoplay=1',
  });
  assert.deepEqual(parseTrailer(`<iframe src="https://www.youtube.com/embed/12345678901?${Array.from({ length: 32 }, (_, index) => `unknown${index}=x`).join('&')}&amp;si=latevalue"></iframe>`), {
    url: 'https://www.youtube.com/embed/12345678901?autoplay=1',
  });
  assert.throws(() => parseTrailer(Array.from({ length: 16 }, () => '<iframe src="https://attacker.test/embed/12345678901"></iframe>').join('') + '<iframe src="https://www.youtube.com/embed/12345678901"></iframe>'), error => error.code === 'UNSUPPORTED_PROTOCOL');
  for (const code of [
    '<iframe src="http://www.youtube.com/embed/12345678901"></iframe>',
    '<iframe src="https://youtube.com/embed/12345678901"></iframe>',
    '<iframe src="https://www.youtube.com.evil.test/embed/12345678901"></iframe>',
    '<iframe src="https://www.youtube.com/embed/too-short"></iframe>',
    '<a href="https://www.youtube.com/embed/12345678901">not an embed</a>',
    '<iframe src="javascript:alert(1)"></iframe>',
  ]) assert.throws(() => parseTrailer(code), error => error.code === 'UNSUPPORTED_PROTOCOL');
});
