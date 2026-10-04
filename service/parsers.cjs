'use strict';
const { parse } = require('node-html-parser');

function fail(code, message, retryable = false) {
  return Object.assign(new Error(message), { code, retryable, publicMessage: message });
}
const clean = node => node ? node.text.replace(/\s+/g, ' ').trim() : '';
const attr = (node, name) => node && node.getAttribute(name);
const numeric = value => /^\d+$/.test(String(value || ''));
function document(html) {
  if (typeof html !== 'string' || !html.trim() || html.length > 8 * 1024 * 1024) throw fail('UNSUPPORTED_PROTOCOL', 'Сервер вернул пустой или неизвестный ответ.');
  if (/anubis[_-]challenge|id=["']anubis_|cf-chl-|cf-browser-verification|<title>\s*(?:Just a moment|Making sure you.re not a bot)|Checking your browser/i.test(html)) throw fail('CHALLENGE_REQUIRED', 'Сервер требует проверку доступа. Повторите запрос или смените зеркало.', true);
  return parse(html);
}
function siteDocument(html) {
  const root = document(html);
  if (!root.querySelector('#main, #top-head, .b-content, .b-post__title, .b-videosaves__list, #user-favorites-holder')) throw fail('UNSUPPORTED_PROTOCOL', 'Разметка сайта не распознана.');
  return root;
}
function mediaUrl(value, mirror) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  let url;
  try { url = new URL(value, mirror); } catch { return undefined; }
  if (url.protocol !== 'https:' || url.username || url.password || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/i.test(url.hostname)) return undefined;
  return url.href;
}
function contentUrl(value, mirror, fromServer = false) {
  let url;
  try { url = new URL(value, mirror); } catch { throw fail('INVALID_INPUT', 'Некорректная ссылка на фильм.'); }
  if (url.origin !== new URL(mirror).origin || url.username || url.password || !/^\/(films|series|cartoons|animation)\/(?:[a-z0-9-]+\/)*\d+-[^/]+\.html$/i.test(url.pathname) || (!fromServer && (url.search || url.hash))) throw fail('INVALID_INPUT', 'Допустима только ссылка на фильм текущего зеркала.');
  return url.origin + url.pathname;
}
function personUrl(value, mirror, fromServer = false) {
  let url;
  try { url = new URL(value, mirror); } catch { throw fail('INVALID_INPUT', 'Некорректная ссылка на персону.'); }
  if (url.origin !== new URL(mirror).origin || url.username || url.password || !/^\/person\/[1-9]\d*-[a-z0-9-]+\/$/i.test(url.pathname) || (!fromServer && (url.search || url.hash))) throw fail('INVALID_INPUT', 'Допустима только ссылка на персону текущего зеркала.');
  return url.origin + url.pathname;
}
function parseAccount(html, mirror) {
  const root = siteDocument(html);
  const id = attr(root.querySelector('#member_user_id'), 'value');
  if (!numeric(id) || Number(id) === 0) return null;
  const links = root.querySelectorAll('#top-head a, .b-userset__username, .b-tophead__usermenu a');
  let name = clean(links.find(link => new RegExp(`/user/${id}/?(?:$|[?#])`).test(attr(link, 'href') || '')));
  const accountControls = root.querySelectorAll('#top-head a, .b-tophead__usermenu a');
  const paths = accountControls.map(link => {
    try {
      const url = new URL(attr(link, 'href') || '', mirror || 'https://relative.invalid');
      if (url.protocol !== 'https:' || url.username || url.password || (mirror && url.origin !== new URL(mirror).origin)) return '';
      return url.pathname.replace(/\/$/, '');
    } catch { return ''; }
  });
  const hasSettings = paths.includes('/settings');
  const hasLogout = paths.includes('/logout');
  if (!name && hasSettings && hasLogout) name = 'Пользователь HDRezka';
  if (!name) throw fail('UNSUPPORTED_PROTOCOL', 'Сервер не подтвердил активный аккаунт.');
  const badge = root.querySelector('.b-tophead-premuser, .b-userset__premium');
  const days = clean(badge).match(/(\d+)\s*(?:дн|день|дня)/i);
  return { id, name, premium: !!badge, ...(days ? { premiumDays: Number(days[1]) } : {}) };
}
function parseAccountName(html, expectedId, mirror) {
  const root = siteDocument(html);
  if (parseAccount(html, mirror)?.id !== expectedId) throw fail('AUTH_REQUIRED', 'Сервер не подтвердил владельца профиля.');
  const name = clean(root.querySelector('head title'));
  if (!root.querySelector('.b-user__settings') || attr(root.querySelector('input[name="username_id"]'), 'value') !== expectedId || !name || name.length > 200) throw fail('UNSUPPORTED_PROTOCOL', 'Сервер не предоставил имя владельца профиля.');
  return name;
}
function hasMore(root, page, count) {
  if (!count) return false;
  return root.querySelectorAll('.b-navigation a, .navigation a').some(a => {
    const href = attr(a, 'href') || '';
    const match = href.match(/\/page\/(\d+)\//) || href.match(/[?&]page=(\d+)/);
    return match && Number(match[1]) > page;
  });
}
function seriesStatus(value) {
  if (/(?:^|[(,;·])\s*(?:(?:сериал|проект)\s+)?заверш[её]н(?:\s*\(все серии\))?\s*(?:$|[),;·])/i.test(value)) return 'Завершён';
  if (/(?:19|20)\d{2}\s*[-–—]\s*(?:\.{3}|…)/.test(value)) return 'Выходит';
}
function parseContentCard(node, mirror) {
  const link = node.querySelector('.b-content__inline_item-link a');
  const url = contentUrl(attr(link, 'href') || attr(node, 'data-url'), mirror, true);
  const id = attr(node, 'data-id') || url.match(/\/(\d+)-[^/]+\.html$/)[1];
  const title = clean(link);
  if (!numeric(id) || !title) throw fail('UNSUPPORTED_PROTOCOL', 'Неполная карточка каталога.');
  const poster = node.querySelector('.b-content__inline_item-cover img');
  const category = attr(node.querySelector('.cat'), 'class') || '';
  const meta = clean(node.querySelector('.b-content__inline_item-link div'));
  const type = /series|serial|tv_series/.test(category) || url.includes('/series/') ? 'series' : 'movie';
  const status = type === 'series' && (seriesStatus(clean(node.querySelector('.b-content__inline_item-cover .info'))) || seriesStatus(meta));
  return { id, url, title, poster: mediaUrl(attr(poster, 'data-src') || attr(poster, 'src'), mirror), meta, type, ...(status ? { status } : {}) };
}
function parsePage(html, mirror, page) {
  const root = siteDocument(html);
  if (!root.querySelector('.b-content__inline_items, #user-favorites-holder, .b-favorites_content')) throw fail('UNSUPPORTED_PROTOCOL', 'Не удалось распознать список каталога.');
  const items = (root.querySelector('.b-content__inline_items') || root).querySelectorAll('.b-content__inline_item').map(node => parseContentCard(node, mirror));
  return { items, page, hasMore: hasMore(root, page, items.length) };
}
function parseEpisodes(html) {
  const root = document(html);
  const seen = new Set();
  return root.querySelectorAll('.b-simple_episode__item').map(node => {
    const episodeId = attr(node, 'data-episode_id');
    const episode = Number(episodeId);
    let season = Number(attr(node, 'data-season_id'));
    if (!season) season = Number((attr(node.parentNode, 'id') || '').match(/simple-episodes-list-(\d+)/)?.[1]);
    // Site exposes episode-only cartoons without seasons; their single season is 1.
    if (!season && !root.querySelector('.b-simple_season__item')) season = 1;
    if (!Number.isInteger(season) || season < 1 || !numeric(episodeId) || !Number.isInteger(episode) || episode < 0) throw fail('UNSUPPORTED_PROTOCOL', 'Не распознаны номера серий.');
    return { season, episode, title: clean(node) };
  }).filter(item => { const key = `${item.season}:${item.episode}`; if (seen.has(key)) return false; seen.add(key); return true; });
}
function scanSchedule(root) {
  const episodes = [];
  for (const row of root.querySelectorAll('.b-post__schedule_block tr, .b-post__schedule_table tr')) {
    if (episodes.length >= 1000) break;
    const identity = row.querySelector('.td-1[data-id]');
    const control = row.querySelector('.td-3 .watch-episode-action, .watch-episode-action');
    const rowId = attr(identity, 'data-id');
    const watchId = attr(control, 'data-id') || rowId;
    const match = clean(identity || row.querySelector('td')).match(/(\d+)\s*сезон\s*(\d+)\s*сери/i);
    if (!match || (identity ? !numeric(rowId) : !numeric(watchId))) continue;
    const season = Number(match[1]), episode = Number(match[2]);
    if (!Number.isSafeInteger(season) || season < 1 || !Number.isSafeInteger(episode) || episode < 0) continue;
    const title = clean(row.querySelector('.td-2 b')) || undefined;
    const originalTitle = clean(row.querySelector('.td-2 span')) || undefined;
    const airDate = clean(row.querySelector('.td-4')) || undefined;
    const relative = clean(row.querySelector('.td-5')) || undefined;
    episodes.push({
      season, episode, title, originalTitle, airDate, relative,
      state: control ? 'aired' : 'upcoming', current: row.classList.contains('current-episode') || undefined,
      watched: control ? control.classList.contains('watched') : undefined, watchId,
    });
  }
  return episodes;
}
function parseWatched(html) {
  return scanSchedule(document(html)).flatMap(({ season, episode, watched, watchId }) => typeof watched === 'boolean' && numeric(watchId) ? [{ season, episode, watched, watchId }] : []);
}
function applyWatched(episodes, html) {
  const watched = parseWatched(html);
  return episodes.map(episode => {
    const found = watched.find(row => row.season === episode.season && row.episode === episode.episode);
    return found ? { ...episode, watched: found.watched } : episode;
  });
}
function translatorSelection(value) {
  const match = typeof value === 'string' && value.match(/^(\d{1,16})(?:~([01])~([01])~([01]))?$/);
  if (!match || Number(match[1]) <= 0) throw fail('INVALID_INPUT', 'Некорректная озвучка.');
  return { providerId: match[1], flags: { is_camrip: match[2] || '0', is_ads: match[3] || '0', is_director: match[4] || '0' } };
}
function translatorKey(providerId, camrip = '0', ads = '0', director = '0') {
  const flags = [camrip, ads, director];
  if (!numeric(providerId) || flags.some(value => value !== '0' && value !== '1')) throw fail('UNSUPPORTED_PROTOCOL', 'Сервер предоставил неизвестный вариант озвучки.');
  return flags.some(value => value === '1') ? [providerId, ...flags].join('~') : providerId;
}
function nodeTranslatorKey(node) {
  return translatorKey(attr(node, 'data-translator_id'), attr(node, 'data-camrip') || '0', attr(node, 'data-ads') || attr(node, 'data-ad') || '0', attr(node, 'data-director') || '0');
}
function parseRating(node, scoreSelector, source) {
  const score = clean(node?.querySelector(scoreSelector));
  if (!/^\d+(?:[.,]\d+)?$/.test(score) || !Number.isFinite(Number(score.replace(',', '.')))) return;
  const rest = clean(node).replace(score, '').trim();
  const votes = (rest.match(/\((\d[\d ]*)\)/) || rest.match(/^(\d[\d ]*)(?=\s*(?:оценок|голосов|votes?|$))/i))?.[1]?.trim();
  return { source, score, ...(votes ? { votes } : {}) };
}
function optionalSiteUrl(value, mirror) {
  if (typeof value !== 'string' || !value.trim()) return;
  try {
    const url = new URL(value, mirror);
    if (url.origin !== new URL(mirror).origin || url.username || url.password) return;
    return url.origin + url.pathname + url.search;
  } catch { return; }
}
function parsePeople(root, mirror) {
  const people = [];
  for (const node of root.querySelectorAll('.person-name-item')) {
    if (people.length >= 20) break;
    const role = attr(node, 'itemprop');
    if (role !== 'director' && role !== 'actor') continue;
    try {
      const link = node.querySelector('a[itemprop="url"]');
      const url = personUrl(attr(link, 'href'), mirror, true);
      const id = attr(node, 'data-id');
      const urlId = url.match(/\/person\/(\d+)-/)[1];
      const name = clean(link?.querySelector('[itemprop="name"]'));
      if (!numeric(id) || id !== urlId || !name) continue;
      const rawPhoto = attr(node, 'data-photo');
      const photo = rawPhoto && rawPhoto !== 'null' ? mediaUrl(rawPhoto, mirror) : undefined;
      people.push({ role, person: { id, name, url, ...(photo ? { photo } : {}) } });
    } catch { /* Supplementary people must not invalidate core details. */ }
  }
  return {
    directors: people.filter(item => item.role === 'director').map(item => item.person),
    actors: people.filter(item => item.role === 'actor').map(item => item.person),
  };
}
function parseParts(root, current) {
  const parts = [];
  for (const node of root.querySelectorAll('.b-post__partcontent_item')) {
    if (parts.length >= 100) break;
    try {
      const number = clean(node.querySelector('.td.num')).match(/^(\d+)\.?$/)?.[1];
      const order = Number(number);
      const titleCell = node.querySelector('.td.title');
      const link = titleCell?.querySelector('a');
      const title = clean(link || titleCell);
      if (!Number.isSafeInteger(order) || order < 1 || !title) continue;
      const isCurrent = node.classList.contains('current') || !!node.querySelector('.current');
      let id = current.id, url = current.url, type = current.type;
      if (!isCurrent) {
        url = contentUrl(attr(node, 'data-url') || attr(titleCell, 'data-url') || attr(link, 'href'), current.mirror, true);
        id = url.match(/\/(\d+)-[^/]+\.html$/)[1];
        type = url.includes('/series/') ? 'series' : 'movie';
      }
      const year = clean(node.querySelector('.td.year')) || undefined;
      const rating = clean(node.querySelector('.td.rating i')) || undefined;
      parts.push({ id, url, title, type, order, ...(isCurrent ? { current: true } : {}), ...(year ? { year } : {}), ...(rating ? { rating } : {}) });
    } catch { /* Supplementary franchise data is optional. */ }
  }
  return parts;
}
function rankingPlace(link) {
  const own = clean(link).match(/\((\d+)\s*место\)/i)?.[1];
  if (own) return Number(own);
  let text = '';
  for (let node = link.nextSibling; node && node.tagName !== 'A'; node = node.nextSibling) text += ` ${clean(node)}`;
  const match = text.match(/\((\d+)\s*место\)/i);
  return match ? Number(match[1]) : undefined;
}
function parseRankings(field, mirror) {
  if (!field) return [];
  return field.querySelectorAll('a').slice(0, 20).flatMap(link => {
    const name = clean(link).replace(/\s*\(\d+\s*место\)\s*$/i, '');
    if (!name) return [];
    const place = rankingPlace(link);
    const url = optionalSiteUrl(attr(link, 'href'), mirror);
    return [{ name, ...(place === undefined ? {} : { place }), ...(url ? { url } : {}) }];
  });
}
function parseDetails(html, url, mirror) {
  const root = siteDocument(html);
  const id = attr(root.querySelector('#post_id'), 'value') || attr(root.querySelector('#user-favorites-holder, .b-userset__fav_holder_data'), 'data-post_id');
  const title = clean(root.querySelector('.b-post__title h1, .b-post__title'));
  if (!numeric(id) || !title) throw fail('UNSUPPORTED_PROTOCOL', 'Не удалось распознать страницу фильма.');
  const init = html.match(/initCDN(Series|Movies)Events\(\s*\d+\s*,\s*(\d+)/);
  const nodes = root.querySelectorAll('.b-translator__item').filter(node => numeric(attr(node, 'data-translator_id')));
  const translators = [...new Map(nodes.map(node => { const choice = { id: nodeTranslatorKey(node), name: clean(node) || attr(node, 'title') }; return [choice.id, choice]; })).values()].filter(item => item.name);
  const movieInit = html.match(/initCDNMoviesEvents\(\s*\d+\s*,\s*(\d+)\s*,\s*([01])\s*,\s*([01])\s*,\s*([01])/);
  const initialKey = movieInit ? translatorKey(movieInit[1], movieInit[2], movieInit[3], movieInit[4]) : init?.[2];
  const activeKeys = nodes.filter(node => node.classList.contains('active')).map(nodeTranslatorKey);
  let selectedTranslatorId = activeKeys.find(key => key === initialKey) || activeKeys[0] || initialKey;
  if (!translators.length && initialKey) translators.push({ id: initialKey, name: 'Основная озвучка' });
  if (!selectedTranslatorId && translators.length) selectedTranslatorId = translators[0].id;
  const fields = {};
  root.querySelectorAll('.b-post__info tr').forEach(row => { const cells = row.querySelectorAll('td'); if (cells.length >= 2) fields[clean(cells[0]).replace(/:$/, '')] = cells[1]; });
  const poster = root.querySelector('.b-sidecover img, .b-post__cover img');
  const releaseDate = clean(fields['Дата выхода']) || undefined;
  const countries = fields['Страна']?.querySelectorAll('a').map(clean).filter(Boolean);
  const ratings = [
    parseRating(root.querySelector('.b-post__info_rates.imdb'), '.bold', 'IMDb'),
    parseRating(root.querySelector('.b-post__info_rates.kp'), '.bold', 'Кинопоиск'),
    parseRating(root.querySelector('.b-post__info_rates.wa'), '.bold', 'World Art'),
    parseRating(root.querySelector('.b-post__rating'), '.num', 'HDRezka'),
  ].filter(Boolean);
  const canonicalUrl = contentUrl(url, mirror);
  const type = attr(root.querySelector('meta[property="og:type"]'), 'content') === 'video.tv_series' || init?.[1] === 'Series' ? 'series' : 'movie';
  const people = parsePeople(root, mirror);
  const schedule = scanSchedule(root).map(({ watchId: _watchId, ...episode }) => Object.fromEntries(Object.entries(episode).filter(([, value]) => value !== undefined)));
  const franchiseTitle = clean(root.querySelector('.b-post__franchise_link_title')) || undefined;
  const parts = parseParts(root, { id, url: canonicalUrl, title, type, mirror });
  const rankings = parseRankings(fields['Входит в списки'], mirror);
  const trailerAvailable = root.querySelectorAll('.b-sidelinks__link.show-trailer').some(node => attr(node, 'data-id') === id) || undefined;
  return {
    id, url: canonicalUrl, title, type, poster: mediaUrl(attr(poster, 'src'), mirror),
    description: clean(root.querySelector('.b-post__description_text')), translators, selectedTranslatorId,
    episodes: applyWatched(parseEpisodes(html), html), year: (clean(fields['Год'] || fields['Дата выхода']).match(/\b(?:19|20)\d{2}\b/) || [])[0],
    genres: fields['Жанр']?.querySelectorAll('a').map(clean), duration: clean(fields['Время']) || undefined,
    originalTitle: clean(root.querySelector('.b-post__origtitle')) || undefined, releaseDate,
    countries: countries?.length ? countries : undefined, ageRating: clean(fields['Возраст']) || undefined,
    ratings: ratings.length ? ratings : undefined,
    ...(people.directors.length ? { directors: people.directors } : {}),
    ...(people.actors.length ? { actors: people.actors } : {}),
    ...(schedule.length ? { schedule } : {}),
    ...(franchiseTitle ? { franchiseTitle } : {}),
    ...(parts.length ? { parts } : {}),
    ...(rankings.length ? { rankings } : {}),
    ...(trailerAvailable ? { trailerAvailable } : {}),
  };
}
function parsePerson(html, url, mirror) {
  const root = siteDocument(html);
  const person = root.querySelector('.b-post.b-person');
  const canonicalUrl = personUrl(url, mirror);
  const id = canonicalUrl.match(/\/person\/(\d+)-/)[1];
  const name = clean(person?.querySelector('.b-post__title .t1'));
  if (!person || !name) throw fail('UNSUPPORTED_PROTOCOL', 'Не удалось распознать страницу персоны.');
  const originalName = clean(person.querySelector('.b-post__title .t2')) || undefined;
  const image = person.querySelector('.b-sidecover img');
  const photo = mediaUrl(attr(image, 'data-src') || attr(image, 'src'), mirror);
  const facts = person.querySelectorAll('.b-post__info tr').slice(0, 32).flatMap(row => {
    const cells = row.querySelectorAll('td');
    const label = clean(cells[0]).replace(/:$/, '');
    const value = clean(cells[1]);
    return label && value ? [{ label, value }] : [];
  });
  let total = 0;
  const careers = person.querySelectorAll('.b-person__career').slice(0, 20).flatMap(group => {
    const role = clean(group.querySelector('h2'));
    if (!role) return [];
    const items = [];
    for (const node of group.querySelectorAll('.b-content__inline_item')) {
      if (total >= 500) break;
      try { items.push(parseContentCard(node, mirror)); total++; } catch { /* Skip malformed optional cards. */ }
    }
    const summary = clean(group.querySelector('.b-person__career_stats')) || undefined;
    return [{ role, ...(summary ? { summary } : {}), items }];
  });
  return { id, name, ...(originalName ? { originalName } : {}), url: canonicalUrl, ...(photo ? { photo } : {}), ...(facts.length ? { facts } : {}), careers };
}
function youtubeSearch(params) {
  const safe = new URLSearchParams();
  const binary = new Set(['autoplay', 'cc_load_policy', 'controls', 'disablekb', 'enablejsapi', 'fs', 'loop', 'modestbranding', 'mute', 'playsinline', 'rel']);
  let count = 0;
  for (const [key, value] of params) {
    if (count++ >= 32) break;
    if ((binary.has(key) && /^[01]$/.test(value)) || (/^(?:start|end)$/.test(key) && /^\d{1,8}$/.test(value)) || (/^(?:hl|cc_lang_pref)$/.test(key) && /^[A-Za-z-]{2,16}$/.test(value)) || (key === 'si' && /^[A-Za-z0-9_-]{1,128}$/.test(value))) safe.set(key, value);
  }
  safe.set('autoplay', '1');
  const query = safe.toString();
  return query ? `?${query}` : '';
}
function parseTrailer(code) {
  const root = document(code);
  for (const iframe of root.querySelectorAll('iframe[src]').slice(0, 16)) {
    try {
      const url = new URL(attr(iframe, 'src'));
      if (url.protocol !== 'https:' || url.port || url.username || url.password || !['www.youtube.com', 'www.youtube-nocookie.com'].includes(url.hostname) || !/^\/embed\/[A-Za-z0-9_-]{11}$/.test(url.pathname)) continue;
      url.searchParams.set('autoplay', '1');
      return { url: url.origin + url.pathname + youtubeSearch(url.searchParams) };
    } catch { /* Try the next iframe. */ }
  }
  throw fail('UNSUPPORTED_PROTOCOL', 'Сервер предоставил недопустимую ссылку на трейлер.');
}
// Stream deobfuscation adapted from ndenissov/HDRezka, Copyright (c) 2023-2025 Nikita Denissov (MIT).
// Full license is retained below.
function decodeStream(encoded) {
  if (typeof encoded !== 'string' || !encoded) throw fail('UNSUPPORTED_PROTOCOL', 'Сервер не предоставил видеопотоки.');
  if (encoded.startsWith('[')) return encoded;
  if (!encoded.startsWith('#h')) throw fail('UNSUPPORTED_PROTOCOL', 'Неизвестный формат видеопотока.');
  const stripped = encoded.replace(/^#h|\/\/_\/\/|(?:I[01UV]|[JQ][EF]|X[kl])(?:[A4][=hjk]|[B5][Ae])|(?:I[Sy]|[JQ]C|Xi)(?:[EMQ][=hjk]|[FNR][Ae])/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(stripped)) throw fail('UNSUPPORTED_PROTOCOL', 'Не удалось расшифровать видеопотоки.');
  return Buffer.from(stripped, 'base64').toString('utf8');
}
function tracks(value) {
  if (typeof value !== 'string') throw fail('UNSUPPORTED_PROTOCOL', 'Некорректный список потоков или субтитров.');
  return Array.from(value.matchAll(/\[([^\]]+)\]([\s\S]*?)(?=,\[|$)/g), match => ({ label: clean(parse(match[1])), urls: match[2].split(/\s+or\s+/) }));
}
function parseStreams(data) {
  const variants = [];
  for (const group of tracks(decodeStream(data.url))) {
    for (const raw of group.urls) {
      const url = mediaUrl(raw.trim());
      if (!url) throw fail('UNSUPPORTED_PROTOCOL', 'Сервер предоставил недопустимую ссылку на видео.');
      const hdr = group.label.match(/Dolby\s*Vision|HDR10\+?|HDR|\bDV\b/i)?.[0];
      variants.push({ id: `${group.label}:${variants.length}`, label: group.label, url, height: Number(group.label.match(/(\d{3,4})p?/)?.[1]) || undefined, mime: /\.m3u8(?:[?#]|$)/.test(url) ? 'application/vnd.apple.mpegurl' : /\.mp4(?:[?#]|$)/.test(url) ? 'video/mp4' : undefined, ...(hdr ? { hdr } : {}) });
    }
  }
  if (!variants.length) throw fail('UNSUPPORTED_PROTOCOL', 'В ответе нет доступных видеопотоков.');
  const subtitles = tracks(data.subtitle || '').map((track, index) => {
    const url = mediaUrl(track.urls[0]);
    if (!url) throw fail('UNSUPPORTED_PROTOCOL', 'Сервер предоставил недопустимую ссылку на субтитры.');
    const language = data.subtitle_lns?.[track.label];
    return { id: language || String(index), label: track.label, language, url, format: /\.vtt(?:[?#]|$)/.test(url) ? 'vtt' : /\.srt(?:[?#]|$)/.test(url) ? 'srt' : undefined };
  });
  return { variants, subtitles };
}
function subtitleText(source) {
  if (typeof source !== 'string') throw fail('UNSUPPORTED_PROTOCOL', 'Некорректные субтитры.');
  if (/^\uFEFF?WEBVTT(?:[ \t]|\r?\n|$)/.test(source)) return source;
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  let count = 0;
  const converted = normalized.replace(/^(\d{2,}:[0-5]\d:[0-5]\d),(\d{3})([ \t]+-->[ \t]+)(\d{2,}:[0-5]\d:[0-5]\d),(\d{3})(?=[ \t]*$)/gm,
    (_, start, startMs, arrow, end, endMs) => { count++; return `${start}.${startMs}${arrow}${end}.${endMs}`; });
  if (!count || /<html|<!doctype/i.test(source)) throw fail('UNSUPPORTED_PROTOCOL', 'Формат субтитров не поддерживается.');
  return 'WEBVTT\n\n' + converted;
}
function parseBookmarkLists(html) {
  const root = siteDocument(html);
  const items = root.querySelectorAll('.b-favorites_content__cats_list_item').map(node => {
    const text = clean(node.querySelector('.num-holder .fb-1, .num'));
    const count = /^\d+$/.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : undefined;
    return { id: attr(node, 'data-cat_id'), name: clean(node.querySelector('.name')), ...(count === undefined ? {} : { count }) };
  });
  if (items.some(item => !numeric(item.id) || !item.name)) throw fail('UNSUPPORTED_PROTOCOL', 'Не удалось распознать списки закладок.');
  if (!items.length && !root.querySelector('#user-favorites-holder, .b-favorites_content__cats_nolist')) throw fail('UNSUPPORTED_PROTOCOL', 'Не удалось распознать списки закладок.');
  return items;
}
function parseContinue(html, mirror) {
  const root = siteDocument(html);
  if (!root.querySelector('.b-videosaves__list, #videosaves-list')) throw fail('UNSUPPORTED_PROTOCOL', 'Не удалось распознать список продолжения просмотра.');
  return root.querySelectorAll('.b-videosaves__list_item').filter(node => !node.querySelector('.th') && node.querySelector('.title a')).map(node => {
    const link = node.querySelector('.title a');
    const url = contentUrl(attr(link, 'href'), mirror, true);
    const id = url.match(/\/(\d+)-[^/]+\.html$/)[1];
    const selection = (attr(link, 'href') || '').match(/#t:(\d+)-s:(\d+)-e:(\d+)/i);
    const info = clean(node.querySelector('.info'));
    const meta = clean(node.querySelector('.title small'));
    const episode = info.match(/(\d+)\s*сезон\s*(\d+)\s*сери/i);
    const saveId = attr(node.querySelector('.delete'), 'data-id') || attr(node, 'id')?.match(/^videosave-(\d+)$/)?.[1];
    const type = episode || url.includes('/series/') ? 'series' : 'movie';
    const status = type === 'series' && seriesStatus(meta);
    return { id, url, title: clean(link), poster: mediaUrl(attr(link, 'data-cover_url'), mirror), meta: meta || undefined, type, ...(status ? { status } : {}), progress: { id, url, position: null, completed: node.classList.contains('watched-row'), ...(selection ? { translatorId: selection[1], season: Number(selection[2]), episode: Number(selection[3]) } : episode ? { season: Number(episode[1]), episode: Number(episode[2]) } : {}), ...(numeric(saveId) ? { saveId } : {}) } };
  });
}
module.exports = { fail, document, siteDocument, contentUrl, personUrl, parseAccount, parseAccountName, parsePage, parseDetails, parsePerson, parseTrailer, parseEpisodes, parseWatched, applyWatched, translatorSelection, parseStreams, subtitleText, parseBookmarkLists, parseContinue };

/*
MIT License — ndenissov/HDRezka
Copyright (c) 2023-2025 Nikita Denissov
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
