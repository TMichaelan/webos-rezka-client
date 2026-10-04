<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { api, ApiError } from './api';
import { createProgressQueue, selectTranslator } from './player.mjs';
import { focusFirst, installNavigation, platformBack } from './navigation';
import PosterCard from './components/PosterCard.vue';
import SkeletonView from './components/SkeletonView.vue';
import iconUrl from '../webos/large-icon.png';
import VideoPlayer from './components/VideoPlayer.vue';
import TvSelect from './components/TvSelect.vue';
import AppIcon from './components/AppIcon.vue';
import type { BookmarkList, Content, ContinueItem, Details, Episode, Methods, Page, PersonDetails, PersonSummary, PlaybackSource, Preferences, SaveProgress, Status } from './types';

type Route = { name: 'home' | 'search' | 'catalog' | 'details' | 'person' | 'bookmarks' | 'profile'; title: string; category?: string; url?: string };
type Shelf = { id: 'continue' | 'bookmarks' | 'new' | 'popular'; title: string; subtitle: string; items: (Content | ContinueItem)[]; loading: boolean; error: string };
type RouteSnapshot = { focus: string; scroll: number; rows: number[]; detail?: { summary?: Content; season: number; episode?: number; scheduleSeason?: number; scheduleExpanded: boolean } };
const route = ref<Route>({ name: 'home', title: 'Главная' });
const history: Route[] = [];
const routeKey = (value: Route, listId = selectedList.value) => `${value.name}:${value.name === 'bookmarks' ? listId : value.category || value.url || ''}`;
const snapshots = new Map<string, RouteSnapshot>();
const cache = new Map<string, Page>();
const shelfRequests = new Map<Shelf['id'], number>();
const scroller = ref<HTMLElement>();
const status = ref<Status | null>(null);
const visibleWarnings = computed(() => status.value?.warnings?.filter(warning => !/позиц|синхронизац/iu.test(warning)) || []);
const accountName = computed(() => status.value?.account?.name === 'Пользователь HDRezka' ? 'Профиль' : status.value?.account?.name || 'Профиль');
const categories = [{ id: 'films', label: 'Фильмы', icon: 'film' }, { id: 'series', label: 'Сериалы', icon: 'series' }, { id: 'cartoons', label: 'Мультфильмы', icon: 'cartoons' }, { id: 'animation', label: 'Аниме', icon: 'anime' }] as const;
let accountVersion = 0;
let authRecoveryVersion = -1;
let changingAccount = false;
const initializing = ref(true);
const bootstrapError = ref('');
const loginBusy = ref(false);
const accountError = ref('');
const accountLoading = ref(false);
const username = ref('');
const password = ref('');
const mirror = ref('');
const settingsBusy = ref(false);
const settingsNote = ref('');
const shelves = reactive<Shelf[]>([
  { id: 'continue', title: 'Продолжить просмотр', subtitle: 'То, что ждёт вашего возвращения', items: [], loading: false, error: '' },
  { id: 'bookmarks', title: 'Мои закладки', subtitle: 'Сохранённое в вашем аккаунте', items: [], loading: false, error: '' },
  { id: 'new', title: 'Новинки', subtitle: 'Недавно появились в каталоге', items: [], loading: false, error: '' },
  { id: 'popular', title: 'Популярное', subtitle: 'Истории, которые выбирают сейчас', items: [], loading: false, error: '' }
]);
const visibleShelves = computed(() => status.value?.account ? shelves : shelves.filter(shelf => shelf.id === 'new' || shelf.id === 'popular'));
const cards = ref<Content[]>([]);
const page = ref(1);
const hasMore = ref(false);
const loading = ref(false);
const loadMoreFailed = ref(false);
const screenError = ref('');
const query = ref('');
const searchedQuery = ref('');
const searchHistory = ref<string[]>([]);
const lists = ref<BookmarkList[]>([]);
const selectedList = ref('');
const listsError = ref('');
const details = ref<Details>();
const person = ref<PersonDetails>();
const detailSummary = ref<Content>();
const detailBookmarked = ref<boolean>();
const confirmedBookmarks = reactive(new Set<string>());
const bookmarksComplete = ref(false);
const detailRatings = computed(() => details.value?.ratings?.filter(item => item.score.trim()) || []);
const detailGenres = computed(() => details.value?.genres?.map(value => value.trim()).filter(Boolean) || []);
const detailPeople = computed(() => {
  const people = new Map<string, PersonSummary & { roles: string[] }>();
  const add = (items: PersonSummary[] | undefined, role: string) => items?.forEach(item => {
    const key = item.id;
    const existing = people.get(key);
    if (existing) { if (!existing.roles.includes(role)) existing.roles.push(role); }
    else people.set(key, { ...item, roles: [role] });
  });
  add(details.value?.directors, 'Режиссёр'); add(details.value?.actors, 'Актёр');
  return [...people.values()].map(item => ({ ...item, role: item.roles.join(' · ') }));
});
const detailFacts = computed(() => {
  const value = details.value;
  if (!value) return [];
  const summary = detailSummary.value?.url === value.url ? detailSummary.value : undefined;
  const publicFields = [value.status, value.meta, summary?.status, summary?.meta];
  const publicMeta = publicFields.filter(Boolean).join(' ');
  const years = publicMeta.match(/((?:19|20)\d{2})\s*[-–—]\s*((?:19|20)\d{2}|\.{3}|…)/);
  const runYears = years ? `${years[1]}–${years[2] === '...' ? '…' : years[2]}` : '';
  const completed = publicFields.some(text => /(?:^|[(,;·])\s*(?:(?:сериал|проект)\s+)?заверш[её]н(?:\s*\(все серии\))?\s*(?:$|[),;·])/i.test(text || ''));
  const state = completed ? 'Завершён'
    : years && /^(?:\.{3}|…)$/.test(years[2]!) || value.status === 'Выходит' || summary?.status === 'Выходит' ? 'Выходит' : '';
  return [
    [value.releaseDate?.trim() ? 'Премьера' : 'Год', value.releaseDate?.trim() || value.year],
    ['Годы показа', value.type === 'series' ? runYears : ''],
    ['Статус', value.type === 'series' ? state : ''],
    ['Страны', value.countries?.map(country => country.trim()).filter(Boolean).join(', ')],
    ['Длительность', value.duration],
    ['Возраст', value.ageRating]
  ].map(([label, fact]) => ({ label, value: fact?.trim() })).filter(fact => fact.value);
});
const translator = ref('');
const selectedSeason = ref(1);
const selectedEpisode = ref<number | undefined>();
const selectedScheduleSeason = ref<number>();
const scheduleExpanded = ref(false);
let requestedContinue: ContinueItem['progress'] | undefined;
const seasons = computed(() => [...new Set(details.value?.episodes.map(item => item.season) || [])]);
const episodes = computed(() => details.value?.episodes.filter(item => item.season === selectedSeason.value) || []);
const chosenEpisode = computed(() => episodes.value.find(item => item.episode === selectedEpisode.value));
const scheduleSeasons = computed(() => [...new Set(details.value?.schedule?.map(item => item.season) || [])]);
const scheduleEpisodes = computed(() => details.value?.schedule?.filter(item => item.season === selectedScheduleSeason.value) || []);
const orderedScheduleEpisodes = computed(() => {
  const upcoming = scheduleEpisodes.value.filter(item => item.state === 'upcoming').sort((a, b) => a.episode - b.episode);
  const aired = scheduleEpisodes.value.filter(item => item.state === 'aired').sort((a, b) => b.episode - a.episode);
  return upcoming.length ? [...upcoming, ...aired] : aired;
});
const visibleScheduleEpisodes = computed(() => scheduleExpanded.value ? orderedScheduleEpisodes.value : orderedScheduleEpisodes.value.slice(0, 3));
const preparedSource = ref<PlaybackSource>();
const playbackSource = ref<PlaybackSource>();
const sourceError = ref('');
const playStarting = ref(false);
const descriptionExpanded = ref(false);
let sourceController = new AbortController();
let sourceKey = '';
let sourceRequest: Promise<PlaybackSource | undefined> | undefined;
const selectionKey = computed(() => details.value && translator.value && (details.value.type === 'movie' || chosenEpisode.value)
  ? JSON.stringify([details.value.id, translator.value, chosenEpisode.value?.season, chosenEpisode.value?.episode]) : '');
type WatchedChange = Methods['setEpisodeWatched']['params'];
const watchedPending = reactive(new Set<string>());
const watchedDesired = new Map<string, WatchedChange>();
const watchedFailures = reactive(new Map<string, { change: WatchedChange; error: string }>());
const watchedNote = ref('');
let watchedRefreshVersion = 0;
const watchedError = computed(() => [...watchedFailures.values()].map(item => item.error).join(' · '));
const watchedKey = (value: WatchedChange) => `${value.url}:${value.season}:${value.episode}`;
const modal = ref<'bookmark' | 'logout' | 'unsent' | null>(null);
const modalBusy = ref(false);
const modalError = ref('');
let modalToken = 0;
let modalOrigin: HTMLElement | null = null;
const trailerOpen = ref(false);
const trailerLoading = ref(false);
const trailerUrl = ref('');
const trailerStarted = ref(false);
const trailerError = ref('');
let trailerToken = 0;
let trailerOrigin: HTMLElement | null = null;
let trailerController = new AbortController();
const playerOpen = ref(false);
const playerRef = ref<InstanceType<typeof VideoPlayer>>();
const preferences = reactive<Preferences>(readPreferences());
const sync = reactive({ status: 'idle', count: 0, error: '' });
const pendingPositions = ref<SaveProgress[]>([]);
const episodeSyncError = ref('');
let episodeRetry: SaveProgress | undefined;
const recovered = ref(false);
let persistenceKey = '';
let screenController = new AbortController();
let requestVersion = 0;
let inputVersion = 0;
const recordInput = () => { inputVersion++; };
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let automaticRetryUsed = false;
let removeNavigation: (() => void) | undefined;
const message = (value: unknown) => value instanceof Error ? value.message : 'Не удалось загрузить данные. Повторите попытку.';
function readPreferences(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem('rezka.preferences') || '{}') as Partial<Preferences>;
    return { quality: typeof saved.quality === 'string' ? saved.quality : 'max', translatorId: typeof saved.translatorId === 'string' ? saved.translatorId : '', subtitleId: typeof saved.subtitleId === 'string' ? saved.subtitleId : '', autoNext: true };
  } catch { return { quality: 'max', translatorId: '', subtitleId: '', autoNext: true }; }
}
function readSearchHistory() {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(searchHistoryKey()) || '[]');
    return Array.isArray(saved) ? [...new Set(saved.filter((value): value is string => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 100).map(value => value.trim()))].slice(0, 6) : [];
  } catch { return []; }
}
function searchHistoryKey() { return `rezka.search-history.${encodeURIComponent(status.value?.mirror || mirror.value || 'default')}.${encodeURIComponent(status.value?.account?.id || 'guest')}`; }
function rememberSearch(value: string) {
  const term = value.trim();
  if (!term || term.length > 100) return;
  searchHistory.value = [term, ...searchHistory.value.filter(item => item.toLocaleLowerCase() !== term.toLocaleLowerCase())].slice(0, 6);
  try { localStorage.setItem(searchHistoryKey(), JSON.stringify(searchHistory.value)); } catch { /* Search still works when local history storage is unavailable. */ }
}
async function clearSearchHistory() {
  searchHistory.value = [];
  try { localStorage.removeItem(searchHistoryKey()); } catch { /* Keep the cleared in-memory state. */ }
  await nextTick(); document.querySelector<HTMLElement>('[data-nav-id="search-input"]')?.focus({ preventScroll: true });
}
function updatePreferences(value: Preferences) { Object.assign(preferences, value); try { localStorage.setItem('rezka.preferences', JSON.stringify(preferences)); } catch { settingsNote.value = 'Не удалось сохранить настройки на устройстве.'; } }
let saves: ReturnType<typeof createProgressQueue> | undefined;
function createAccountQueue() {
  const queue = createProgressQueue(async value => {
    if (changingAccount || !status.value?.account) return Promise.reject(new ApiError('ACCOUNT_CHANGED', 'Аккаунт изменился. Позиция сохранена в очереди прежнего аккаунта.'));
    const version = accountVersion;
    const result = await api.call('saveProgress', value);
    if (version !== accountVersion || value.localOnly) return;
    // A remote outage must never block the next durable local position.
    episodeSyncError.value = result.episodeSynced ? '' : result.syncError?.message || 'HDRezka не подтвердил текущую серию.';
    episodeRetry = result.episodeSynced ? undefined : value;
  }, state => {
    sync.status = state.status; sync.count = state.count;
    if (state.error) sync.error = message(state.error);
    if (state.status === 'synced' || state.status === 'idle') sync.error = '';
    queueMicrotask(() => {
      if (saves !== queue) return;
      pendingPositions.value = queue.pending();
      if (!persistenceKey) return;
      try { const pending = queue.pending(); if (pending.length) localStorage.setItem(persistenceKey, JSON.stringify(pending)); else localStorage.removeItem(persistenceKey); } catch { sync.error = 'Не удалось сохранить очередь на устройстве. Оставьте приложение открытым и повторите отправку.'; }
    });
    if (state.status === 'failed' && state.error && !automaticRetryUsed && !recovered.value && (state.error as { retryable?: boolean }).retryable) {
      automaticRetryUsed = true;
      retryTimer = setTimeout(() => { void queue.retry(); }, 5000);
    }
  });
  return queue;
}
function saveProgress(value: SaveProgress) { if (!changingAccount && status.value?.account && status.value.capabilities.progress) saves?.enqueue(value); }
function retrySaves() { recovered.value = false; automaticRetryUsed = true; void saves?.retry(); }
function retryEpisodeSync() { if (episodeRetry && !saves?.pending().length) saves?.enqueue(episodeRetry); }
function restoreQueue() {
  const account = status.value?.account;
  const nextKey = account ? `rezka.pending.${status.value?.mirror}.${account.id}` : '';
  if (nextKey === persistenceKey) return;
  if (retryTimer) clearTimeout(retryTimer);
  if (persistenceKey) {
    try { const pending = saves?.pending() || []; if (pending.length) localStorage.setItem(persistenceKey, JSON.stringify(pending)); else localStorage.removeItem(persistenceKey); } catch { /* Keep account-scoped queue in memory until the status transition finishes. */ }
  }
  persistenceKey = '';
  saves?.clear(); saves = undefined; pendingPositions.value = []; recovered.value = false; automaticRetryUsed = false;
  persistenceKey = nextKey;
  if (!nextKey) return;
  saves = createAccountQueue();
  try {
    const pending: unknown = JSON.parse(localStorage.getItem(nextKey) || '[]');
    if (Array.isArray(pending)) {
      const valid = pending.filter((item): item is SaveProgress => item && typeof item.id === 'string' && typeof item.position === 'number' && Number.isFinite(item.position) && typeof item.duration === 'number' && item.duration > 0);
      if (valid.length) {
        saves.restore(valid.map(value => ({ ...value, localOnly: true })));
        // Recover the last local snapshot without replaying an old episode to HDRezka.
        queueMicrotask(() => { if (persistenceKey === nextKey && !changingAccount) void saves?.retry(); });
      }
    }
  } catch { /* Invalid local cache never replaces server progress. */ }
}
async function recoverAccount(owner: number) {
  if (owner !== accountVersion || changingAccount || !status.value?.account || authRecoveryVersion === owner) return;
  authRecoveryVersion = owner;
  try {
    const value = await api.call('status', {});
    if (owner === accountVersion && !changingAccount) await applyStatus(value);
  } catch (error) {
    if (owner === accountVersion && status.value) {
      bootstrapError.value = message(error);
      await applyStatus({ ...status.value, account: null, capabilities: { progress: false, watched: false, episodeSync: false } });
      focusFirst(document.querySelector('.boot-screen') || document);
    }
  } finally { if (authRecoveryVersion === owner) authRecoveryVersion = -1; }
}
async function applyStatus(value: Status) {
  const changed = status.value?.account?.id !== value.account?.id || status.value?.mirror !== value.mirror;
  if (changed) {
    changingAccount = true; accountVersion++;
    beginRequest(); if (searchTimer) clearTimeout(searchTimer); if (retryTimer) clearTimeout(retryTimer);
    playerOpen.value = false;
    const publicOrigin = status.value?.mirror === value.mirror && route.value.name === 'profile' ? [...history].reverse().find(item => item.name !== 'profile' && item.name !== 'bookmarks') : undefined;
    cache.clear(); snapshots.clear(); history.length = 0;
    if (publicOrigin) history.push(publicOrigin);
    cards.value = []; lists.value = []; selectedList.value = ''; details.value = undefined; person.value = undefined; detailSummary.value = undefined; requestedContinue = undefined;
    translator.value = ''; selectedSeason.value = 1; selectedEpisode.value = undefined; selectedScheduleSeason.value = undefined; scheduleExpanded.value = false;
    query.value = ''; searchedQuery.value = ''; page.value = 1; hasMore.value = false; loadMoreFailed.value = false;
    loading.value = false; screenError.value = ''; listsError.value = ''; detailBookmarked.value = undefined; confirmedBookmarks.clear(); bookmarksComplete.value = false;
    watchedPending.clear(); watchedDesired.clear(); watchedFailures.clear(); watchedNote.value = '';
    episodeRetry = undefined; episodeSyncError.value = '';
    modalToken++; modal.value = null; modalOrigin = null; modalError.value = ''; modalBusy.value = false;
    trailerToken++; trailerController.abort(); trailerOpen.value = false; trailerLoading.value = false; trailerUrl.value = ''; trailerStarted.value = false; trailerError.value = ''; trailerOrigin = null;
    shelves.forEach(shelf => { shelf.items = []; shelf.error = ''; shelf.loading = false; });
    if (route.value.name !== 'profile') route.value = { name: 'home', title: 'Главная' };
    // Unmount the old player and settle its in-flight write before switching queues.
    await nextTick(); await saves?.idle();
    if (!value.account) saves?.clear();
  }
  status.value = value; mirror.value = value.mirror; searchHistory.value = readSearchHistory();
  const owner = accountVersion;
  // Never await recovery from a failed save: applyStatus waits for that write to settle.
  api.onAuthRequired = () => { void recoverAccount(owner); };
  restoreQueue(); changingAccount = false;
  await loadRoute();
}
async function initialize() {
  initializing.value = true; bootstrapError.value = ''; accountError.value = '';
  try {
    await saves?.idle();
    const value = await api.call('status', {});
    initializing.value = false;
    await applyStatus(value);
  } catch (error) { bootstrapError.value = message(error); }
  finally { initializing.value = false; await nextTick(); if (bootstrapError.value) focusFirst(document.querySelector('.boot-screen') || document); }
}
async function login() {
  if (!username.value.trim() || !password.value || loginBusy.value) return;
  loginBusy.value = true; accountError.value = '';
  const secret = password.value;
  if (retryTimer) clearTimeout(retryTimer);
  try {
    await saves?.idle();
    const result = await api.call('login', { username: username.value.trim(), password: secret });
    if (!result.account) throw new Error('Сервер не подтвердил вход. Проверьте данные аккаунта.');
    await applyStatus(result);
  } catch (error) { accountError.value = message(error); }
  finally { password.value = ''; loginBusy.value = false; }
}
async function configure() {
  settingsBusy.value = true; accountError.value = ''; settingsNote.value = '';
  try {
    await saves?.idle();
    if (saves?.pending().length) { accountError.value = 'Сначала сохраните или удалите очередь прогресса в уведомлении. Затем можно сменить зеркало.'; return; }
    const value = await api.call('configure', { mirror: mirror.value.trim() });
    await applyStatus(value); settingsNote.value = 'Зеркало проверено и сохранено.';
  } catch (error) { accountError.value = message(error); }
  finally { settingsBusy.value = false; }
}
function capture() {
  snapshots.set(routeKey(route.value), {
    focus: (document.activeElement as HTMLElement)?.dataset.navId || '', scroll: scroller.value?.scrollTop || 0,
    rows: [...(scroller.value?.querySelectorAll<HTMLElement>('.poster-row') || [])].map(row => row.scrollLeft),
    ...(route.value.name === 'details' ? { detail: { summary: detailSummary.value ? { ...detailSummary.value } : undefined, season: selectedSeason.value, episode: selectedEpisode.value, scheduleSeason: selectedScheduleSeason.value, scheduleExpanded: scheduleExpanded.value } } : {}),
  });
}
async function restoreFocus() {
  await nextTick();
  const snapshot = snapshots.get(routeKey(route.value));
  if (scroller.value) {
    scroller.value.scrollTop = snapshot?.scroll || 0;
    [...scroller.value.querySelectorAll<HTMLElement>('.poster-row')].forEach((row, index) => { row.scrollLeft = snapshot?.rows[index] || 0; });
  }
  const target = snapshot?.focus ? [...document.querySelectorAll<HTMLElement>('[data-nav-id]')].find(item => item.dataset.navId === snapshot.focus) : null;
  if (target) target.focus({ preventScroll: true }); else if (!playerOpen.value && !modal.value) focusFirst(scroller.value || document);
  return !!target;
}
async function navigate(target: Route, push = true, captured = false) {
  if (initializing.value || bootstrapError.value) return;
  if (routeKey(route.value) === routeKey(target) && target.name !== 'details') {
    snapshots.delete(routeKey(target));
    scroller.value?.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    await nextTick(); focusFirst(scroller.value || document); return;
  }
  if (!captured) capture();
  if (push) { history.push({ ...route.value }); snapshots.delete(routeKey(target)); }
  route.value = target; screenError.value = '';
  if (push) { await nextTick(); if (scroller.value) scroller.value.scrollTop = 0; }
  await loadRoute(!push);
}
function beginRequest() {
  screenController.abort(); screenController = new AbortController();
  sourceController.abort(); sourceKey = ''; sourceRequest = undefined;
  preparedSource.value = undefined; sourceError.value = '';
  return ++requestVersion;
}
async function loadRoute(restoreAtStart = false) {
  if (initializing.value || bootstrapError.value) return;
  const inputAtStart = inputVersion;
  const version = beginRequest();
  let restoredTarget = false;
  loading.value = false; loadMoreFailed.value = false;
  if (route.value.name === 'home') { if (restoreAtStart) restoredTarget = await restoreFocus(); await Promise.all(visibleShelves.value.map(shelf => loadShelf(shelf, version))); }
  else if (route.value.name === 'profile') { if (restoreAtStart) restoredTarget = await restoreFocus(); await refreshAccount(version); }
  else if (route.value.name === 'details') {
    const saved = restoreAtStart ? snapshots.get(routeKey(route.value))?.detail : undefined;
    if (saved) {
      detailSummary.value = saved.summary ? { ...saved.summary } : undefined;
      selectedSeason.value = saved.season; selectedEpisode.value = saved.episode; selectedScheduleSeason.value = saved.scheduleSeason; scheduleExpanded.value = saved.scheduleExpanded;
    }
    if (restoreAtStart) restoredTarget = await restoreFocus();
    await loadDetails(version, undefined, !!saved);
  }
  else if (route.value.name === 'person') { if (restoreAtStart) restoredTarget = await restoreFocus(); await loadPerson(version); }
  else if (route.value.name === 'catalog' || route.value.name === 'bookmarks') {
    const cached = cache.get(routeKey(route.value));
    cards.value = cached?.items || []; page.value = cached?.page || 1; hasMore.value = cached?.hasMore || false;
    loading.value = !cached;
    if (restoreAtStart) restoredTarget = await restoreFocus();
    if (route.value.name === 'bookmarks') await loadLists();
    if (version !== requestVersion) return;
    if (!cached) await loadCards(false, version);
    else { loading.value = false; screenError.value = ''; }
  } else if (route.value.name === 'search') {
    const searchRouteKey = routeKey(route.value);
    const cached = cache.get(routeKey(route.value));
    if (cached && searchedQuery.value === query.value.trim()) { cards.value = cached.items; page.value = cached.page; hasMore.value = cached.hasMore; loading.value = false; await restoreFocus(); maybeLoadMore(); return; }
    cards.value = []; hasMore.value = false;
    const restoredSearchTarget = await restoreFocus();
    if (query.value.trim()) await search();
    if (restoreAtStart && !restoredSearchTarget && inputAtStart === inputVersion && routeKey(route.value) === searchRouteKey) await restoreFocus();
    return;
  }
  if (version === requestVersion && inputAtStart === inputVersion) {
    if (!restoreAtStart || !restoredTarget || !scroller.value?.contains(document.activeElement)) await restoreFocus();
    maybeLoadMore();
  }
}
async function refreshAccount(version = requestVersion) {
  const owner = accountVersion;
  accountLoading.value = true;
  accountError.value = '';
  try {
    const result = await api.call('status', {}, { signal: screenController.signal });
    if (owner !== accountVersion || version !== requestVersion) return;
    if (result.account?.id !== status.value?.account?.id || result.mirror !== status.value?.mirror) await applyStatus(result);
    else status.value = result;
  } catch (error) { if (owner === accountVersion && version === requestVersion && !screenController.signal.aborted) accountError.value = message(error); }
  finally { if (version === requestVersion) accountLoading.value = false; }
}
async function loadShelf(shelf: Shelf, version = requestVersion) {
  const shelfRequest = (shelfRequests.get(shelf.id) || 0) + 1;
  shelfRequests.set(shelf.id, shelfRequest);
  const current = () => version === requestVersion && shelfRequests.get(shelf.id) === shelfRequest;
  shelf.loading = true; shelf.error = '';
  try {
    const options = { signal: screenController.signal };
    const result = shelf.id === 'continue' ? await api.call('continueWatching', { page: 1 }, options) : shelf.id === 'bookmarks' ? await api.call('bookmarks', { page: 1 }, options) : await api.call('catalog', { sort: shelf.id === 'new' ? 'new' : 'popular', page: 1 }, options);
    if (current()) {
      shelf.items = result.items;
      if (shelf.id === 'bookmarks') {
        bookmarksComplete.value = !result.hasMore;
        if (bookmarksComplete.value) confirmedBookmarks.clear();
        result.items.forEach(item => confirmedBookmarks.add(item.id));
      }
    }
  } catch (error) { if (current() && !screenController.signal.aborted) shelf.error = message(error); }
  finally { if (current()) shelf.loading = false; }
}
async function loadCards(more = false, version = requestVersion) {
  if (more && (loading.value || !hasMore.value || cards.value.length >= 200)) return;
  loading.value = true; screenError.value = ''; loadMoreFailed.value = false;
  let succeeded = false;
  const targetPage = more ? page.value + 1 : 1;
  const snapshot = { ...route.value };
  const listId = selectedList.value;
  const key = routeKey(snapshot, listId);
  try {
    const options = { signal: screenController.signal };
    const result = snapshot.name === 'search' ? await api.call('search', { query: searchedQuery.value, page: targetPage }, options) : snapshot.name === 'bookmarks' ? await api.call('bookmarks', { listId: listId || undefined, page: targetPage }, options) : await api.call('catalog', { category: snapshot.category, page: targetPage, sort: 'new' }, options);
    if (version !== requestVersion) return;
    cards.value = (more ? [...cards.value, ...result.items.filter(item => !cards.value.some(existing => existing.id === item.id))] : result.items).slice(0, 200);
    page.value = result.page; hasMore.value = result.hasMore && cards.value.length < 200;
    if (snapshot.name === 'bookmarks') {
      if (!listId) bookmarksComplete.value = !result.hasMore;
      if (!listId && bookmarksComplete.value) confirmedBookmarks.clear();
      cards.value.forEach(item => confirmedBookmarks.add(item.id));
    }
    // ponytail: retain 200 cards per route; use virtualized lists if browsing thousands becomes necessary.
    cache.set(key, { ...result, items: cards.value, hasMore: hasMore.value });
    if (cache.size > 8) cache.delete(cache.keys().next().value!);
    succeeded = true;
  } catch (error) { if (version === requestVersion && !screenController.signal.aborted) { screenError.value = message(error); loadMoreFailed.value = more; } }
  finally { if (version === requestVersion) { loading.value = false; if (succeeded) void nextTick(maybeLoadMore); } }
}
function maybeLoadMore() {
  const root = scroller.value;
  if (!root || !['catalog', 'search', 'bookmarks'].includes(route.value.name) || loading.value || screenError.value || !hasMore.value || cards.value.length >= 200) return;
  if (root.scrollHeight - root.scrollTop - root.clientHeight <= root.clientHeight * .6) void loadCards(true);
}
function retryCards() {
  if (loadMoreFailed.value) {
    scroller.value?.querySelector<HTMLElement>('.poster-grid .poster-card:last-child')?.focus({ preventScroll: true });
    void loadCards(true);
  } else void loadCards(false, beginRequest());
}
async function search(remember = false) {
  if (searchTimer) clearTimeout(searchTimer);
  const version = beginRequest(); searchedQuery.value = query.value.trim(); cards.value = []; screenError.value = ''; hasMore.value = false; loadMoreFailed.value = false;
  if (!searchedQuery.value) { loading.value = false; return; }
  if (remember) rememberSearch(searchedQuery.value);
  await loadCards(false, version);
}
function repeatSearch(value: string) { query.value = value; void search(true); }
function focusSearchElement(event: KeyboardEvent, selector: string) {
  const target = document.querySelector<HTMLElement>(selector);
  if (!target) return;
  event.preventDefault(); event.stopPropagation(); target.focus({ preventScroll: true });
}
function navigateSearchInput(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') { focusSearchElement(event, '.search-history-query,.poster-grid .poster-card'); return; }
  const input = event.currentTarget as HTMLInputElement;
  if (event.key === 'ArrowRight' && input.selectionStart === input.value.length && input.selectionEnd === input.value.length) focusSearchElement(event, '[data-nav-id="search-submit"]');
}
function navigateSearchHistory(event: KeyboardEvent) {
  const current = event.currentTarget as HTMLElement;
  const items = [...document.querySelectorAll<HTMLElement>('.search-history-query')];
  const index = items.indexOf(current);
  if (event.key === 'ArrowUp') focusSearchElement(event, '[data-nav-id="search-submit"]');
  else if (event.key === 'ArrowDown') focusSearchElement(event, '.poster-grid .poster-card');
  else if (event.key === 'ArrowRight') focusSearchElement(event, index < items.length - 1 ? `.search-history-query:nth-child(${index + 2})` : '[data-nav-id="search-clear"]');
  else if (event.key === 'ArrowLeft' && index > 0) focusSearchElement(event, `.search-history-query:nth-child(${index})`);
}
function scheduleSearch() { if (searchTimer) clearTimeout(searchTimer); beginRequest(); searchTimer = setTimeout(() => { if (route.value.name === 'search') void search(); }, 350); }
async function loadLists() {
  listsError.value = '';
  const version = accountVersion;
  const signal = screenController.signal;
  try { const result = await api.call('bookmarkLists', {}, { signal }); if (version === accountVersion && !signal.aborted) lists.value = result; }
  catch (error) { if (version === accountVersion && !signal.aborted) listsError.value = message(error); }
}
async function openPerson(item: PersonSummary) {
  person.value = undefined;
  await navigate({ name: 'person', title: item.name, url: item.url });
}
async function loadPerson(version = requestVersion) {
  if (person.value?.url === route.value.url) { loading.value = false; return; }
  loading.value = true; screenError.value = '';
  try {
    const value = await api.call('person', { url: route.value.url! }, { signal: screenController.signal });
    if (version === requestVersion) person.value = value;
  } catch (error) { if (version === requestVersion && !screenController.signal.aborted) screenError.value = message(error); }
  finally { if (version === requestVersion) loading.value = false; }
}
async function openContent(item: Content | ContinueItem) {
  capture();
  requestedContinue = 'progress' in item ? item.progress : undefined;
  detailSummary.value = { id: item.id, url: item.url, title: item.title, type: item.type, meta: item.meta, status: item.status };
  const bookmarked = route.value.name === 'bookmarks' || confirmedBookmarks.has(item.id) || !!shelves.find(shelf => shelf.id === 'bookmarks')?.items.some(bookmark => bookmark.id === item.id);
  detailBookmarked.value = bookmarked ? true : bookmarksComplete.value ? false : undefined;
  details.value = undefined;
  selectedScheduleSeason.value = undefined;
  scheduleExpanded.value = false;
  descriptionExpanded.value = false;
  await navigate({ name: 'details', title: item.title, url: item.url }, true, true);
}
async function loadDetails(version = requestVersion, requestedTranslator?: string, preserveEpisode = false) {
  loading.value = true; screenError.value = '';
  try {
    const value = await api.call('details', { url: route.value.url!, translatorId: requestedTranslator }, { signal: screenController.signal });
    if (version !== requestVersion) return;
    details.value = value;
    const desired = requestedTranslator || selectTranslator(value.translators, preferences.translatorId, requestedContinue?.translatorId || requestedContinue?.providerTranslatorId, value.selectedTranslatorId);
    translator.value = value.translators.find(item => item.id === desired)?.id || value.selectedTranslatorId || value.translators[0]?.id || '';
    if (!requestedTranslator && desired && translator.value === desired && (value.selectedTranslatorId || value.translators[0]?.id) !== desired) { await loadDetails(version, desired, preserveEpisode); return; }
    const wanted = preserveEpisode ? { season: selectedSeason.value, episode: selectedEpisode.value } : requestedContinue;
    const selected = value.episodes.find(item => item.season === wanted?.season && item.episode === wanted?.episode) || value.episodes.find(item => !item.watched) || value.episodes[0];
    selectedSeason.value = selected?.season || 1; selectedEpisode.value = selected?.episode;
    if (!value.schedule?.some(item => item.season === selectedScheduleSeason.value)) { selectedScheduleSeason.value = value.schedule?.[0]?.season; scheduleExpanded.value = false; }
  } catch (error) { if (version === requestVersion && !screenController.signal.aborted) screenError.value = message(error); }
  finally { if (version === requestVersion) loading.value = false; }
}
async function setEpisodeWatched(change: WatchedChange) {
  const key = watchedKey(change);
  if (!status.value?.account || !status.value.capabilities.watched) return;
  if (watchedPending.has(key)) { watchedDesired.set(key, change); return; }
  const version = accountVersion;
  watchedPending.add(key); watchedNote.value = '';
  let confirmed = false;
  try {
    await api.call('setEpisodeWatched', change);
    if (version !== accountVersion) return;
    confirmed = true; watchedFailures.delete(key);
    watchedNote.value = `Сезон ${change.season}, серия ${change.episode}: ${change.watched ? 'просмотрено' : 'отметка снята'} в аккаунте.`;
    if (details.value?.url === change.url) {
      const selected = details.value.episodes.find(item => item.season === change.season && item.episode === change.episode);
      if (selected) selected.watched = change.watched;
      if (route.value.name === 'details') {
        const refresh = ++watchedRefreshVersion; const request = requestVersion; const voice = translator.value; const signal = screenController.signal;
        const refreshed = await api.call('details', { url: change.url, translatorId: voice }, { signal });
        if (version === accountVersion && refresh === watchedRefreshVersion && request === requestVersion && translator.value === voice && details.value?.url === change.url && !signal.aborted) details.value.episodes = refreshed.episodes;
      }
    }
    const shelf = shelves.find(item => item.id === 'continue');
    if (shelf && route.value.name === 'home') void loadShelf(shelf);
  } catch (error) {
    if (version !== accountVersion || confirmed && (error as { code?: string }).code === 'ABORTED') return;
    watchedFailures.set(key, { change, error: `${confirmed ? 'Отметка сохранена, обновление списка не удалось' : 'Отметка не сохранена'} (сезон ${change.season}, серия ${change.episode}). ${message(error)}` });
  } finally {
    if (version === accountVersion) {
      watchedPending.delete(key);
      const desired = watchedDesired.get(key); watchedDesired.delete(key);
      if (desired && desired.watched !== change.watched) void setEpisodeWatched(desired);
    }
  }
}
function retryWatched() { for (const item of watchedFailures.values()) void setEpisodeWatched(item.change); }
function focusVoiceover(event: KeyboardEvent) {
  const target = (event.currentTarget as HTMLElement).closest('.detail-info')?.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="Озвучка"]:not(:disabled)');
  if (!target) return;
  event.preventDefault(); event.stopPropagation(); target.focus({ preventScroll: true });
}
function focusWatch(event: KeyboardEvent) {
  const target = (event.currentTarget as HTMLElement).closest('.detail-info')?.querySelector<HTMLButtonElement>('[data-nav-id="detail-play"]:not(:disabled)');
  if (!target) return;
  event.preventDefault(); event.stopPropagation(); target.focus({ preventScroll: true });
}
function focusSchedule(event: KeyboardEvent) {
  const target = (event.currentTarget as HTMLElement).closest('.title-detail')?.querySelector<HTMLButtonElement>('.detail-schedule [role="combobox"]:not(:disabled),.detail-schedule .schedule-toggle:not(:disabled)');
  if (!target) return;
  event.preventDefault(); event.stopPropagation(); target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
async function changeTranslator() { updatePreferences({ ...preferences, translatorId: translator.value }); await loadDetails(beginRequest(), translator.value, true); }
function changeSeason() { selectedEpisode.value = episodes.value[0]?.episode; }
function changeScheduleSeason(value: string | number) { selectedScheduleSeason.value = Number(value); scheduleExpanded.value = false; }
async function prepareSource(force = false): Promise<PlaybackSource | undefined> {
  const key = selectionKey.value;
  if (!key || !details.value || route.value.name !== 'details' || playerOpen.value) return;
  if (!force && key === sourceKey) return sourceRequest || preparedSource.value;
  sourceController.abort(); sourceController = new AbortController();
  const signal = sourceController.signal;
  sourceKey = key; preparedSource.value = undefined; sourceError.value = '';
  const params = { id: details.value.id, url: details.value.url, translatorId: translator.value, season: chosenEpisode.value?.season, episode: chosenEpisode.value?.episode };
  sourceRequest = api.call('streams', params, { signal }).then(value => {
    if (signal.aborted || key !== selectionKey.value) return;
    preparedSource.value = value;
    return value;
  }).catch(error => {
    if (!signal.aborted && key === selectionKey.value) sourceError.value = message(error);
    return undefined;
  }).finally(() => { if (!signal.aborted) sourceRequest = undefined; });
  return sourceRequest;
}
watch(() => route.value.name === 'details' && !loading.value && !playerOpen.value ? selectionKey.value : '', key => { if (key) void prepareSource(); });
async function play() {
  if (!details.value || !selectionKey.value || playStarting.value || trailerOpen.value) return;
  const key = selectionKey.value;
  const dialogVersion = modalToken;
  capture(); playStarting.value = true;
  try {
    const source = await prepareSource(!!sourceError.value);
    if (!source || key !== selectionKey.value || route.value.name !== 'details' || dialogVersion !== modalToken || trailerOpen.value) return;
    playbackSource.value = source;
    updatePreferences({ ...preferences, translatorId: translator.value }); playerOpen.value = true;
  } finally { playStarting.value = false; }
}
function updatePlaybackSelection(value: { details: Details; translatorId: string; episode?: Episode }) {
  details.value = value.details; translator.value = value.translatorId;
  selectedSeason.value = value.episode?.season || 1; selectedEpisode.value = value.episode?.episode;
  requestedContinue = undefined;
}
async function closePlayer() { sourceKey = ''; playbackSource.value = undefined; playerOpen.value = false; await restoreFocus(); }
async function openTrailer() {
  if (!details.value?.trailerAvailable || trailerOpen.value || playStarting.value || playerOpen.value) return;
  const selected = details.value;
  const token = ++trailerToken;
  trailerController.abort(); trailerController = new AbortController();
  trailerOrigin = document.activeElement as HTMLElement;
  trailerOpen.value = true; trailerLoading.value = true; trailerUrl.value = ''; trailerStarted.value = false; trailerError.value = '';
  await nextTick(); focusFirst(document.querySelector('.trailer-backdrop') || document);
  try {
    const result = await api.call('trailer', { id: selected.id, url: selected.url }, { signal: trailerController.signal });
    if (token === trailerToken && trailerOpen.value) {
      trailerUrl.value = result.url;
      await nextTick(); document.querySelector<HTMLButtonElement>('[data-nav-id="trailer-start"]')?.focus({ preventScroll: true });
    }
  } catch (error) {
    if (token === trailerToken && trailerOpen.value && !trailerController.signal.aborted) trailerError.value = message(error);
  } finally { if (token === trailerToken) trailerLoading.value = false; }
}
async function startTrailer() {
  if (!trailerOpen.value || !trailerUrl.value || trailerStarted.value) return;
  trailerStarted.value = true;
  await nextTick(); document.querySelector<HTMLButtonElement>('[data-nav-id="trailer-close"]')?.focus({ preventScroll: true });
}
async function closeTrailer() {
  trailerToken++; trailerController.abort(); trailerOpen.value = false; trailerLoading.value = false; trailerUrl.value = ''; trailerStarted.value = false; trailerError.value = '';
  await nextTick(); trailerOrigin?.focus({ preventScroll: true });
}
async function openModal(value: typeof modal.value) {
  const token = ++modalToken;
  modalOrigin = document.activeElement as HTMLElement; modal.value = value; modalError.value = '';
  if (value === 'bookmark') { await loadLists(); if (!selectedList.value) selectedList.value = lists.value[0]?.id || ''; }
  if (token !== modalToken) return;
  await nextTick(); focusFirst(document.querySelector('.modal-backdrop') || document);
}
async function closeModal() { modalToken++; modal.value = null; await nextTick(); modalOrigin?.focus({ preventScroll: true }); }
async function setBookmark(added: boolean) {
  if (!details.value || !selectedList.value) return;
  modalBusy.value = true; modalError.value = '';
  const detailId = details.value.id;
  const token = modalToken;
  const version = accountVersion;
  try {
    await api.call('setBookmark', { id: details.value.id, listId: selectedList.value, added });
    if (version !== accountVersion) return;
    for (const key of cache.keys()) if (key.startsWith('bookmarks:')) cache.delete(key);
    for (const key of snapshots.keys()) if (key.startsWith('bookmarks:')) snapshots.delete(key);
    const shelf = shelves.find(item => item.id === 'bookmarks');
    if (shelf && route.value.name === 'home') void loadShelf(shelf);
    else if (shelf) shelf.items = [];
    if (route.value.name === 'bookmarks') void loadCards(false, beginRequest());
    if (added) confirmedBookmarks.add(detailId); else { confirmedBookmarks.delete(detailId); bookmarksComplete.value = false; }
    if (details.value?.id === detailId) detailBookmarked.value = added ? true : undefined;
    if (token === modalToken) await closeModal();
  }
  catch (error) { if (version !== accountVersion) return; if (token === modalToken) modalError.value = message(error); }
  finally { if (version === accountVersion) modalBusy.value = false; }
}
async function logout() {
  modalBusy.value = true; modalError.value = '';
  try {
    await saves?.idle();
    if (saves?.pending().length) { modalError.value = 'Есть несохранённый прогресс. Повторите сохранение или явно удалите очередь в уведомлении перед выходом.'; return; }
    if (retryTimer) clearTimeout(retryTimer);
    await applyStatus(await api.call('logout', {})); username.value = ''; password.value = '';
    await nextTick(); focusFirst(document.querySelector('.login-form') || document);
  } catch (error) { modalError.value = message(error); }
  finally { modalBusy.value = false; }
}
function discardSaves() { recovered.value = false; saves?.clear(); void closeModal(); }
function back() {
  if (initializing.value || bootstrapError.value) { platformBack(); return; }
  if (trailerOpen.value) { void closeTrailer(); return; }
  if (modal.value) { void closeModal(); return; }
  if (playerOpen.value) { playerRef.value?.requestBack(); return; }
  const previous = history.pop();
  if (previous) { void navigate(previous, false); return; }
  if (route.value.name !== 'home') { void navigate({ name: 'home', title: 'Главная' }, false); return; }
  if (!platformBack()) document.querySelector<HTMLElement>('[data-nav-id="nav-home"]')?.focus();
}
function refreshHomeOnVisible() {
  if (document.hidden || !status.value?.account || route.value.name !== 'home' || playerOpen.value || modal.value || trailerOpen.value) return;
  for (const shelf of shelves) if (shelf.id === 'continue' || shelf.id === 'bookmarks') void loadShelf(shelf);
}
onMounted(() => {
  for (const event of ['keydown', 'pointerdown', 'wheel']) document.addEventListener(event, recordInput, { capture: true, passive: true });
  removeNavigation = installNavigation(back); document.addEventListener('visibilitychange', refreshHomeOnVisible); void initialize();
});
onBeforeUnmount(() => {
  api.onAuthRequired = undefined;
  for (const event of ['keydown', 'pointerdown', 'wheel']) document.removeEventListener(event, recordInput, true);
  removeNavigation?.(); document.removeEventListener('visibilitychange', refreshHomeOnVisible); screenController.abort(); sourceController.abort(); trailerController.abort(); if (searchTimer) clearTimeout(searchTimer); if (retryTimer) clearTimeout(retryTimer);
});
</script>
<template>
  <div v-if="api.mode === 'fixture'" class="fixture-banner" role="status">ТЕСТОВЫЙ РЕЖИМ · демонстрационные данные · реальный аккаунт не используется</div>
  <SkeletonView v-if="initializing" kind="boot" />
  <main v-else-if="bootstrapError" class="boot-screen" data-focus-scope><div class="boot-content"><img class="boot-mark" :src="iconUrl" alt="" width="130" height="130" /><h1>Нет соединения</h1><p role="alert">{{ bootstrapError }}</p><button class="primary" @click="initialize">Повторить соединение</button></div></main>
  <div v-else class="app-shell" :inert="playerOpen || trailerOpen || modal !== null || undefined">
    <aside class="sidebar"><div class="wordmark"><span class="brand-mark">r</span><span>rezka<span class="brand-light">client</span></span></div><nav aria-label="Главное меню">
      <button data-nav-id="nav-home" :class="{ active: route.name === 'home' }" @click="navigate({ name: 'home', title: 'Главная' })"><AppIcon name="home" />Главная</button>
      <button data-nav-id="nav-search" :class="{ active: route.name === 'search' }" @click="navigate({ name: 'search', title: 'Поиск' })"><AppIcon name="search" />Поиск</button>
      <button v-if="status?.account" data-nav-id="nav-bookmarks" :class="{ active: route.name === 'bookmarks' }" @click="navigate({ name: 'bookmarks', title: 'Мои закладки' })"><AppIcon name="bookmark" />Закладки</button>
      <span class="nav-label">КАТАЛОГ</span>
      <button v-for="category in categories" :key="category.id" :data-nav-id="`nav-${category.id}`" :class="{ active: route.category === category.id }" @click="navigate({ name: 'catalog', title: category.label, category: category.id })"><AppIcon :name="category.icon" />{{ category.label }}</button>
    </nav><div class="sidebar-footer"><div class="sidebar-account" role="group" :aria-label="status?.account ? `Профиль аккаунта ${status.account.name}` : 'Профиль гостя'">
      <button class="profile-entry" data-nav-id="nav-profile" :class="{ active: route.name === 'profile' }" :aria-label="status?.account ? `Профиль аккаунта ${accountName}` : 'Профиль, войти в аккаунт'" @click="navigate({ name: 'profile', title: 'Профиль' })"><span class="avatar" aria-hidden="true">{{ status?.account ? accountName.slice(0, 1).toUpperCase() : '○' }}</span><span class="profile-summary"><strong>Профиль</strong><small>{{ status?.account ? accountName : 'Войти в аккаунт' }}</small></span></button>
      <button v-if="status?.account && sync.status === 'failed'" class="save-retry-icon" aria-label="Проверить сохранение просмотра" title="Проверить сохранение просмотра" @click="openModal('unsent')"><AppIcon name="refresh" /></button><button v-else-if="status?.account && episodeSyncError" class="save-retry-icon" aria-label="Повторить передачу серии" title="Повторить передачу серии" :disabled="sync.count > 0" @click="retryEpisodeSync"><AppIcon name="refresh" /></button>
    </div></div></aside>
    <main ref="scroller" class="content-area" @scroll.passive="maybeLoadMore"><header v-if="route.name !== 'home' && route.name !== 'details' && route.name !== 'person'" class="page-header"><h1>{{ route.title }}</h1></header><h1 v-else-if="route.name === 'home'" class="sr-only">Что посмотрим сегодня?</h1>
      <div v-if="visibleWarnings.length" class="warning-strip" role="status">{{ visibleWarnings.join(' · ') }}</div>
      <div v-if="watchedPending.size || watchedNote || watchedError" class="sync-notice" :class="{ failed: !!watchedError }" role="status"><span>{{ watchedError || (watchedPending.size ? 'Обновляем отметки просмотренных серий…' : watchedNote) }}</span><button v-if="watchedError" @click="retryWatched">Повторить отметки</button><button v-else-if="!watchedPending.size" @click="watchedNote = ''" aria-label="Закрыть уведомление о просмотренных сериях">×</button></div>
      <template v-if="route.name === 'home'"><section v-for="shelf in visibleShelves" :key="shelf.id" class="shelf"><div class="section-heading"><div><h2>{{ shelf.title }}</h2><p>{{ shelf.subtitle }}</p></div></div><SkeletonView v-if="shelf.loading && !shelf.items.length" kind="shelves" /><div v-if="shelf.error" class="empty-state compact" role="alert"><p>{{ shelf.error }}</p><button @click="loadShelf(shelf)">Повторить</button></div><div v-else-if="!shelf.loading && !shelf.items.length" class="empty-state compact"><span aria-hidden="true">{{ shelf.id === 'continue' ? '▷' : '＋' }}</span><div><h3>{{ shelf.id === 'continue' ? 'История начинается с первого фильма' : shelf.id === 'bookmarks' ? 'Ваши будущие любимые фильмы' : 'Пока ничего нет' }}</h3><p>{{ shelf.id === 'continue' ? 'Доступные записи из аккаунта появятся здесь.' : shelf.id === 'bookmarks' ? 'Добавляйте фильмы и сериалы в списки из карточки.' : 'Попробуйте обновить раздел немного позже.' }}</p></div></div><div v-if="shelf.items.length" class="poster-row"><PosterCard v-for="item in shelf.items" :key="item.id" :item="item" :context="shelf.id" @select="openContent" /></div></section></template>
      <template v-else-if="route.name === 'search' || route.name === 'catalog' || route.name === 'bookmarks'">
        <template v-if="route.name === 'search'"><form class="search-form" @submit.prevent="search(true)"><label class="sr-only" for="search-query">Название фильма или сериала</label><input id="search-query" v-model="query" name="query" data-nav-id="search-input" data-autofocus placeholder="Название фильма или сериала…" type="search" autocomplete="off" @input="scheduleSearch" @keydown="navigateSearchInput" /><button class="primary" data-nav-id="search-submit" type="submit" @keydown.left="focusSearchElement($event, '#search-query')" @keydown.down="focusSearchElement($event, '.search-history-query,.poster-grid .poster-card')">Найти</button></form><section v-if="searchHistory.length" class="search-history" role="region" aria-label="Недавние запросы"><div class="search-history-heading"><span>Недавние запросы</span><button class="quiet" data-nav-id="search-clear" type="button" @click="clearSearchHistory" @keydown.up="focusSearchElement($event, '[data-nav-id=search-submit]')" @keydown.left="focusSearchElement($event, '.search-history-query:last-child')" @keydown.down="focusSearchElement($event, '.poster-grid .poster-card')">Очистить</button></div><div class="search-history-items"><button v-for="item in searchHistory" :key="item" class="search-history-query" type="button" @click="repeatSearch(item)" @keydown="navigateSearchHistory">{{ item }}</button></div></section></template>
        <div v-if="route.name === 'bookmarks'" class="bookmarks-toolbar"><TvSelect label="Список аккаунта" :model-value="selectedList" :options="[{ value: '', label: 'Все закладки' }, ...lists.map(list => ({ value: list.id, label: `${list.name}${list.count === undefined ? '' : ` (${list.count})`}` }))]" @update:model-value="selectedList = String($event)" @change="loadCards(false, beginRequest())" /><p v-if="listsError" class="error-text" role="alert">{{ listsError }}</p></div>
        <p v-if="cards.length >= 200" class="muted">{{ route.name === 'search' ? 'Показаны первые 200 результатов. Уточните поиск.' : 'Показаны первые 200 записей.' }}</p>
        <SkeletonView v-if="loading && !cards.length" kind="grid" /><div v-if="screenError && !cards.length" class="error-box" role="alert"><p>{{ screenError }}</p><button @click="retryCards">Повторить</button></div><p v-if="!cards.length && !loading && !screenError && (route.name !== 'search' || searchedQuery)" class="empty-message" role="status">Ничего не найдено</p><div class="poster-grid" :aria-busy="loading"><PosterCard v-for="item in cards" :key="item.id" :item="item" :context="route.name" @select="openContent" /></div><SkeletonView v-if="loading && cards.length" kind="grid" :count="5" /><div v-if="screenError && cards.length" class="pagination-error" role="alert"><span>{{ screenError }}</span><button @click="retryCards">Повторить</button></div><span v-if="loading" class="sr-only" role="status">{{ cards.length ? 'Загружаем ещё…' : 'Загружаем результаты…' }}</span>
      </template>
      <template v-else-if="route.name === 'details'">
        <SkeletonView v-if="loading && !details" kind="details" />
        <div v-if="screenError" class="error-box" role="alert"><p>{{ screenError }}</p><button @click="loadDetails(beginRequest())">Повторить</button></div>
        <article v-if="details" class="title-detail" :aria-busy="loading">
          <div class="detail-hero">
            <div class="detail-artwork"><img v-if="details.poster" :key="details.poster" :src="details.poster" :alt="details.title" width="360" height="540" @error="($event.target as HTMLImageElement).style.display = 'none'" /><span class="detail-artwork-fallback" aria-hidden="true">{{ details.title.slice(0, 1) }}</span><span v-if="details.rating?.trim() && !detailRatings.length" class="detail-rating">{{ details.rating }}</span></div>
            <div class="detail-info">
              <div class="detail-heading">
                <div class="detail-title"><h1>{{ details.title }}</h1><p v-if="details.originalTitle?.trim()" class="detail-original-title">{{ details.originalTitle }}</p></div>
                <ul v-if="detailRatings.length" class="detail-ratings" aria-label="Рейтинги"><li v-for="rating in detailRatings" :key="rating.source"><span>{{ rating.source }}</span><strong>{{ rating.score }}</strong><small v-if="rating.votes?.trim()">{{ rating.votes }} голосов</small></li></ul>
              </div>
              <dl v-if="detailFacts.length" class="detail-facts"><div v-for="fact in detailFacts" :key="fact.label"><dt>{{ fact.label }}</dt><dd>{{ fact.value }}</dd></div></dl>
              <ul v-if="details.rankings?.length" class="detail-rankings" aria-label="Места в подборках"><li v-for="ranking in details.rankings" :key="`${ranking.name}:${ranking.place || ''}`"><strong v-if="ranking.place">№ {{ ranking.place }}</strong><span>{{ ranking.name }}</span></li></ul>
              <div class="detail-synopsis"><p :class="{ expanded: descriptionExpanded }">{{ details.description || 'Источник не предоставил описание.' }}</p><button v-if="details.description.length > 280" class="quiet" :aria-expanded="descriptionExpanded" @click="descriptionExpanded = !descriptionExpanded">{{ descriptionExpanded ? 'Свернуть описание' : 'Полное описание' }}</button></div>
              <ul v-if="detailGenres.length" class="detail-genres" aria-label="Жанры"><li v-for="genre in detailGenres" :key="genre">{{ genre }}</li></ul>
              <div class="detail-actions">
                <button class="primary" data-nav-id="detail-play" data-autofocus :disabled="loading || playStarting || !selectionKey" @click="play" @keydown.down="focusVoiceover"><AppIcon name="play" />{{ playStarting ? 'Готовим видео' : `Смотреть${chosenEpisode ? ` · ${chosenEpisode.episode} серия` : ''}` }}</button>
                <button v-if="status?.account" data-nav-id="detail-bookmark" :class="{ bookmarked: detailBookmarked === true }" :aria-pressed="detailBookmarked === undefined ? undefined : detailBookmarked" @click="openModal('bookmark')"><AppIcon name="bookmark" />{{ detailBookmarked === true ? 'В закладках' : detailBookmarked === false ? 'В закладки' : 'Закладки' }}</button>
                <button v-if="details.trailerAvailable" data-nav-id="detail-trailer" :disabled="trailerLoading || playStarting" @click="openTrailer"><AppIcon name="play" />Трейлер</button>
              </div>
              <div class="detail-selectors">
                <TvSelect label="Озвучка" :model-value="translator" :disabled="loading || playStarting || !details.translators.length" :options="details.translators.map(item => ({ value: item.id, label: item.name }))" @update:model-value="translator = String($event)" @change="changeTranslator" @keydown.up="focusWatch" />
              </div>
              <div v-if="sourceError" class="detail-source-error" role="alert"><p>{{ sourceError }}</p><button @click="prepareSource(true)">Повторить загрузку видео</button></div>
              <p v-if="details.type === 'series' && !episodes.length && !loading" class="muted">Для этой озвучки нет доступных серий.</p>
            </div>
          </div>
          <section v-if="details.type === 'series' && seasons.length" class="detail-episodes" aria-label="Выбор серии">
            <div class="detail-episodes-heading"><h2>Серии</h2><TvSelect label="Сезон" :model-value="selectedSeason" :disabled="loading || playStarting" :options="seasons.map(item => ({ value: item, label: `Сезон ${item}` }))" @update:model-value="selectedSeason = Number($event)" @change="changeSeason" /><span class="detail-episode-count">{{ episodes.length }}</span></div>
            <div class="episode-grid"><button v-for="item in episodes" :key="item.episode" :data-nav-id="`episode-${item.season}-${item.episode}`" :class="{ selected: selectedEpisode === item.episode }" :aria-label="`Серия ${item.episode}${item.watched ? ', просмотрено' : ''}`" :aria-pressed="selectedEpisode === item.episode" :disabled="loading || playStarting" @click="selectedEpisode = item.episode" @keydown.down="focusSchedule"><span class="episode-number">{{ String(item.episode).padStart(2, '0') }}</span><span class="episode-name">{{ item.title || `Серия ${item.episode}` }}</span><span v-if="item.watched" class="episode-watched">Просмотрено</span></button></div>
          </section>
          <section v-if="details.type === 'series' && orderedScheduleEpisodes.length" class="detail-schedule" role="region" aria-label="Расписание выхода серий">
            <div class="detail-extra-heading"><div><p class="eyebrow">ГРАФИК HDREZKA</p><h2>Расписание выхода серий</h2></div><TvSelect v-if="scheduleSeasons.length > 1" label="Сезон расписания" :model-value="selectedScheduleSeason || scheduleSeasons[0] || 1" :options="scheduleSeasons.map(item => ({ value: item, label: `Сезон ${item}` }))" @update:model-value="changeScheduleSeason" /></div>
            <div class="schedule-list" role="table" aria-label="Серии и даты выхода"><div v-for="item in visibleScheduleEpisodes" :key="`${item.season}:${item.episode}`" class="schedule-row" :class="{ current: item.current, upcoming: item.state === 'upcoming' }" role="row"><span class="schedule-number" role="cell"><b>{{ String(item.episode).padStart(2, '0') }}</b><small>{{ item.season }} сезон</small></span><span class="schedule-title" role="cell"><strong>{{ item.title || `Серия ${item.episode}` }}</strong><small v-if="item.originalTitle">{{ item.originalTitle }}</small></span><span class="schedule-date" role="cell">{{ item.airDate || 'Дата уточняется' }}</span><span class="schedule-state" :class="item.state" role="cell">{{ item.state === 'aired' ? 'Вышла' : item.relative || 'Ожидается' }}</span></div></div>
            <button v-if="orderedScheduleEpisodes.length > 3" class="quiet schedule-toggle" type="button" :aria-expanded="scheduleExpanded" @click="scheduleExpanded = !scheduleExpanded">{{ scheduleExpanded ? 'Свернуть' : 'Развернуть' }}</button>
          </section>
          <section v-if="details.parts?.length" class="shelf detail-parts" role="region" :aria-label="details.franchiseTitle || 'Все части'">
            <div class="section-heading"><h2>{{ details.franchiseTitle || 'Все части' }}</h2></div>
            <div class="poster-row part-row"><button v-for="item in details.parts" :key="`${item.id}:${item.order}`" class="poster-card part-card" :class="{ current: item.current }" :data-nav-id="item.current ? undefined : `part-${item.id}`" :disabled="item.current" :aria-label="`${item.order}. ${item.title}${item.year ? `, ${item.year}` : ''}${item.rating ? `, рейтинг ${item.rating}` : ''}${item.current ? ', текущая часть' : ''}`" @click="openContent(item)"><span class="part-order">{{ String(item.order).padStart(2, '0') }}</span><span class="part-copy"><strong>{{ item.title }}</strong><small>{{ [item.year, item.rating && `КП ${item.rating}`].filter(Boolean).join(' · ') }}</small></span><span v-if="item.current" class="part-current">Сейчас</span></button></div>
          </section>
          <section v-if="detailPeople.length" class="shelf detail-people" role="region" aria-label="Персоны"><div class="section-heading"><h2>Персоны</h2></div><div class="poster-row people-row"><button v-for="item in detailPeople" :key="`${item.id}:${item.url}`" class="poster-card person-card" :data-nav-id="`person-${item.id}`" :aria-label="item.name" @click="openPerson(item)"><span class="poster-image"><img v-if="item.photo" :src="item.photo" alt="" width="300" height="450" loading="lazy" decoding="async" @error="($event.target as HTMLImageElement).style.display = 'none'" /><span class="poster-fallback" aria-hidden="true">{{ item.name.slice(0, 1) }}</span></span><span class="poster-title">{{ item.name }}</span><span class="poster-meta">{{ item.role }}</span></button></div></section>
        </article>
      </template>
      <template v-else-if="route.name === 'person'">
        <SkeletonView v-if="loading && !person" kind="details" />
        <div v-if="screenError" class="error-box" role="alert"><p>{{ screenError }}</p><button @click="loadPerson(beginRequest())">Повторить</button></div>
        <article v-if="person" class="person-detail" :aria-busy="loading">
          <div class="person-hero"><div class="person-photo"><img v-if="person.photo" :src="person.photo" :alt="person.name" width="360" height="480" @error="($event.target as HTMLImageElement).style.display = 'none'" /><span aria-hidden="true">{{ person.name.slice(0, 1) }}</span></div><div class="person-info"><p class="eyebrow">ФИЛЬМОГРАФИЯ</p><h1>{{ person.name }}</h1><p v-if="person.originalName && person.originalName !== person.name" class="detail-original-title">{{ person.originalName }}</p><dl v-if="person.facts?.length" class="person-facts"><div v-for="fact in person.facts" :key="fact.label"><dt>{{ fact.label }}</dt><dd>{{ fact.value }}</dd></div></dl></div></div>
          <section v-for="career in person.careers" :key="career.role" class="shelf person-career" role="region" :aria-label="career.role"><div class="section-heading"><div><h2>{{ career.role }}</h2><p v-if="career.summary">{{ career.summary }}</p></div><span v-if="career.summary" class="career-summary">{{ career.summary }}</span></div><div class="poster-row"><PosterCard v-for="item in career.items" :key="item.id" :item="item" :context="`career-${person.id}-${career.role}`" @select="openContent" /></div></section>
        </article>
      </template>
      <template v-else-if="route.name === 'profile'">
        <SkeletonView v-if="status?.account && accountLoading" kind="profile" />
        <section v-else-if="status?.account" class="profile-panel" aria-label="Профиль HDRezka">
          <span class="profile-avatar" aria-hidden="true">{{ accountName.slice(0, 1).toUpperCase() }}</span>
          <div class="profile-copy"><p class="profile-label">Профиль HDRezka</p><h2>{{ accountName }}</h2><p class="account-tier">{{ status.account.premium === true ? 'Premium' : status.account.premium === false ? 'Аккаунт HDRezka' : 'Аккаунт' }}<span v-if="status.account.premium && status.account.premiumDays !== undefined"> · {{ status.account.premiumDays }} дней</span></p></div>
          <p v-if="accountError" class="error-text" role="alert">{{ accountError }}</p>
          <button class="profile-logout" @click="openModal('logout')">Выйти из аккаунта</button>
        </section>
        <section v-else class="login-panel guest-profile"><p class="eyebrow">ДОБРО ПОЖАЛОВАТЬ</p><h2>Вход в аккаунт</h2><p class="muted">Используйте существующий аккаунт HDRezka.</p><p v-if="accountError" class="error-box" role="alert">{{ accountError }}</p>
          <form class="login-form" @submit.prevent="login"><label>Логин или e-mail<input v-model="username" autocomplete="username" placeholder="Ваш логин" autocapitalize="none" spellcheck="false" data-autofocus :disabled="loginBusy" /></label><label>Пароль<input v-model="password" type="password" autocomplete="current-password" placeholder="Пароль аккаунта" :disabled="loginBusy" /></label><button class="primary full-width" type="submit" :disabled="loginBusy || !username.trim() || !password">{{ loginBusy ? 'Проверяем аккаунт…' : 'Войти' }}</button></form>
          <details class="mirror-disclosure"><summary>Зеркало и соединение</summary><form @submit.prevent="configure"><label>Адрес зеркала<input v-model="mirror" type="url" placeholder="https://…" autocomplete="off" /></label><div class="actions"><button :disabled="settingsBusy || !mirror" type="submit">{{ settingsBusy ? 'Проверяем…' : 'Сохранить зеркало' }}</button><button type="button" :disabled="initializing" @click="initialize">Повторить соединение</button></div></form></details><p class="fine-print">Пароль используется для входа и не сохраняется приложением.</p>
        </section>
      </template>
    </main>
  </div>
  <div v-if="trailerOpen" class="modal-backdrop trailer-backdrop" data-focus-scope><section class="trailer-dialog" role="dialog" aria-modal="true" :aria-label="`Трейлер · ${details?.title || route.title}`"><header><div><p class="eyebrow">ТРЕЙЛЕР</p><h2>{{ `Трейлер · ${details?.title || route.title}` }}</h2></div><button data-autofocus data-nav-id="trailer-close" type="button" aria-label="Закрыть трейлер" @click="closeTrailer"><AppIcon name="close" /></button></header><div class="trailer-frame"><iframe v-if="trailerUrl && trailerStarted" :src="trailerUrl" :title="`Трейлер ${details?.title || route.title}`" tabindex="-1" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen /><div v-else-if="trailerUrl" class="trailer-ready"><button data-nav-id="trailer-start" class="primary" type="button" @click="startTrailer"><AppIcon name="play" />Воспроизвести трейлер</button></div><div v-else-if="trailerLoading" class="trailer-loading" role="status"><span class="skeleton-block" /><p>Загружаем трейлер</p></div><div v-else class="trailer-error" role="alert"><p>{{ trailerError || 'Трейлер сейчас недоступен.' }}</p></div></div></section></div>
  <div v-if="modal" class="modal-backdrop" data-focus-scope><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="modal-title"><template v-if="modal === 'bookmark'"><p class="eyebrow">СПИСКИ АККАУНТА</p><h2 id="modal-title">Мои закладки</h2><TvSelect label="Выберите список" :model-value="selectedList" :disabled="modalBusy" :options="lists.map(list => ({ value: list.id, label: list.name }))" @update:model-value="selectedList = String($event)" /><p v-if="listsError" class="error-text">{{ listsError }}</p><p v-if="!lists.length && !listsError" class="muted">Сервер не вернул доступных списков.</p><div class="actions"><button class="primary" :disabled="modalBusy || !selectedList" @click="setBookmark(true)">Добавить</button><button :disabled="modalBusy || !selectedList" @click="setBookmark(false)">Удалить из списка</button><button :disabled="modalBusy" @click="closeModal">Закрыть</button></div></template><template v-else-if="modal === 'logout'"><h2 id="modal-title">Выйти из аккаунта?</h2><p class="muted">Закладки и история просмотра будут доступны после входа.</p><div class="actions"><button class="primary" :disabled="modalBusy" @click="closeModal">Остаться</button><button :disabled="modalBusy" @click="logout">Выйти</button></div></template><template v-else><p class="eyebrow">НЕСОХРАНЁННЫЙ ПРОГРЕСС</p><h2 id="modal-title">Выберите актуальную позицию</h2><p>На устройстве осталось записей: {{ sync.count }}. Они ещё не записаны в локальное хранилище.</p><p class="muted">Повторная отправка также обновит выбранную серию в HDRezka. Если после этого вы смотрели на другом устройстве, оставьте его более свежую серию и удалите эту очередь.</p><p v-if="sync.error" class="error-text">{{ sync.error }}</p><div class="actions"><button class="primary" @click="retrySaves(); closeModal()">Повторить сохранение</button><button @click="discardSaves">Удалить только очередь</button><button @click="closeModal">Решить позже</button></div></template><p v-if="modalError" class="error-text" role="alert">{{ modalError }}</p><p v-if="modalBusy" role="status">Выполняем запрос…</p></section></div>
  <VideoPlayer v-if="playerOpen && details" ref="playerRef" :details="details" :translator-id="translator" :episode="chosenEpisode" :prepared-source="playbackSource" :preferences="preferences" :sync-status="sync.status" :sync-error="sync.error" :episode-sync-error="episodeSyncError" :episode-retry-blocked="sync.count > 0" :pending-positions="pendingPositions" :progress-supported="!!status?.account && status.capabilities.progress === true" :watched-supported="!!status?.account && status.capabilities.watched === true" :watched-busy="watchedPending.size > 0" :watched-error="watchedError" :watched-note="watchedNote" @close="closePlayer" @selection="updatePlaybackSelection" @save="saveProgress" @preferences="updatePreferences" @retry-save="retrySaves" @retry-episode-sync="retryEpisodeSync" @watched="setEpisodeWatched" @retry-watched="retryWatched" />
</template>
