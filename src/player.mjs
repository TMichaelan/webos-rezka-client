function selectTranslator(choices, preferred = '', remote = '', siteSelected = '') {
  const known = value => choices.some(item => item.id === value);
  if (remote.includes('~') && known(remote)) return remote;
  if (remote) {
    const base = remote.split('~')[0];
    if (known(preferred) && preferred.split('~')[0] === base) return preferred;
    if (known(siteSelected) && siteSelected.split('~')[0] === base) return siteSelected;
    const match = choices.find(item => item.id === remote) || choices.find(item => item.id.split('~')[0] === base);
    if (match) return match.id;
  }
  return known(preferred) ? preferred : known(siteSelected) ? siteSelected : choices[0]?.id || '';
}
function qualityPreference(variant) {
  const name = variant.label || variant.id.replace(/:\d+$/, '');
  const height = variant.height || Number(name.match(/(\d{3,4})p?/)?.[1]);
  if (!height) return name;
  const quality = height === 2160 ? '4K' : height === 1440 ? '2K' : `${height}p`;
  return `${quality}${/\bultra\b/i.test(name) ? ' Ultra' : ''}`;
}
function qualityHeight(variant) {
  const height = variant.height || Number(qualityPreference(variant).match(/(\d{3,4})p?/)?.[1]);
  if (height) return height;
  const k = qualityPreference(variant).match(/\b([24])k\b/i)?.[1];
  return k === '4' ? 2160 : k === '2' ? 1440 : 0;
}
function qualityOrder(a, b) {
  return qualityHeight(b) - qualityHeight(a)
    || Number(/\bultra\b/i.test(b.label || '')) - Number(/\bultra\b/i.test(a.label || ''));
}
function findVariant(variants, preference) {
  const qualityName = preference.replace(/\s*·\s*(?:HLS|MP4)\s*$/i, '');
  const exact = variants.find(item => item.id === preference || item.label === preference || item.id === qualityName || item.label === qualityName);
  if (exact) return exact;
  const resolution = qualityName.match(/(\d{3,4})p?/)?.[1];
  const quality = resolution ? qualityPreference({ id: qualityName, height: Number(resolution) }) : qualityName;
  return [...variants].sort(qualityOrder).find(item => qualityPreference(item) === quality) || null;
}
function selectVariant(variants, preference = 'max') {
  return (preference !== 'max' && findVariant(variants, preference)) || [...variants].sort(qualityOrder)[0] || null;
}
function videoRectangle(sourceWidth, sourceHeight, viewWidth, viewHeight, fit = 'contain') {
  viewWidth = Number.isFinite(viewWidth) ? Math.max(0, viewWidth) : 0;
  viewHeight = Number.isFinite(viewHeight) ? Math.max(0, viewHeight) : 0;
  if (![sourceWidth, sourceHeight].every(value => Number.isFinite(value) && value > 0)) return { left: 0, top: 0, width: viewWidth, height: viewHeight };
  const contain = Math.min(viewWidth / sourceWidth, viewHeight / sourceHeight);
  const sameRatio = viewWidth > 0 && viewHeight > 0 && Math.abs((sourceWidth / sourceHeight) / (viewWidth / viewHeight) - 1) <= .01;
  const scale = fit === 'cover' ? sameRatio ? contain * 1.25 : Math.max(viewWidth / sourceWidth, viewHeight / sourceHeight) : contain;
  const width = sourceWidth * scale, height = sourceHeight * scale;
  return { left: (viewWidth - width) / 2, top: (viewHeight - height) / 2, width, height };
}
function seekPosition(position, duration, direction, heldMs = 0) {
  if (!Number.isFinite(duration) || duration <= 0) return position;
  const step = heldMs >= 6000 ? 120 : heldMs >= 3000 ? 60 : heldMs >= 1000 ? 30 : 10;
  return Math.min(duration, Math.max(0, position + direction * step));
}
function createSeekState(start = 0) {
  let value = start, desired = null, applied = null, confirmed = start, held = false;
  return {
    position: () => value,
    pending: () => desired !== null,
    reset(position = 0) { value = confirmed = position; desired = applied = null; held = false; },
    hold(active) { held = active; if (!held && applied === null && desired !== null) { value = confirmed; desired = null; } },
    request(target) {
      if (!Number.isFinite(target)) return null;
      value = desired = target;
      if (applied === null) { applied = target; return target; }
      return null;
    },
    observe(position, seeking = false, settled = false) {
      if (!Number.isFinite(position)) return null;
      if (desired === null) { if (!held) value = position; return null; }
      if (applied === null || seeking || !settled) return null;
      confirmed = position;
      if (desired !== applied) { applied = desired; return applied; }
      applied = null;
      if (!held) { value = position; desired = null; }
      return null;
    },
  };
}
function nextEpisode(episodes, season, episode) {
  const sorted = [...episodes].sort((a, b) => a.season - b.season || a.episode - b.episode);
  const index = sorted.findIndex(item => item.season === season && item.episode === episode);
  return index < 0 ? null : sorted[index + 1] || null;
}
function previousEpisode(episodes, season, episode) {
  const sorted = [...episodes].sort((a, b) => a.season - b.season || a.episode - b.episode);
  const index = sorted.findIndex(item => item.season === season && item.episode === episode);
  return index <= 0 ? null : sorted[index - 1] || null;
}
function createProgressQueue(write, changed = () => {}) {
  const waiting = new Map();
  let active = null;
  let running = null;
  let blocked = false;
  const key = item => Number.isInteger(item.season) && item.season >= 1 && Number.isInteger(item.episode) && item.episode >= 0 ? item.id : `${item.id}:${item.translatorId || ''}`;
  const capturedAt = item => Date.parse(item.updatedAt || '') || Number(String(item.saveId || '').split('-')[0]) || 0;
  const pending = () => {
    const result = new Map(active ? [[key(active), active]] : []);
    for (const entry of waiting) result.set(...entry);
    return [...result.values()];
  };
  const notify = (status, error) => changed({ status, error, count: pending().length });
  async function drain() {
    while (waiting.size && !blocked) {
      const [id, value] = waiting.entries().next().value;
      waiting.delete(id);
      active = value;
      notify('pending');
      try { await write(value); }
      catch (error) {
        if (!waiting.has(id)) waiting.set(id, value);
        active = null;
        blocked = true;
        notify('failed', error);
        return;
      }
      active = null;
    }
    if (!blocked) notify('synced');
  }
  function start() {
    if (!running && !blocked) running = drain().finally(() => { running = null; });
    return running || Promise.resolve();
  }
  return {
    enqueue(value) { waiting.set(key(value), { ...value }); notify(blocked ? 'failed' : 'pending'); void start(); },
    pending,
    idle: () => running || Promise.resolve(),
    retry() { blocked = false; return start(); },
    restore(values) { for (const value of [...values].sort((a, b) => capturedAt(a) - capturedAt(b))) waiting.set(key(value), value); blocked = waiting.size > 0; notify(blocked ? 'failed' : 'idle'); },
    clear() { waiting.clear(); blocked = false; notify(active ? 'pending' : 'idle'); }
  };
}
export { createSeekState, videoRectangle, qualityPreference, qualityOrder, findVariant, selectVariant, selectTranslator, seekPosition, nextEpisode, previousEpisode, createProgressQueue };
