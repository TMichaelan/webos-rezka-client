'use strict';
const p = require('./parsers.cjs');
const https = require('node:https');
const { lookup: dnsLookup } = require('node:dns');
const { BlockList, isIP } = require('node:net');
const { createProgressStore } = require('./progress.cjs');
const MAX_PAGES = 100;
const blockedAddresses = { ipv4: new BlockList(), ipv6: new BlockList() };
const globalIPv6 = new BlockList();
globalIPv6.addSubnet('2000::',3,'ipv6');
for (const [address, prefix] of [
  ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],
  ['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],
  ['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4],
]) blockedAddresses.ipv4.addSubnet(address,prefix,'ipv4');
for (const [address, prefix] of [
  ['::',96],['::1',128],['::ffff:0:0',96],['64:ff9b::',96],['64:ff9b:1::',48],['100::',64],
  ['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20],['5f00::',16],['fc00::',7],['fe80::',10],['fec0::',10],['ff00::',8],
]) blockedAddresses.ipv6.addSubnet(address,prefix,'ipv6');
const validEpisode = (season, episode) => (season === undefined && episode === undefined) || (Number.isInteger(season) && season > 0 && season <= 10000 && Number.isInteger(episode) && episode >= 0 && episode <= 10000);
const sameEpisode = (remote, selected) => remote.id === selected.id && (remote.season || 0) === (selected.season || 0) && (remote.episode || 0) === (selected.episode || 0) && (!remote.translatorId || remote.translatorId === p.translatorSelection(selected.translatorId).providerId);
function capturedAt(params) {
  let time;
  if (params.updatedAt !== undefined) {
    time = typeof params.updatedAt === 'string' ? Date.parse(params.updatedAt) : NaN;
    if (!Number.isFinite(time)) throw p.fail('INVALID_INPUT', 'Некорректное время снимка позиции.');
  } else {
    const match = typeof params.saveId === 'string' && params.saveId.match(/^(\d{13})-[a-z0-9.]{1,64}$/i);
    if (!match) return undefined;
    time = Number(match[1]);
  }
  return new Date(time).toISOString();
}
function id(value, name = 'id') {
  if (typeof value !== 'string' || !/^\d{1,16}$/.test(value) || Number(value) <= 0) throw p.fail('INVALID_INPUT', `Некорректный ${name}.`);
  return value;
}
function pageNumber(value = 1) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGES) throw p.fail('INVALID_INPUT', 'Недопустимый номер страницы.');
  return value;
}
function resolveSubtitleHost(hostname, lookup) {
  return new Promise((resolve, reject) => lookup(hostname, { all: true, verbatim: true }, (error, answers) => {
    if (error) { reject(p.fail('NETWORK_ERROR', 'Не удалось найти сервер субтитров.', true)); return; }
    if (!Array.isArray(answers) || !answers.length || answers.some(({ address, family }) => {
      const type = family === 4 ? 'ipv4' : family === 6 ? 'ipv6' : '';
      return !type || isIP(address) !== family || family === 6 && !globalIPv6.check(address, 'ipv6') || blockedAddresses[type].check(address, type);
    })) { reject(p.fail('BLOCKED_URL', 'Адрес сервера субтитров запрещён.')); return; }
    resolve(answers[0]);
  }));
}
async function fetchSubtitle(address, lookup) {
  const original = new URL(address);
  if (original.protocol !== 'https:' || original.username || original.password || original.hash || original.port || isIP(original.hostname) || /(?:^|\.)(localhost|local|internal)$/i.test(original.hostname)) throw p.fail('BLOCKED_URL', 'Недопустимый адрес субтитров.');
  const destination = await resolveSubtitleHost(original.hostname, lookup);
  const pinnedLookup = (hostname, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    if (hostname !== original.hostname) { callback(Object.assign(new Error('Blocked subtitle host.'), { code: 'ENOTFOUND' })); return; }
    if (options?.all) callback(null, [destination]);
    else callback(null, destination.address, destination.family);
  };
  const deadline = Date.now() + 10000;
  let url = original;
  for (let redirects = 0; ; redirects++) {
    const result = await new Promise((resolve, reject) => {
      let req, settled = false;
      const timer = setTimeout(() => { finish(p.fail('TIMEOUT', 'Загрузка субтитров заняла слишком много времени.', true)); req?.destroy(); }, Math.max(1, deadline - Date.now()));
      const finish = (error, value) => { if (!settled) { settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); } };
      req = https.get(url, { rejectUnauthorized: true, lookup: pinnedLookup, headers: { Accept: 'text/vtt,application/x-subrip,text/plain', 'Accept-Encoding': 'identity' } }, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          finish(null, { location: res.headers.location }); res.destroy(); return;
        }
        if (res.statusCode !== 200) { finish(p.fail('HTTP_ERROR', 'Сервер не предоставил субтитры.', res.statusCode >= 500)); res.destroy(); return; }
        if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') { finish(p.fail('UNSUPPORTED_PROTOCOL', 'Неожиданное сжатие субтитров.')); res.destroy(); return; }
        if (Number(res.headers['content-length']) > 1024 * 1024) { finish(p.fail('RESPONSE_TOO_LARGE', 'Файл субтитров превышает 1 МБ.')); res.destroy(); return; }
        let size = 0; const chunks = [];
        res.on('data', chunk => {
          size += chunk.length;
          if (size > 1024 * 1024) { finish(p.fail('RESPONSE_TOO_LARGE', 'Файл субтитров превышает 1 МБ.')); res.destroy(); return; }
          chunks.push(chunk);
        });
        res.on('end', () => finish(null, { text: Buffer.concat(chunks).toString('utf8') }));
        res.on('aborted', () => finish(p.fail('NETWORK_ERROR', 'Загрузка субтитров прервана.', true)));
        res.on('error', () => finish(p.fail('NETWORK_ERROR', 'Не удалось загрузить субтитры.', true)));
      });
      req.on('error', error => finish(p.fail(/CERT|SSL|TLS/.test(error.code || '') ? 'TLS_ERROR' : 'NETWORK_ERROR', 'Не удалось установить защищённое соединение для субтитров.', true)));
    });
    if (result.text !== undefined) return p.subtitleText(result.text);
    if (redirects >= 2) throw p.fail('REDIRECT_LIMIT', 'Слишком много перенаправлений субтитров.');
    let next;
    try { next = new URL(result.location, url); } catch { throw p.fail('BLOCKED_URL', 'Некорректное перенаправление субтитров.'); }
    if (!result.location || next.origin !== original.origin || next.username || next.password || next.hash) throw p.fail('BLOCKED_URL', 'Перенаправление субтитров за пределы исходного сервера запрещено.');
    url = next;
  }
}
function createProvider({ transport, progressFile, lookup = dnsLookup }) {
  let mutation = Promise.resolve();
  const subtitleURLs = new Set();
  let sessionEpoch = 0;
  let verifiedAccount = null;
  let verifiedContext = null;
  let confirmedEpisode = null;
  const localProgress = progressFile ? createProgressStore(progressFile) : null;
  let quickRatingActive = 0;
  const quickRatingQueue = [];
  function withQuickRatingSlot(work) {
    return new Promise((resolve, reject) => {
      const run = async () => {
        quickRatingActive++;
        try { resolve(await work()); }
        catch (error) { reject(error); }
        finally { quickRatingActive--; quickRatingQueue.shift()?.(); }
      };
      if (quickRatingActive < 3) run();
      else quickRatingQueue.push(run);
    });
  }
  const invalidateSession = () => { sessionEpoch++; subtitleURLs.clear(); verifiedAccount = null; verifiedContext = null; confirmedEpisode = null; };
  const sessionContext = () => ({ epoch: sessionEpoch, generation: transport.generation, mirror: transport.mirror });
  const isCurrentSession = context => context && context.epoch === sessionEpoch && context.generation === transport.generation && context.mirror === transport.mirror;
  function checkSession(context) {
    if (!isCurrentSession(context)) throw p.fail('SESSION_CHANGED', 'Сессия изменилась. Повторите действие.', true);
  }
  async function request(path, options, canonicalContext) {
    const context = canonicalContext || sessionContext();
    checkSession(context);
    const response = await transport.request(path, options);
    checkSession(context);
    // Validate challenge bodies before status, including HTML interstitials returned with HTTP 200.
    p.document(response.body);
    if (response.status === 401) throw p.fail('AUTH_REQUIRED', 'Требуется вход в аккаунт.');
    if (response.status < 200 || response.status >= 300) throw p.fail('HTTP_ERROR', `Сервер вернул HTTP ${response.status}.`, response.status >= 500 || response.status === 429);
    if (canonicalContext) {
      // Only the public root bootstrap may choose a canonical mirror, before any login form.
      p.siteDocument(response.body);
      let final;
      try { final = new URL(response.url); } catch { throw p.fail('UNSUPPORTED_PROTOCOL', 'Сервер не сообщил адрес зеркала.'); }
      if (final.username || final.password || final.hash) throw p.fail('BLOCKED_URL', 'Некорректный адрес зеркала.');
      if (final.origin !== transport.mirror) {
        // setMirror revalidates HTTPS and the transport's approved-host list.
        transport.setMirror(final.origin);
        invalidateSession();
        Object.assign(context, sessionContext());
        await transport.saveSession();
        checkSession(context);
      }
    }
    return response.body;
  }
  async function json(path, form, referer = transport.mirror + '/') {
    const body = await request(path, { method: 'POST', form, headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: referer } });
    let data;
    try { data = JSON.parse(body); } catch { throw p.fail('UNSUPPORTED_PROTOCOL', 'Ожидался JSON-ответ сервера.'); }
    if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.success !== 'boolean') throw p.fail('UNSUPPORTED_PROTOCOL', 'Сервер не подтвердил результат операции.');
    if (!data.success) throw p.fail(/авториз|войти|login|парол|need_auth/i.test(String(data.message || '')) ? 'AUTH_REQUIRED' : 'SERVER_REJECTED', 'Сервер отклонил операцию. Проверьте вход и доступность контента.');
    return data;
  }
  function rememberAccount(html) {
    const account = p.parseAccount(html, transport.mirror);
    if (verifiedAccount && (verifiedAccount.id !== account?.id || !isCurrentSession(verifiedContext))) invalidateSession();
    if (account && account.id === verifiedAccount?.id && account.name === 'Пользователь HDRezka') account.name = verifiedAccount.name;
    verifiedAccount = account;
    verifiedContext = account ? sessionContext() : null;
    return account;
  }
  async function authenticated(path) {
    const html = await request(path);
    if (!rememberAccount(html)) throw p.fail('AUTH_REQUIRED', 'Требуется вход в аккаунт.');
    return html;
  }
  const statusFrom = html => {
    const account = rememberAccount(html);
    return { account, mirror: transport.mirror, capabilities: { progress: !!account && !!localProgress, episodeSync: !!account && !!localProgress, watched: !!account }, warnings: ['Точная позиция сохраняется на этом устройстве; текущая серия — в аккаунте HDRezka.'] };
  };
  async function status(context = sessionContext()) {
    const state = statusFrom(await request('/', undefined, context));
    if (state.account?.name === 'Пользователь HDRezka') {
      try {
        const html = await authenticated('/settings/');
        checkSession(context);
        const name = p.parseAccountName(html, state.account.id, transport.mirror);
        verifiedAccount.name = name;
        state.account.name = name;
      } catch (error) {
        if (error.code === 'AUTH_REQUIRED') throw error;
        checkSession(context);
        state.warnings.push('Не удалось загрузить имя аккаунта. Обновите состояние позже.');
      }
    }
    return state;
  }
  function listingPath(base, page) { return page > 1 ? `${base}page/${page}/` : base; }
  async function bookmarks(listId, page = 1) {
    const base = listId === undefined ? '/favorites/' : `/favorites/${id(listId, 'список')}/`;
    return p.parsePage(await authenticated(listingPath(base, pageNumber(page))), transport.mirror, page);
  }
  async function membership(listId, postId, context) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      checkSession(context);
      const result = await bookmarks(listId, page);
      checkSession(context);
      if (result.items.some(item => item.id === postId)) return true;
      if (!result.hasMore) return false;
    }
    throw p.fail('UNSUPPORTED_PROTOCOL', 'Список слишком велик для безопасной проверки закладки.');
  }
  async function recent() {
    const items = p.parseContinue(await authenticated('/continue/'), transport.mirror);
    if (confirmedEpisode && !items.some(item => sameEpisode(item.progress, confirmedEpisode)) && !(confirmedEpisode.completed && !items.some(item => item.id === confirmedEpisode.id))) confirmedEpisode = null;
    return items;
  }
  function storedPosition(selection) {
    if (verifiedAccount) checkSession(verifiedContext);
    return localProgress && verifiedAccount && selection.translatorId ? localProgress.get(verifiedAccount.id, selection) : null;
  }
  function mergePosition(remote, movie = false) {
    if (movie) {
      const { translatorId, ...progress } = remote;
      return { ...progress, ...(translatorId ? { providerTranslatorId: translatorId } : {}), position: null, positionSource: 'unavailable' };
    }
    const local = storedPosition(remote);
    return local ? { ...remote, ...local, url: remote.url, saveId: remote.saveId } : { ...remote, position: null, positionSource: 'unavailable' };
  }
  async function dispatch(method, params = {}) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) throw p.fail('INVALID_INPUT', 'Некорректные параметры.');
    switch (method) {
      case 'status': return status();
      case 'configure':
        invalidateSession();
        await transport.setMirror(params.mirror);
        return status();
      case 'login': {
        invalidateSession();
        if (typeof params.username !== 'string' || !params.username.trim() || params.username.length > 320 || typeof params.password !== 'string' || !params.password || params.password.length > 1024) throw p.fail('INVALID_INPUT', 'Введите логин и пароль.');
        // Establish the site's challenge cookies before posting credentials.
        const context = sessionContext();
        await request('/', undefined, context);
        checkSession(context);
        await json('/ajax/login/', { login_name: params.username.trim(), login_password: params.password, login_not_save: '0', login: 'submit' });
        checkSession(context);
        const verified = await status(context);
        checkSession(context);
        if (!verified.account) throw p.fail('AUTH_REQUIRED', 'Сервер не подтвердил вход.');
        await transport.saveSession();
        checkSession(context);
        return verified;
      }
      case 'logout':
        invalidateSession();
        await transport.clearSession();
        return { account: null, mirror: transport.mirror, capabilities: { progress: false, episodeSync: false, watched: false } };
      case 'catalog': {
        const page = pageNumber(params.page);
        const category = params.category || '';
        if (!['', 'films', 'series', 'cartoons', 'animation'].includes(category) || ![undefined, 'new', 'popular'].includes(params.sort)) throw p.fail('INVALID_INPUT', 'Неизвестная категория или сортировка.');
        const base = category ? `/${category}/` : '/';
        const path = listingPath(base, page) + (params.sort === 'popular' ? '?filter=popular' : '');
        return p.parsePage(await request(path), transport.mirror, page);
      }
      case 'search': {
        const page = pageNumber(params.page);
        if (typeof params.query !== 'string' || params.query.trim().length < 1 || params.query.length > 200) throw p.fail('INVALID_INPUT', 'Введите поисковый запрос до 200 символов.');
        const query = new URLSearchParams({ do: 'search', subaction: 'search', q: params.query.trim(), page: String(page) });
        return p.parsePage(await request(`/search/?${query}`), transport.mirror, page);
      }
      case 'details': {
        const url = p.contentUrl(params.url, transport.mirror);
        const html = await request(new URL(url).pathname);
        const details = p.parseDetails(html, url, transport.mirror);
        if (params.translatorId !== undefined) {
          const selection = p.translatorSelection(params.translatorId);
          if (!details.translators.some(item => item.id === params.translatorId)) throw p.fail('INVALID_INPUT', 'Эта озвучка недоступна.');
          if (details.type === 'series' && details.selectedTranslatorId !== params.translatorId) {
            const data = await json('/ajax/get_cdn_series/', { id: details.id, translator_id: selection.providerId, action: 'get_episodes' });
            if (typeof data.episodes !== 'string' || (data.seasons !== false && typeof data.seasons !== 'string')) throw p.fail('UNSUPPORTED_PROTOCOL', 'Сервер не предоставил список серий.');
            details.episodes = p.applyWatched(p.parseEpisodes((data.seasons || '') + data.episodes), html);
          }
          details.selectedTranslatorId = params.translatorId;
        }
        return details;
      }
      case 'person': {
        const url = p.personUrl(params.url, transport.mirror);
        return p.parsePerson(await request(new URL(url).pathname), url, transport.mirror);
      }
      case 'partRatings': {
        const context = sessionContext();
        if (!Array.isArray(params.parts) || params.parts.length < 1 || params.parts.length > 20) throw p.fail('INVALID_INPUT', 'Выберите от 1 до 20 частей франшизы.');
        const validated = params.parts.map(part => {
          if (!part || typeof part !== 'object' || Array.isArray(part)) throw p.fail('INVALID_INPUT', 'Некорректная часть франшизы.');
          const postId = id(part.id);
          const url = p.contentUrl(part.url, transport.mirror);
          if (new URL(url).pathname.match(/\/(\d+)-[^/]+\.html$/)?.[1] !== postId) throw p.fail('INVALID_INPUT', 'Фильм не соответствует ссылке.');
          return { id: postId, url };
        });
        const seen = new Set();
        const parts = validated.filter(part => {
          if (seen.has(part.id)) return false;
          seen.add(part.id);
          return true;
        });
        const ratings = [];
        for (let index = 0; index < parts.length; index += 3) {
          ratings.push(...await Promise.all(parts.slice(index, index + 3).map(part => withQuickRatingSlot(async () => {
            checkSession(context);
            const html = await request('/engine/ajax/quick_content.php', {
              method: 'POST',
              form: { id: part.id, is_touch: '1' },
              headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: part.url },
            });
            checkSession(context);
            return { id: part.id, ...p.parseQuickRating(html, part.url, transport.mirror) };
          }))));
        }
        return { ratings };
      }
      case 'trailer': {
        const postId = id(params.id);
        const url = p.contentUrl(params.url, transport.mirror);
        const pathname = new URL(url).pathname;
        if (pathname.match(/\/(\d+)-[^/]+\.html$/)?.[1] !== postId) throw p.fail('INVALID_INPUT', 'Фильм не соответствует ссылке.');
        const details = p.parseDetails(await request(pathname), url, transport.mirror);
        if (details.id !== postId || !details.trailerAvailable) throw p.fail('INVALID_INPUT', 'Трейлер недоступен.');
        const data = await json('/engine/ajax/gettrailervideo.php', { id: postId }, url);
        return p.parseTrailer(data.code);
      }
      case 'streams': {
        const context = sessionContext();
        const postId = id(params.id); const translatorId = params.translatorId;
        const selection = p.translatorSelection(translatorId);
        const url = p.contentUrl(params.url, transport.mirror);
        const html = await request(new URL(url).pathname);
        const details = p.parseDetails(html, url, transport.mirror);
        if (details.id !== postId || !details.translators.some(item => item.id === translatorId)) throw p.fail('INVALID_INPUT', 'Фильм или озвучка не соответствует странице.');
        let form;
        if (details.type === 'series') {
          if (!Number.isInteger(params.season) || params.season < 1 || !Number.isInteger(params.episode) || params.episode < 0 || params.season > 10000 || params.episode > 10000) throw p.fail('INVALID_INPUT', 'Выберите сезон и серию.');
          form = { action: 'get_stream', id: postId, translator_id: selection.providerId, season: String(params.season), episode: String(params.episode) };
        } else form = { action: 'get_movie', id: postId, translator_id: selection.providerId, ...selection.flags };
        form.favs = p.document(html).querySelector('#ctrl_favs')?.getAttribute('value') || '';
        const data = await json('/ajax/get_cdn_series/', form);
        const parsed = p.parseStreams(data);
        checkSession(context);
        parsed.subtitles.forEach(track => subtitleURLs.add(track.url));
        return { ...parsed, translatorId, ...(details.type === 'series' ? { season: params.season, episode: params.episode } : {}) };
      }
      case 'subtitle': {
        if (typeof params.url !== 'string' || !subtitleURLs.has(params.url)) throw p.fail('BLOCKED_URL', 'Субтитры не относятся к доступному источнику воспроизведения.');
        const context = sessionContext();
        const text = await fetchSubtitle(params.url, lookup);
        checkSession(context);
        return { text };
      }
      case 'bookmarkLists': return p.parseBookmarkLists(await authenticated('/favorites/'));
      case 'bookmarks': return bookmarks(params.listId, params.page);
      case 'setBookmark': {
        const postId = id(params.id); const listId = id(params.listId, 'список');
        if (typeof params.added !== 'boolean') throw p.fail('INVALID_INPUT', 'Некорректное состояние закладки.');
        const context = sessionContext();
        const added = params.added;
        const change = async () => {
          checkSession(context);
          const present = await membership(listId, postId, context);
          checkSession(context);
          if (present === added) return { success: true };
          await json('/ajax/favorites/', { post_id: postId, cat_id: listId, action: 'add_post' });
          checkSession(context);
          if (await membership(listId, postId, context) !== added) throw p.fail('SYNC_FAILED', 'Сервер не подтвердил изменение закладки. Обновите список перед повтором.');
          return { success: true };
        };
        const pending = mutation.then(change); mutation = pending.catch(() => {}); return pending;
      }
      case 'setEpisodeWatched': {
        const url = p.contentUrl(params.url, transport.mirror);
        const { season, episode, watched } = params;
        if (!Number.isInteger(season) || season < 1 || season > 10000 || !Number.isInteger(episode) || episode < 0 || episode > 10000 || typeof watched !== 'boolean') throw p.fail('INVALID_INPUT', 'Выберите сезон, серию и статус просмотра.');
        const context = sessionContext();
        const readState = async () => {
          checkSession(context);
          const html = await authenticated(new URL(url).pathname);
          checkSession(context);
          const details = p.parseDetails(html, url, transport.mirror);
          if (details.id !== new URL(url).pathname.match(/\/(\d+)-[^/]+\.html$/)[1]) throw p.fail('UNSUPPORTED_PROTOCOL', 'Сервер вернул страницу другого фильма.');
          const matches = p.parseWatched(html).filter(item => item.season === season && item.episode === episode);
          const marker = matches[0];
          if (!marker || matches.some(item => item.watchId !== marker.watchId || item.watched !== marker.watched)) throw p.fail('UNSUPPORTED_PROTOCOL', 'Сервер не предоставил однозначную отметку этой серии.');
          id(marker.watchId, 'отметка серии');
          return marker;
        };
        const change = async () => {
          const before = await readState();
          checkSession(context);
          if (before.watched === watched) return { success: true };
          await json('/engine/ajax/schedule_watched.php', { id: before.watchId });
          checkSession(context);
          const after = await readState();
          checkSession(context);
          if (after.watchId !== before.watchId || after.watched !== watched) throw p.fail('SYNC_FAILED', 'Сервер не подтвердил отметку серии. Обновите карточку перед повтором.');
          return { success: true };
        };
        const pending = mutation.then(change); mutation = pending.catch(() => {}); return pending;
      }
      case 'continueWatching': {
        const page = pageNumber(params.page); const items = (await recent()).map(item => ({ ...item, progress: mergePosition(item.progress, item.type === 'movie') }));
        return { items: items.slice((page - 1) * 20, page * 20), page, hasMore: items.length > page * 20 };
      }
      case 'progress': {
        const postId = id(params.id); const url = p.contentUrl(params.url, transport.mirror);
        if (new URL(url).pathname.match(/\/(\d+)-[^/]+\.html$/)[1] !== postId || !validEpisode(params.season, params.episode)) throw p.fail('INVALID_INPUT', 'Некорректный фильм или серия.');
        const requestedTranslatorId = params.translatorId === undefined ? undefined : p.translatorSelection(params.translatorId).providerId;
        const context = sessionContext();
        let items;
        try { items = await recent(); }
        catch (error) {
          checkSession(context);
          if (!['NETWORK_ERROR', 'TIMEOUT', 'HTTP_ERROR'].includes(error.code)) throw error;
          const local = storedPosition(params);
          if (local) return { ...local, url };
          throw error;
        }
        checkSession(context);
        const match = items.find(item => item.id === postId && (requestedTranslatorId === undefined || item.progress.translatorId === undefined || item.progress.translatorId === requestedTranslatorId) && (params.season === undefined || item.progress.season === params.season) && (params.episode === undefined || item.progress.episode === params.episode));
        if (match?.type === 'movie' && params.translatorId === undefined) return mergePosition(match.progress, true);
        const selection = { ...(match?.progress || {}), ...params };
        const local = storedPosition(selection);
        if (local) return { ...(match?.progress || {}), ...local, url };
        return match ? { ...match.progress, positionSource: 'unavailable' } : null;
      }
      case 'saveProgress': {
        if (params.localOnly !== undefined && typeof params.localOnly !== 'boolean') throw p.fail('INVALID_INPUT', 'Некорректный режим сохранения позиции.');
        if (!localProgress) throw p.fail('UNSUPPORTED_PROTOCOL', 'Локальное хранилище позиции не настроено.');
        const postId = id(params.id); const translatorId = params.translatorId;
        const selection = p.translatorSelection(translatorId);
        const url = p.contentUrl(params.url, transport.mirror);
        const { season, episode, position, duration, completed } = params;
        if (new URL(url).pathname.match(/\/(\d+)-[^/]+\.html$/)[1] !== postId || !Number.isFinite(position) || position < 0 || !Number.isFinite(duration) || duration <= 0 || position > duration || typeof completed !== 'boolean' || !validEpisode(season, episode)) throw p.fail('INVALID_INPUT', 'Некорректная позиция или серия.');
        const updatedAt = capturedAt(params) || (params.localOnly ? undefined : new Date().toISOString());
        if (verifiedAccount) checkSession(verifiedContext);
        if (params.localOnly && !verifiedAccount) throw p.fail('AUTH_REQUIRED', 'Сначала подтвердите аккаунт для локального сохранения позиции.');
        if (!verifiedAccount) await status();
        if (!verifiedAccount) throw p.fail('AUTH_REQUIRED', 'Для сохранения позиции нужен подтверждённый аккаунт.');
        const owner = verifiedAccount.id;
        const context = sessionContext();
        const progress = localProgress.set(owner, { id: postId, url, translatorId, ...(season === undefined ? {} : { season, episode }), position, duration, completed, ...(updatedAt ? { updatedAt } : {}) }, params.localOnly === true);
        const selectionKey = [owner, postId, translatorId, season || 0, episode || 0, completed].join(':');
        const result = { success: true, progress, localSaved: true };
        if (params.localOnly) return { ...result, episodeSynced: false };
        const synchronize = async () => {
          try {
            checkSession(context);
            const elapsed = confirmedEpisode ? Date.now() - confirmedEpisode.at : Infinity;
            if (confirmedEpisode?.key === selectionKey && elapsed >= 0 && elapsed < 60000) return { ...result, episodeSynced: true };
            confirmedEpisode = null;
            let rows = await recent();
            checkSession(context);
            let response, rejected;
            if (completed || !rows.some(item => sameEpisode(item.progress, progress) && item.progress.translatorId === selection.providerId)) {
              try {
                response = await json('/ajax/send_save/?t=' + Date.now(), { post_id: postId, translator_id: selection.providerId, season: String(season || 0), episode: String(episode || 0), current_time: position, duration }, url);
              } catch (error) {
                // This endpoint demonstrably updates the episode while replying success:false.
                if (error.code !== 'SERVER_REJECTED') throw error;
                rejected = error;
              }
              checkSession(context);
              rows = await recent();
              checkSession(context);
            }
            if (verifiedAccount?.id !== owner) throw p.fail('SESSION_CHANGED', 'Аккаунт изменился. Серия не отправлена.', true);
            const confirmed = rows.some(item => sameEpisode(item.progress, progress));
            const removedAfterCompletion = completed && response?.iterator === 'minus' && !rows.some(item => item.id === postId);
            if (!confirmed && !removedAfterCompletion) throw rejected || p.fail('SYNC_FAILED', 'Позиция сохранена на устройстве, но сервер не подтвердил текущую серию.', true);
            confirmedEpisode = { key: selectionKey, at: Date.now(), id: postId, translatorId, season, episode, completed };
            return { ...result, episodeSynced: true };
          } catch (error) {
            return { ...result, episodeSynced: false, syncError: { code: /^[A-Z_]{3,40}$/.test(error.code || '') ? error.code : 'NETWORK_ERROR', message: error.publicMessage || 'Позиция сохранена на устройстве. Не удалось подтвердить серию в аккаунте.', retryable: error.retryable === true } };
          }
        };
        const pending = mutation.then(synchronize); mutation = pending.catch(() => {}); return pending;
      }
      default: throw p.fail('UNKNOWN_METHOD', 'Неизвестная операция.');
    }
  }
  return { dispatch };
}
module.exports = { createProvider };
