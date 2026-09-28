'use strict';
// Deterministic local test data. This provider is never included in the TV package.
function createFixtureProvider() {
  const items = [
    { id: '100', url: 'https://hdrezka-home.tv/series/100-test.html', title: 'Тестовый сериал', type: 'series', meta: '2022–2024 · Сериал', status: 'Завершён', rating: '8.4' },
    { id: '200', url: 'https://hdrezka-home.tv/films/200-test.html', title: 'Тестовый фильм', type: 'movie', meta: '2026 · Фильм', rating: '7.9' },
    { id: '300', url: 'https://hdrezka-home.tv/films/300-test.html', title: 'Новый горизонт', type: 'movie', meta: '2025 · Приключения' },
    { id: '400', url: 'https://hdrezka-home.tv/series/400-test.html', title: 'Новый сериал', type: 'series', meta: '2022 - ... · Сериал', status: 'Выходит' },
  ];
  const facts = {
    '100': { year: '2024', originalTitle: 'Test Series', releaseDate: '15 сентября 2024 года', countries: ['США', 'Канада'], ageRating: '16+', genres: ['Драма'], duration: '45 мин', ratings: [{ source: 'IMDb', score: '8.4', votes: '12 345' }, { source: 'Кинопоиск', score: '7.9', votes: '2 345' }, { source: 'HDRezka', score: '8.2', votes: '456' }] },
    '200': { year: '2026', originalTitle: 'Test Movie', releaseDate: '10 мая 2026 года', countries: ['Франция'], ageRating: '18+', genres: ['Триллер'], duration: '124 мин', ratings: [{ source: 'IMDb', score: '7.9', votes: '9 876' }, { source: 'World Art', score: '8.1', votes: '55' }, { source: 'HDRezka', score: '8.0', votes: '301' }] },
    '400': { year: '2022', originalTitle: 'New Series', releaseDate: '3 марта 2022 года', countries: ['Канада'], ageRating: '12+', genres: ['Приключения'], duration: '50 мин', ratings: [{ source: 'IMDb', score: '7.5' }] },
  };
  const state = {};
  const localKey = value => [state.account?.id || 'fixture-user', value.id, value.translatorId || '', value.season || '', value.episode ?? ''].join(':');
  function reset() {
    Object.keys(state).forEach(key => delete state[key]);
    Object.assign(state, { account: null, mirror: 'https://hdrezka-home.tv', bookmarks: ['100'], watched: {}, failSave: false, saves: [], progress: { '100': { id: '100', url: items[0].url, translatorId: '1', season: 1, episode: 1, position: 25, duration: 120, completed: false } } });
    state.localProgress = { [localKey(state.progress['100'])]: { ...state.progress['100'], positionSource: 'local' } };
    state.remoteProgress = { '100': { ...state.progress['100'], position: null, positionSource: 'unavailable' } };
    state.failEpisodeSync = false;
  }
  reset();
  const auth = () => { if (!state.account) throw Object.assign(new Error('Login required'), { code: 'AUTH_REQUIRED' }); };
  const status = () => ({ account: state.account, mirror: state.mirror, capabilities: { progress: !!state.account, watched: !!state.account, episodeSync: !!state.account }, warnings: [] });
  const page = rows => ({ items: rows, page: 1, hasMore: false });
  async function dispatch(method, params) {
    switch (method) {
      case 'status': return status();
      case 'configure': state.mirror = params.mirror; return status();
      case 'login':
        if (params.username !== 'demo@example.test' || params.password !== 'demo-only') throw Object.assign(new Error('Invalid fixture credentials'), { code: 'BAD_CREDENTIALS' });
        state.account = { id: 'fixture-user', name: 'Локальный тест', premium: true, premiumDays: 30 }; return status();
      case 'logout': state.account = null; return status();
      case 'catalog': return page(params.category === 'series' ? items.filter(item => item.type === 'series') : params.category === 'films' ? items.filter(item => item.type === 'movie') : items);
      case 'search':
        if (params.query === 'slow') await new Promise(resolve => setTimeout(resolve, 500));
        return page(params.query === 'slow' ? [items[0]] : items.filter(item => item.title.toLowerCase().includes(params.query.toLowerCase())));
      case 'details': {
        const item = items.find(item => item.url === params.url) || items[0];
        return { ...item, description: 'Локальные тестовые данные для проверки навигации, плеера и синхронизации. Это не реальный каталог HDRezka.', translators: [{ id: '1', name: 'Тестовая озвучка' }, { id: '2', name: 'Оригинал' }], episodes: item.type === 'series' ? [1, 2, 3].map(episode => ({ season: 1, episode, title: `Эпизод ${episode}`, watched: !!state.account && !!state.watched[`${item.id}:1:${episode}`] })) : [], year: '2026', genres: ['Тест'], duration: '2 мин', ...facts[item.id], selectedTranslatorId: '1' };
      }
      case 'streams':
        return { translatorId: params.translatorId, season: params.season, episode: params.episode, variants: [{ id: '360p', label: '360p · тест', height: 360, mime: 'video/mp4', url: '/api/test-video' }, { id: '720p', label: '720p · тест', height: 720, mime: 'video/mp4', url: '/api/test-video?quality=720' }], subtitles: [{ id: 'ru', label: 'Русские', language: 'ru', url: 'https://subtitle.example.test/ru.vtt', format: 'vtt' }, { id: 'en', label: 'English', language: 'en', url: 'https://subtitle.example.test/en.vtt', format: 'vtt' }] };
      case 'subtitle': return { text: `WEBVTT\n\n00:00:00.000 --> 00:01:00.000\n${params.url.endsWith('/en.vtt') ? 'English test subtitles' : 'Русские тестовые субтитры'}\n` };
      case 'bookmarkLists': auth(); return [{ id: '1', name: 'Избранное', count: state.bookmarks.length }];
      case 'bookmarks': auth(); return page(items.filter(item => state.bookmarks.includes(item.id)));
      case 'setBookmark':
        auth(); state.bookmarks = params.added ? [...new Set([...state.bookmarks, params.id])] : state.bookmarks.filter(id => id !== params.id); return { success: true };
      case 'setEpisodeWatched': {
        auth(); const item = items.find(item => item.url === params.url);
        if (!item || item.type !== 'series') throw Object.assign(new Error('Unknown fixture series'), { code: 'INVALID_INPUT' });
        state.watched[`${item.id}:${params.season}:${params.episode}`] = params.watched; return { success: true };
      }
      case 'continueWatching': auth(); return page(items.filter(item => state.remoteProgress[item.id]).map(item => ({ ...item, progress: { ...state.remoteProgress[item.id], ...state.localProgress[localKey(state.remoteProgress[item.id])] } })));
      case 'progress': auth(); return state.localProgress[localKey(params)] || null;
      case 'saveProgress':
        auth(); if (state.failSave) throw Object.assign(new Error('Test offline save'), { code: 'NETWORK_ERROR', retryable: true });
        state.progress[params.id] = { ...params, positionSource: 'local', updatedAt: new Date().toISOString() };
        if (params.season !== undefined && params.episode !== undefined) for (const [key, value] of Object.entries(state.localProgress)) {
          if (value.id === params.id && value.season !== undefined && value.episode !== undefined) delete state.localProgress[key];
        }
        state.localProgress[localKey(params)] = state.progress[params.id]; state.saves.push({ ...params });
        if (!params.localOnly && !state.failEpisodeSync) state.remoteProgress[params.id] = { ...params, position: null, positionSource: 'unavailable' };
        return { success: true, progress: state.progress[params.id], localSaved: true, episodeSynced: !params.localOnly && !state.failEpisodeSync, ...(!params.localOnly && state.failEpisodeSync ? { syncError: { code: 'NETWORK_ERROR', message: 'Нет связи с HDRezka', retryable: true } } : {}) };
      default: throw Object.assign(new Error('Unknown method'), { code: 'INVALID_INPUT' });
    }
  }
  return { dispatch, state, reset };
}
module.exports = { createFixtureProvider };
