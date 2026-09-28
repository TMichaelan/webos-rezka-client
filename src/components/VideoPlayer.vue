<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api } from '../api';
import TvSelect from './TvSelect.vue';
import AppIcon from './AppIcon.vue';
import { nextEpisode, previousEpisode, seekPosition, selectVariant, qualityPreference, qualityOrder, findVariant, videoRectangle, createSeekState } from '../player.mjs';
import { focusFirst } from '../navigation';
import type { Details, Episode, Methods, PlaybackSource, Preferences, Progress, SaveProgress, StreamVariant } from '../types';
const props = defineProps<{ details: Details; preparedSource?: PlaybackSource; translatorId: string; episode?: Episode; preferences: Preferences; syncStatus: string; syncError: string; episodeSyncError: string; episodeRetryBlocked: boolean; pendingPositions: SaveProgress[]; progressSupported: boolean; watchedSupported: boolean; watchedBusy: boolean; watchedError: string; watchedNote: string }>();
const emit = defineEmits<{ close: []; save: [value: SaveProgress]; preferences: [value: Preferences]; selection: [value: { details: Details; translatorId: string; episode?: Episode }]; retrySave: []; retryEpisodeSync: []; watched: [value: Methods['setEpisodeWatched']['params']]; retryWatched: [] }>();
const video = ref<HTMLVideoElement>();
const stage = ref<HTMLElement>();
const controls = ref<HTMLElement>();
const timeline = ref<HTMLInputElement>();
const actions = ref<HTMLElement>();
const qualityControl = ref<InstanceType<typeof TvSelect>>();
const subtitleControl = ref<InstanceType<typeof TvSelect>>();
const errorRetry = ref<HTMLButtonElement>();
const seekState = createSeekState();
let metadataApplied = false;
let playAfterLoad = true;
let mediaVersion = 0;
let preparedUsed = false;
let streamsRequest = 0;
const formatAvailable = ref(false);
const fit = ref<'contain' | 'cover'>('contain');
const videoStyle = ref({ left: '0px', top: '0px', width: '100%', height: '100%' });
function layoutVideo() {
  const media = video.value, bounds = stage.value?.getBoundingClientRect();
  if (!media || !bounds || !bounds.width || !bounds.height) return;
  formatAvailable.value = media.videoWidth > 0 && media.videoHeight > 0;
  const rect = videoRectangle(media.videoWidth, media.videoHeight, bounds.width, bounds.height, fit.value);
  videoStyle.value = { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` };
}
watch(fit, () => { void nextTick(layoutVideo); });
const currentDetails = ref(props.details);
const translator = ref(props.translatorId);
const episode = ref<Episode | undefined>(props.episode);
const source = ref<PlaybackSource>();
const variant = ref<StreamVariant | null>(null);
const qualityOptions = computed(() => [...new Set([...supportedVariants(source.value?.variants || [])].sort(qualityOrder).map(qualityPreference))]);
const qualitySelection = computed(() => variant.value ? qualityPreference(variant.value) : qualityOptions.value[0] || '');
const subtitleOptions = computed(() => [{ value: '', label: 'Выключены' }, ...(source.value?.subtitles || []).map(item => ({ value: item.id, label: item.label }))]);
const selectedSubtitle = computed(() => source.value?.subtitles.find(item => item.id === props.preferences.subtitleId));
const subtitleSelection = computed(() => selectedSubtitle.value?.id || '');
const loading = ref(true);
const error = ref('');
const errorKind = ref('');
const progressError = ref('');
const resume = ref<Progress | null>(null);
const paused = ref(true);
const position = ref(0);
const duration = ref(0);
const showControls = ref(true);
const countdown = ref<number | null>(null);
const backArmed = ref(false);
const subtitleError = ref('');
type SubtitleTrackSource = { id: string; label: string; language: string; sourceUrl: string; blobUrl: string };
const subtitleTracks = ref<SubtitleTrackSource[]>([]);
const activeSubtitleId = ref('');
let subtitleController: AbortController | undefined;
let subtitleVersion = 0;
const feedback = ref<{ action: 'play' | 'pause' | 'seek'; amount?: number } | null>(null);
let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
const ready = ref(false);
const frameReady = ref(false);
const showSkeleton = computed(() => loading.value && !frameReady.value && !resume.value && !progressError.value && !error.value);
let selectionVersion = 0;
let controller: AbortController | undefined;
let pendingPosition = 0;
let leaving = false;
let backgrounded = document.hidden;
let heldStarted = 0;
let heldKey = '';
let verticalKey = '';
let lastSeekAt = 0;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let saveTimer: ReturnType<typeof setInterval> | undefined;
let countdownTimer: ReturnType<typeof setInterval> | undefined;
let backTimer: ReturnType<typeof setTimeout> | undefined;
const next = computed(() => nextEpisode(currentDetails.value.episodes, episode.value?.season, episode.value?.episode));
const previous = computed(() => previousEpisode(currentDetails.value.episodes, episode.value?.season, episode.value?.episode));
const formatTime = (value: number) => { const s = Math.max(0, Math.floor(value || 0)); return `${s >= 3600 ? `${Math.floor(s / 3600)}:` : ''}${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const message = (value: unknown) => value instanceof Error ? value.message : 'Не удалось выполнить запрос. Повторите попытку.';
watch(error, async value => {
  if (!value) return;
  reveal(); await nextTick();
  if (error.value === value && !leaving && !backgrounded && !document.hidden && !document.querySelector('.tv-select-backdrop')) errorRetry.value?.focus({ preventScroll: true });
});

function save(completed = false) {
  if (!props.progressSupported || !ready.value || !Number.isFinite(duration.value) || duration.value <= 0) return;
  const capturedAt = Date.now();
  emit('save', { id: currentDetails.value.id, url: currentDetails.value.url, translatorId: translator.value, season: episode.value?.season, episode: episode.value?.episode, position: Math.min(duration.value, Math.max(0, (seekState.pending() ? seekState.position() : video.value?.currentTime) ?? position.value)), duration: duration.value, completed, updatedAt: new Date(capturedAt).toISOString(), saveId: `${capturedAt}-${Math.random().toString(36).slice(2)}` });
}
function cancelCountdown() { if (countdownTimer) clearInterval(countdownTimer); countdown.value = null; }
async function focusZone(zone: 'timeline' | 'actions' | 'hidden') {
  if (zone === 'hidden') {
    if (hideTimer) clearTimeout(hideTimer);
    showControls.value = false; stage.value?.focus({ preventScroll: true }); return;
  }
  reveal();
  await nextTick();
  if (leaving || backgrounded || document.querySelector('.tv-select-backdrop')) return;
  if (zone === 'timeline' && ready.value) timeline.value?.focus({ preventScroll: true });
  else if (actions.value) {
    const preferred = actions.value.querySelector<HTMLElement>('.player-toggle:not(:disabled)');
    if (preferred) preferred.focus({ preventScroll: true }); else focusFirst(actions.value);
  }
}
function reveal() {
  if (leaving) return;
  showControls.value = true;
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (!paused.value && !document.querySelector('.tv-select-backdrop') && countdown.value === null && !error.value && !resume.value) {
      void focusZone('hidden');
    }
  }, 5000);
}
async function selectPlayback(nextTranslator = translator.value, nextSelection = episode.value, automatic = false) {
  save(video.value?.ended || false);
  resetSubtitle(true);
  ready.value = false; frameReady.value = false;
  video.value?.pause();
  cancelCountdown();
  controller?.abort();
  controller = new AbortController();
  const version = ++selectionVersion;
  loading.value = true; error.value = ''; errorKind.value = ''; progressError.value = ''; resume.value = null; subtitleError.value = '';
  try {
    if (nextTranslator !== translator.value) {
      const details = await api.call('details', { url: currentDetails.value.url, translatorId: nextTranslator }, { signal: controller.signal });
      if (version !== selectionVersion) return;
      currentDetails.value = details;
      nextSelection = details.episodes.find(item => item.season === nextSelection?.season && item.episode === nextSelection?.episode) || details.episodes[0];
      emit('preferences', { ...props.preferences, translatorId: nextTranslator });
    }
    translator.value = nextTranslator;
    episode.value = nextSelection;
    emit('selection', { details: currentDetails.value, translatorId: nextTranslator, episode: nextSelection });
    source.value = undefined; variant.value = null;
    pendingPosition = 0; position.value = 0; duration.value = 0; seekState.reset(); metadataApplied = false;
    if (props.progressSupported && !automatic) {
      try {
        const pending = props.pendingPositions.find(item => item.id === currentDetails.value.id && item.translatorId === nextTranslator && item.season === nextSelection?.season && item.episode === nextSelection?.episode);
        const progress = pending || await api.call('progress', { id: currentDetails.value.id, url: currentDetails.value.url, translatorId: nextTranslator, season: nextSelection?.season, episode: nextSelection?.episode }, { signal: controller.signal });
        if (version !== selectionVersion) return;
        if (progress && !progress.completed && progress.position !== null && progress.position > 0) {
          resume.value = progress;
          loading.value = false;
          await nextTick(); focusFirst(document.querySelector('[data-resume-dialog]') || document);
          return;
        }
      } catch (failure) {
        if (version !== selectionVersion || controller.signal.aborted) return;
        progressError.value = message(failure);
        loading.value = false;
        await nextTick(); focusFirst(document.querySelector('[data-progress-error]') || document);
        return;
      }
    }
    await loadStreams(0, version);
  } catch (failure) {
    if (version !== selectionVersion || controller.signal.aborted) return;
    error.value = message(failure); errorKind.value = 'Ошибка получения видео'; loading.value = false; reveal();
  }
}
async function loadStreams(start: number, version = selectionVersion, fresh = false) {
  const request = ++streamsRequest;
  resume.value = null; progressError.value = ''; loading.value = true;
  try {
    const prepared = !fresh && !preparedUsed && props.preparedSource?.translatorId === translator.value && props.preparedSource.season === episode.value?.season && props.preparedSource.episode === episode.value?.episode ? props.preparedSource : undefined;
    preparedUsed = true;
    const result = prepared || await api.call('streams', { id: currentDetails.value.id, url: currentDetails.value.url, translatorId: translator.value, season: episode.value?.season, episode: episode.value?.episode }, { signal: controller?.signal });
    if (version !== selectionVersion || request !== streamsRequest || leaving) return;
    if (fresh) resetSubtitle(true);
    source.value = result;
    const choices = supportedVariants(result.variants);
    const chosen = selectVariant(choices, props.preferences.quality);
    if (!chosen) throw new Error('Источник не вернул доступных видеопотоков.');
    if (props.preferences.quality !== 'max') {
      const preferred = findVariant(choices, props.preferences.quality);
      if (preferred && qualityPreference(preferred) !== props.preferences.quality) emit('preferences', { ...props.preferences, quality: qualityPreference(preferred) });
    }
    prepareMedia(start);
    variant.value = chosen;
    await nextTick(); video.value?.load();
  } catch (failure) {
    if (version !== selectionVersion || request !== streamsRequest || leaving || controller?.signal.aborted) return;
    error.value = message(failure); errorKind.value = 'Ошибка получения видео'; loading.value = false; reveal();
  }
}
function prepareMedia(start: number, autoplay = true) {
  playAfterLoad = autoplay; pendingPosition = start; metadataApplied = false; mediaVersion++; ready.value = false; frameReady.value = false; seekState.reset();
}
function applyNativeSeek(target: number | null) {
  position.value = seekState.position();
  if (target === null || !video.value) return;
  try { video.value.currentTime = target; }
  catch { errorKind.value = 'Не удалось перемотать'; error.value = 'Повторите перемотку после загрузки видео.'; seekState.reset(video.value.currentTime); position.value = seekState.position(); reveal(); }
}
function durationChanged() { if (ready.value && video.value && Number.isFinite(video.value.duration)) duration.value = video.value.duration; }
function timeUpdated(settled = false) {
  if (!ready.value || !video.value) return;
  applyNativeSeek(seekState.observe(video.value.currentTime, video.value.seeking, settled));
}
async function loaded() {
  const media = video.value;
  if (!media || !variant.value || leaving) return;
  layoutVideo();
  duration.value = Number.isFinite(media.duration) ? media.duration : 0;
  if (metadataApplied) return;
  if (media.currentSrc && new URL(media.currentSrc, location.href).href !== new URL(variant.value.url, location.href).href) return;
  metadataApplied = true;
  const version = mediaVersion;
  ready.value = true; error.value = '';
  seekState.reset(media.currentTime || 0);
  if (pendingPosition > 0) applyNativeSeek(seekState.request(Math.min(pendingPosition, Math.max(0, duration.value - .1))));
  else position.value = seekState.position();
  void loadSubtitle();
  if (backgrounded || document.hidden) return;
  if (playAfterLoad) { try { await media.play(); } catch { if (version === mediaVersion) { paused.value = true; reveal(); } } }
  else { paused.value = true; media.pause(); }
}
async function frameLoaded() {
  const media = video.value;
  if (!media || !variant.value || leaving || media.readyState < 2 || !metadataApplied) return;
  if (media.currentSrc && new URL(media.currentSrc, location.href).href !== new URL(variant.value.url, location.href).href) return;
  layoutVideo();
  loading.value = false;
  if (frameReady.value) return;
  frameReady.value = true;
  const version = mediaVersion;
  await nextTick();
  if (leaving || backgrounded || document.hidden || version !== mediaVersion) return;
  const active = document.activeElement as HTMLElement | null;
  if (!document.querySelector('.tv-select-backdrop') && (!active?.closest('.player') || active === stage.value || active === document.body)) void focusZone('timeline');
  else reveal();
}
function mediaError() {
  if (!variant.value || leaving) return;
  loading.value = false;
  const code = video.value?.error?.code;
  errorKind.value = code === 2 ? 'Сеть прервала воспроизведение' : 'Не удалось воспроизвести формат';
  error.value = code === 2 ? 'Проверьте соединение и повторите загрузку видео.' : 'Телевизор не смог открыть этот поток. Выберите другое доступное качество или озвучку.';
  reveal();
}
function supportedVariants(variants: StreamVariant[]) {
  // Native MIME support is a useful filter, not proof of codec/HDR compatibility.
  const supported = variants.filter(item => !item.mime || video.value?.canPlayType(item.mime));
  return supported.length ? supported : variants;
}
async function changeQuality(value: string) {
  const choices = supportedVariants(source.value?.variants || []);
  const chosen = findVariant(choices, value);
  if (!chosen) return;
  emit('preferences', { ...props.preferences, quality: value });
  if (!chosen || chosen.id === variant.value?.id) return;
  save(); const start = seekState.pending() ? seekState.position() : video.value?.currentTime ?? position.value; prepareMedia(start, !!video.value && !video.value.paused);
  video.value?.pause(); error.value = ''; errorKind.value = ''; loading.value = true; variant.value = chosen;
  await nextTick(); video.value?.load();
}
function applySubtitles() {
  const tracks = video.value?.querySelectorAll<HTMLTrackElement>('track[data-subtitle-id]');
  if (!tracks) return;
  for (let index = 0; index < tracks.length; index++) tracks[index]!.track.mode = tracks[index]!.dataset.subtitleId === activeSubtitleId.value ? 'showing' : 'disabled';
}
function resetSubtitle(dropTracks = false) {
  subtitleController?.abort();
  subtitleController = undefined;
  subtitleVersion++;
  activeSubtitleId.value = ''; subtitleError.value = '';
  applySubtitles();
  if (!dropTracks) return;
  for (const track of subtitleTracks.value) URL.revokeObjectURL(track.blobUrl);
  subtitleTracks.value = [];
}
function subtitleTrackFailed(failed: SubtitleTrackSource) {
  const index = subtitleTracks.value.findIndex(track => track.blobUrl === failed.blobUrl);
  if (index < 0) return;
  subtitleTracks.value.splice(index, 1); URL.revokeObjectURL(failed.blobUrl);
  if (activeSubtitleId.value === failed.id) { activeSubtitleId.value = ''; subtitleError.value = 'Субтитры имеют неподдерживаемый формат.'; }
}
async function loadSubtitle() {
  resetSubtitle();
  const version = subtitleVersion;
  const selected = source.value?.subtitles.find(item => item.id === props.preferences.subtitleId);
  if (!selected) return;
  const cached = subtitleTracks.value.find(track => track.id === selected.id && track.sourceUrl === selected.url);
  if (cached) {
    activeSubtitleId.value = cached.id;
    await nextTick();
    if (version === subtitleVersion && !leaving) applySubtitles();
    return;
  }
  const request = new AbortController();
  subtitleController = request;
  try {
    const result = await api.call('subtitle', { url: selected.url }, { signal: request.signal });
    if (version !== subtitleVersion || leaving) return;
    const track = { id: selected.id, label: selected.label, language: selected.language || 'und', sourceUrl: selected.url, blobUrl: URL.createObjectURL(new Blob([result.text], { type: 'text/vtt' })) };
    subtitleTracks.value.push(track); activeSubtitleId.value = track.id;
    await nextTick();
    if (version === subtitleVersion && !leaving) applySubtitles();
  } catch (failure) {
    if (version === subtitleVersion && !request.signal.aborted) subtitleError.value = `Не удалось загрузить субтитры. ${message(failure)}`;
  }
}
watch(() => props.preferences.subtitleId, () => { void loadSubtitle(); });
function changeSubtitles(value: string) {
  if (value === props.preferences.subtitleId) void loadSubtitle();
  else emit('preferences', { ...props.preferences, subtitleId: value });
}
function showFeedback(action: 'play' | 'pause' | 'seek', amount?: number) {
  feedback.value = { action, amount };
  if (feedbackTimer) clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => { feedback.value = null; }, 650);
}
function toggle() {
  reveal();
  if (!video.value || !ready.value) return;
  if (video.value.paused) void video.value.play().then(() => { if (!leaving && !backgrounded && !document.hidden) showFeedback('play'); }).catch(() => { errorKind.value = 'Не удалось продолжить'; error.value = 'Повторите запуск видео.'; reveal(); });
  else { video.value.pause(); showFeedback('pause'); }
}
function seek(direction: number, heldMs = 0) {
  if (!video.value || !ready.value) return;
  cancelCountdown();
  const before = seekState.position();
  const target = seekPosition(before, duration.value, direction, heldMs);
  if (target !== before) applyNativeSeek(seekState.request(target));
  const amount = Math.round(position.value - before);
  if (amount) showFeedback('seek', amount);
  reveal();
}
function scrub(event: Event) { if (video.value && ready.value) { applyNativeSeek(seekState.request(Number((event.target as HTMLInputElement).value))); cancelCountdown(); reveal(); } }
function onPause() { paused.value = true; if (leaving) return; if (!backgrounded) save(video.value?.ended || false); reveal(); }
function ended() {
  if (leaving || seekState.pending() && seekState.position() < duration.value - 1) return;
  paused.value = true; save(true); reveal();
  if (props.watchedSupported && episode.value) emit('watched', { url: currentDetails.value.url, season: episode.value.season, episode: episode.value.episode, watched: true });
  if (document.querySelector('.tv-select-backdrop')) { cancelCountdown(); return; }
  if (backgrounded || document.hidden || !next.value || !props.preferences.autoNext) return;
  countdown.value = 10;
  void nextTick(() => {
    if (document.querySelector('.tv-select-backdrop')) cancelCountdown();
    else document.querySelector<HTMLElement>('[data-cancel-next]')?.focus();
  });
  countdownTimer = setInterval(() => {
    if (document.querySelector('.tv-select-backdrop')) { cancelCountdown(); return; }
    if (countdown.value === null) return;
    countdown.value--;
    if (countdown.value <= 0) { const target = next.value; cancelCountdown(); if (target) void selectPlayback(translator.value, target, true); }
  }, 1000);
}
function disarmBack() {
  backArmed.value = false;
  if (backTimer) clearTimeout(backTimer);
  backTimer = undefined;
}
function close() {
  disarmBack();
  const popup = [qualityControl.value, subtitleControl.value].find(control => control?.isOpen());
  if (popup) { void popup.close(); return; }
  if (countdown.value !== null) { cancelCountdown(); return; }
  leaving = true; save(video.value?.ended || false); video.value?.pause(); emit('close');
}
function requestBack() {
  const popup = [qualityControl.value, subtitleControl.value].find(control => control?.isOpen());
  if (popup) { disarmBack(); void popup.close(); return; }
  if (countdown.value !== null) { disarmBack(); cancelCountdown(); return; }
  if (resume.value || progressError.value || error.value) { close(); return; }
  if (backArmed.value) { close(); return; }
  backArmed.value = true;
  if (backTimer) clearTimeout(backTimer);
  backTimer = setTimeout(disarmBack, 2000);
}
defineExpose({ close, requestBack });
function keydown(event: KeyboardEvent) {
  if (event.defaultPrevented || resume.value || progressError.value) return;
  if (event.key !== 'Escape' && event.key !== 'Backspace' && event.keyCode !== 461) disarmBack();
  if (document.querySelector('.tv-select-backdrop')) {
    if ([412, 417, 415, 19, 10252].includes(event.keyCode)) event.preventDefault();
    return;
  }
  const active = document.activeElement;
  const key = event.key;
  if ([415, 19, 10252].includes(event.keyCode) || ((key === 'Enter' || key === ' ') && (active === stage.value || active === timeline.value))) {
    event.preventDefault();
    if (event.keyCode === 415) { if (video.value?.paused) toggle(); else if (ready.value) showFeedback('play'); }
    else if (event.keyCode === 19) { if (video.value && !video.value.paused) toggle(); else if (ready.value) showFeedback('pause'); }
    else toggle();
    return;
  }
  if (error.value) { reveal(); return; }
  const inActions = active instanceof Node && actions.value?.contains(active);
  if (['ArrowUp', 'ArrowDown'].includes(key)) {
    event.preventDefault();
    if (verticalKey === key) return;
    verticalKey = key;
    if (!showControls.value || active === stage.value) void focusZone(key === 'ArrowDown' ? 'timeline' : 'actions');
    else if (active === timeline.value) void focusZone(key === 'ArrowDown' ? 'actions' : 'hidden');
    else if (inActions) void focusZone(key === 'ArrowDown' ? 'hidden' : 'timeline');
    else void focusZone('timeline');
    return;
  }
  if (['ArrowLeft', 'ArrowRight'].includes(key) && inActions) {
    event.preventDefault(); reveal();
    const buttons = [...actions.value!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    buttons[buttons.indexOf(active as HTMLButtonElement) + (key === 'ArrowRight' ? 1 : -1)]?.focus({ preventScroll: true });
    return;
  }
  if (((active === stage.value || !showControls.value || active === timeline.value) && ['ArrowLeft', 'ArrowRight'].includes(key)) || [412, 417].includes(event.keyCode)) {
    event.preventDefault();
    const now = performance.now();
    const direction = key === 'ArrowLeft' || event.keyCode === 412 ? -1 : 1;
    const identity = direction < 0 ? 'backward' : 'forward';
    if (heldKey !== identity) { heldStarted = now; heldKey = identity; lastSeekAt = -Infinity; }
    if (now - lastSeekAt < 180) return;
    seekState.hold(true);
    seek(direction, now - heldStarted);
    lastSeekAt = now; void focusZone('timeline');
    return;
  }
  reveal();
}
function endSeekHold() {
  heldKey = ''; heldStarted = 0; lastSeekAt = -Infinity; seekState.hold(false); position.value = seekState.position();
}
function resetRemoteHolds() { verticalKey = ''; endSeekHold(); }
function keyup(event: KeyboardEvent) {
  if (['ArrowUp', 'ArrowDown'].includes(event.key)) { if (verticalKey === event.key) verticalKey = ''; return; }
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key) && ![412, 417].includes(event.keyCode)) return;
  endSeekHold();
}
function pageExit() {
  if (leaving) return;
  backgrounded = true; feedback.value = null; resetRemoteHolds();
  if (feedbackTimer) clearTimeout(feedbackTimer);
  save(video.value?.ended || false);
  video.value?.pause();
  cancelCountdown();
}
function visibilityChanged() { backgrounded = document.hidden; if (backgrounded) pageExit(); }
onMounted(() => {
  document.addEventListener('keydown', keydown, true);
  document.addEventListener('keyup', keyup, true);
  document.addEventListener('visibilitychange', visibilityChanged);
  window.addEventListener('pagehide', pageExit);
  window.addEventListener('pageshow', visibilityChanged);
  window.addEventListener('resize', layoutVideo);
  window.addEventListener('blur', resetRemoteHolds);
  saveTimer = setInterval(() => { if (video.value && !video.value.paused) save(); }, 10000);
  void selectPlayback();
});
onBeforeUnmount(() => {
  if (!leaving) save(video.value?.ended || false);
  leaving = true; controller?.abort(); selectionVersion++; resetSubtitle(true);
  ready.value = false;
  if (video.value) { video.value.pause(); video.value.removeAttribute('src'); video.value.load(); }
  document.removeEventListener('keydown', keydown, true); document.removeEventListener('keyup', keyup, true); window.removeEventListener('pagehide', pageExit);
  document.removeEventListener('visibilitychange', visibilityChanged); window.removeEventListener('pageshow', visibilityChanged);
  window.removeEventListener('resize', layoutVideo);
  window.removeEventListener('blur', resetRemoteHolds);
  if (saveTimer) clearInterval(saveTimer); if (hideTimer) clearTimeout(hideTimer); if (feedbackTimer) clearTimeout(feedbackTimer); if (backTimer) clearTimeout(backTimer); cancelCountdown();
});
</script>
<template>
  <section class="player" data-focus-scope aria-label="Видеоплеер" @pointermove="reveal" @pointerdown="disarmBack">
    <div ref="stage" class="player-stage" tabindex="0" role="button" :aria-label="paused ? 'Воспроизвести видео' : 'Приостановить видео'" aria-keyshortcuts="Enter Space ArrowLeft ArrowRight" @click="toggle">
      <video ref="video" :src="variant?.url" :style="videoStyle" @resize="layoutVideo" playsinline preload="metadata" @loadedmetadata="loaded" @loadeddata="frameLoaded" @canplay="frameLoaded" @timeupdate="timeUpdated()" @seeked="timeUpdated(true)" @durationchange="durationChanged" @play="paused = false; reveal()" @pause="onPause" @ended="ended" @error="mediaError" @waiting="loading = true" @playing="frameLoaded">
        <track v-for="track in subtitleTracks" :key="track.blobUrl" kind="subtitles" :src="track.blobUrl" :srclang="track.language" :label="track.label" :data-subtitle-id="track.id" :default="track.id === activeSubtitleId" @load="applySubtitles" @error="subtitleTrackFailed(track)" />
      </video>
    </div>
    <Transition name="player-feedback"><div v-if="feedback" class="player-feedback" :class="{ backward: feedback.action === 'seek' && (feedback.amount || 0) < 0, forward: feedback.action === 'seek' && (feedback.amount || 0) > 0 }" data-action-feedback :data-action="feedback.action" role="status">
      <AppIcon :name="feedback.action === 'seek' ? ((feedback.amount || 0) < 0 ? 'seek-left' : 'seek-right') : feedback.action" />
      <span v-if="feedback.action === 'seek'">{{ (feedback.amount || 0) > 0 ? '+' : '' }}{{ feedback.amount }} сек</span><span v-else class="sr-only">{{ feedback.action === 'play' ? 'Воспроизведение' : 'Пауза' }}</span>
    </div></Transition>
    <Transition name="player-feedback"><div v-if="backArmed" class="player-back-hint" role="status" aria-live="polite">Нажмите Back ещё раз, чтобы закрыть плеер</div></Transition>
    <div v-if="showSkeleton" class="player-skeleton" data-skeleton="player" aria-hidden="true"><div class="skeleton-block skeleton-video" /><div class="skeleton-player-controls"><div class="skeleton-block skeleton-timeline" /><div class="skeleton-player-actions"><span v-for="item in 3" :key="item" class="skeleton-block" /></div></div></div>
    <div v-if="resume" class="modal-backdrop" data-resume-dialog data-focus-scope>
      <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="resume-heading">
        <h2 id="resume-heading">Продолжить просмотр?</h2>
        <p>{{ currentDetails.title }}</p><p class="muted">Вы остановились на {{ formatTime(resume.position || 0) }}{{ episode ? ` · Сезон ${episode.season}, серия ${episode.episode}` : '' }}</p>
        <div class="actions"><button class="primary" data-autofocus @click="loadStreams(resume.position || 0)">Продолжить</button><button @click="loadStreams(0)">С начала</button><button @click="close">Закрыть плеер</button></div>
      </section>
    </div>
    <div v-else-if="progressError" class="modal-backdrop" data-progress-error data-focus-scope>
      <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="progress-heading"><h2 id="progress-heading">Позиция просмотра недоступна</h2><p role="alert">{{ progressError }}</p><div class="actions"><button class="primary" @click="selectPlayback()">Повторить</button><button @click="loadStreams(0)">Начать с начала</button><button @click="close">Закрыть плеер</button></div></section>
    </div>
    <div v-if="!resume && !progressError" class="player-overlay" :class="{ 'controls-hidden': !showControls }" :inert="!showControls || undefined">
      <header class="player-heading"><div><h2>{{ currentDetails.title }}</h2><p v-if="currentDetails.type === 'series'" class="player-episode">Сезон {{ episode?.season ?? '' }} · Серия {{ episode?.episode ?? '' }}</p></div></header>
      <div v-if="error" class="player-error" role="alert"><h3>{{ errorKind }}</h3><p>{{ error }}</p><button ref="errorRetry" @click="loadStreams(position, selectionVersion, true)">Повторить загрузку</button></div>
      <div v-if="countdown !== null" class="next-countdown" :data-seconds="countdown" role="status" :aria-label="`Следующая серия через ${countdown} секунд`">
        <img v-if="currentDetails.poster" :src="currentDetails.poster" alt="" />
        <div class="next-countdown-copy"><button class="next-start player-icon-button" aria-label="Смотреть сейчас" data-player-tooltip="Смотреть сейчас" @click="next && selectPlayback(translator, next, true)"><AppIcon name="next" /></button><button data-cancel-next class="next-cancel player-icon-button" aria-label="Отменить переход" data-player-tooltip="Отменить переход" @click="cancelCountdown"><AppIcon name="close" /></button></div>
        <div class="countdown-clock"><svg data-countdown-ring viewBox="0 0 72 72" aria-hidden="true"><circle cx="36" cy="36" r="31" class="countdown-track" /><circle cx="36" cy="36" r="31" class="countdown-progress" pathLength="100" stroke-dasharray="100" :stroke-dashoffset="100 - countdown * 10" /></svg><strong>{{ countdown }}</strong></div>
      </div>
      <footer v-show="!showSkeleton" ref="controls" class="player-controls">
        <div class="timeline"><span>{{ formatTime(position) }}</span><input ref="timeline" aria-label="Позиция видео" :disabled="!ready" :style="{ '--played': `${duration ? Math.min(100, position / duration * 100) : 0}%` }" type="range" min="0" :max="duration || 1" step="1" :value="position" @input="scrub" /><span>{{ formatTime(duration) }}</span></div>
        <div ref="actions" class="control-row">
          <div class="actions episode-actions">
            <button v-if="previous && countdown === null" class="player-icon-button" aria-label="Предыдущая серия" data-player-tooltip="Предыдущая серия" @click="selectPlayback(translator, previous)"><AppIcon name="previous" /></button>
            <button class="player-icon-button player-toggle" :aria-label="paused ? 'Воспроизвести' : 'Пауза'" :data-player-tooltip="paused ? 'Воспроизвести' : 'Пауза'" @click="toggle"><AppIcon :name="paused ? 'play' : 'pause'" /></button>
            <button v-if="next && countdown === null" class="player-icon-button" aria-label="Следующая серия" data-player-tooltip="Следующая серия" @click="selectPlayback(translator, next)"><AppIcon name="next" /></button>
          </div>
          <div class="actions playback-actions">
            <TvSelect ref="qualityControl" class="player-control-select player-quality" label="Качество" :model-value="qualitySelection" :disabled="loading || !source" data-player-tooltip="Качество" :options="qualityOptions.map(quality => ({ value: quality, label: quality }))" @change="changeQuality(String($event))"><template #trigger><AppIcon name="settings" /></template></TvSelect>
            <TvSelect ref="subtitleControl" class="player-control-select player-subtitles" label="Субтитры" :model-value="subtitleSelection" :disabled="loading || !source || !source.subtitles.length" :data-player-tooltip="subtitleError || (!source?.subtitles.length ? 'Субтитры недоступны' : selectedSubtitle ? `Субтитры: ${selectedSubtitle.label}` : 'Субтитры выключены')" :options="subtitleOptions" @change="changeSubtitles(String($event))"><template #trigger><AppIcon name="subtitles" /></template></TvSelect>
            <button class="player-icon-button" aria-label="Формат экрана" :aria-disabled="!formatAvailable" :aria-pressed="fit === 'cover'" :data-player-tooltip="formatAvailable ? (fit === 'contain' ? 'Оригинальный формат' : 'Заполнить экран') : 'Формат недоступен'" @click="formatAvailable && (fit = fit === 'contain' ? 'cover' : 'contain'); reveal()"><AppIcon name="aspect" /></button>
            <button v-if="syncStatus === 'failed'" class="player-icon-button" aria-label="Повторить сохранение просмотра" data-player-tooltip="Повторить сохранение просмотра" @click="$emit('retrySave')"><AppIcon name="refresh" /></button>
            <button v-if="episodeSyncError" class="player-icon-button" aria-label="Повторить передачу серии" data-player-tooltip="Повторить передачу серии" :disabled="episodeRetryBlocked" @click="$emit('retryEpisodeSync')"><AppIcon name="refresh" /></button>
            <button v-if="watchedError" class="player-icon-button" aria-label="Повторить отметки просмотра" data-player-tooltip="Повторить отметки просмотра" :disabled="watchedBusy" @click="$emit('retryWatched')"><AppIcon name="refresh" /></button>
          </div>
        </div>
      </footer>
    </div>
  </section>
</template>
<style scoped>
.player{--player-edge:clamp(24px,3.125vw,60px);--player-text:#f3f4f2;--player-muted:#bdc1c5;color:var(--player-text);background:#000}
.player button{transition:opacity 120ms ease-out}
.player button:active{opacity:.82}
.player-stage{overflow:hidden;background:#000}
.player-stage video{position:absolute;max-width:none;max-height:none;object-fit:contain}
.player-overlay{z-index:1;background:linear-gradient(180deg,rgba(8,10,13,.78),rgba(8,10,13,.74) 150px,transparent 36%,transparent 52%,rgba(8,10,13,.72) 80%,rgba(8,10,13,.9));transition:opacity 160ms ease-out}
.player-heading{padding:var(--player-edge);gap:24px;align-items:flex-start}
.player-heading h2{font-size:clamp(22px,1.67vw,32px);line-height:1.2;font-weight:550;max-width:75vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:0}
.player-episode{color:var(--player-muted);font-size:clamp(16px,1.05vw,20px);margin-top:8px}
.player-icon-button,.player-action,.next-start,.next-cancel{background:transparent;border-color:transparent;color:var(--player-text);box-shadow:none}
.player-icon-button{width:56px;height:56px;min-height:56px;display:inline-flex;align-items:center;justify-content:center;padding:10px;border-radius:10px;flex:none}
.player-icon-button :deep(.app-icon){width:32px;height:32px}
.player-action{display:inline-flex;align-items:center;gap:16px;min-height:56px;padding:10px 12px;border-radius:10px;white-space:nowrap;font-size:clamp(16px,1.05vw,20px)}
.player-action :deep(.app-icon){width:32px;height:32px}
.player-action:hover,.player-icon-button:hover,.next-start:hover,.next-cancel:hover{background:rgba(245,247,241,.1)}
.player-action:focus-visible,.player-icon-button:focus-visible,.next-start:focus-visible,.next-cancel:focus-visible{outline:2px solid var(--accent);outline-offset:3px;box-shadow:none}
.player-action[aria-pressed=true],.player-icon-button[aria-pressed=true]{color:var(--accent)}
.player-controls{padding:28px var(--player-edge) var(--player-edge);background:transparent}
.timeline{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:24px;align-items:center;margin-bottom:20px;color:var(--player-text);font-size:clamp(16px,1.05vw,20px)}
.timeline input{appearance:none;-webkit-appearance:none;height:28px;min-height:28px;padding:0;background:transparent;cursor:pointer;border-radius:4px}
.timeline input::-webkit-slider-runnable-track{height:3px;border-radius:2px;background:linear-gradient(to right,var(--accent) 0 var(--played),rgba(235,239,241,.38) var(--played) 100%)}
.timeline input::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:14px;height:14px;margin-top:-5.5px;border-radius:50%;border:0;background:var(--accent)}
.timeline input:focus-visible{outline:2px solid var(--accent);outline-offset:5px;box-shadow:none}
.control-row{min-height:84px;display:flex;justify-content:space-between;align-items:center;gap:16px}
.control-row .actions{gap:16px}
.episode-actions:empty{display:none}.playback-actions{margin-left:auto}
.player-skeleton{position:absolute;inset:0;pointer-events:none;background:#101216}
.skeleton-video{position:absolute;inset:20% var(--player-edge) 25%;border-radius:.3rem}
.skeleton-player-controls{position:absolute;bottom:var(--player-edge);left:var(--player-edge);right:var(--player-edge)}
.skeleton-timeline{height:3px;margin:12px 0 33px}
.skeleton-player-actions{display:flex;align-items:center;gap:16px;min-height:84px}
.skeleton-player-actions>.skeleton-block{width:56px;height:56px;border-radius:10px}
.player-error{max-width:720px;padding:24px;background:#231d1bed;border-color:#665044;border-radius:12px}
.player-error h3{font-size:24px}
.player-error p,.player-error button{font-size:20px}
.player-feedback{position:absolute;z-index:2;top:50%;left:50%;transform:translate(-50%,-50%);width:130px;min-height:130px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;border-radius:50%;background:rgba(15,18,22,.7);color:var(--player-text);pointer-events:none;font-size:28px;font-weight:550}
.player-feedback :deep(.app-icon){width:56px;height:56px}
.player-feedback.backward{left:22%}
.player-feedback.forward{left:78%}
.player-back-hint{position:absolute;z-index:3;left:50%;bottom:9vh;transform:translateX(-50%);padding:14px 20px;border-radius:10px;background:rgba(15,18,22,.88);color:var(--player-text);font-size:20px;font-weight:550;pointer-events:none}
.player-feedback-enter-active,.player-feedback-leave-active{transition:opacity 140ms ease-out,transform 140ms ease-out}
.player-feedback-enter-from,.player-feedback-leave-to{opacity:0;transform:translate(-50%,-50%) scale(.93)}
.next-countdown{position:absolute;right:var(--player-edge);bottom:calc(var(--player-edge) + 104px);display:flex;align-items:center;gap:20px;margin:0;padding:10px 14px;background:rgba(16,19,23,.9);border:1px solid rgba(226,235,228,.14);border-radius:12px;max-width:calc(100% - var(--player-edge)*2)}
.next-countdown>img{width:96px;height:62px;object-fit:cover;border-radius:5px}
.next-countdown-copy{display:flex;align-items:center;gap:8px}
.next-start,.next-cancel{padding:3px 6px;text-align:left;min-height:32px;border-radius:5px;white-space:nowrap}
.next-start{font-size:20px;font-weight:550}
.next-cancel{font-size:17px;color:var(--player-muted);font-weight:400}
.countdown-clock{width:64px;height:64px;position:relative;flex:none;display:grid;place-items:center}
.countdown-clock svg{position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg)}
.countdown-clock circle{fill:none;stroke-width:3;stroke-linecap:round}
.countdown-track{stroke:#69716f}
.countdown-progress{stroke:var(--accent)}
.countdown-clock strong{font-size:22px;font-weight:550;color:var(--player-text);font-variant-numeric:tabular-nums}
@media(max-width:1100px){.control-row{flex-direction:row}.control-row .actions{gap:6px}.player-action{gap:10px}.next-countdown{gap:12px}.next-countdown>img{display:none}.player-settings{padding:18px;gap:16px}}
@media(max-width:800px){.player-heading{gap:12px}.player-heading h2{max-width:70vw}.player-feedback{width:104px;min-height:104px;font-size:22px}.player-feedback :deep(.app-icon){width:46px;height:46px}.player-action{font-size:15px;padding:8px;gap:8px}.player-action :deep(.app-icon){width:25px;height:25px}.next-countdown{position:static;align-self:flex-end;margin:0 var(--player-edge) 12px}.timeline{gap:12px}.player-controls{padding-top:12px}.control-row{min-height:60px}.player-settings :deep(.tv-select-trigger){font-size:16px}.next-start{font-size:17px}}
@media(prefers-reduced-motion:reduce){.player-overlay,.player-feedback-enter-active,.player-feedback-leave-active{transition:none}.player-feedback-enter-from,.player-feedback-leave-to{transform:translate(-50%,-50%)}}
.player-control-select{position:relative}
.player-control-select :deep(.tv-select-label){display:none}
.player-control-select :deep(.tv-select-trigger){width:56px;min-width:56px;height:56px;min-height:56px;padding:10px;justify-content:center;border-color:transparent;background:transparent}
.player-control-select :deep(.app-icon){width:32px;height:32px}
.player [data-player-tooltip]{position:relative}
.player [data-player-tooltip]::after{content:attr(data-player-tooltip);position:absolute;left:0;bottom:calc(100% + 10px);white-space:nowrap;max-width:320px;padding:9px 12px;border-radius:6px;background:#171b20;color:#f3f4f2;font-size:17px;font-weight:400;opacity:0;visibility:hidden;pointer-events:none;z-index:6;transition:opacity 100ms ease,visibility 0s linear 100ms}
.player [data-player-tooltip]:hover::after,.player button[data-player-tooltip]:focus-visible::after,.player-control-select:focus-within::after{opacity:1;visibility:visible;transition-delay:1s}
.playback-actions [data-player-tooltip]::after{left:auto;right:0}
.player-heading [data-player-tooltip]::after{bottom:auto;top:calc(100% + 10px)}
.next-countdown [data-player-tooltip]::after{left:auto;right:0}
</style>
