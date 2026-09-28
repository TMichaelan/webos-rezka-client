import test from 'node:test';
import assert from 'node:assert/strict';
import { selectVariant, findVariant, seekPosition, nextEpisode, previousEpisode, createProgressQueue, qualityPreference } from '../src/player.mjs';

test('a raw Continue voice preserves the chosen cut while another server voice still wins', async () => {
  const { selectTranslator } = await import('../src/player.mjs');
  const voices = [{ id: '56', name: 'Дубляж' }, { id: '56~0~0~1', name: 'Дубляж (реж. версия)' }, { id: '2', name: 'Оригинал' }];
  assert.equal(selectTranslator(voices, '56~0~0~1', '56', '56'), '56~0~0~1');
  assert.equal(selectTranslator(voices, '56~0~0~1', '2', '56'), '2');
  assert.equal(selectTranslator(voices, 'missing', '56', '56~0~0~1'), '56~0~0~1');
  assert.equal(selectTranslator(voices, '56~0~0~1', undefined, '56'), '56~0~0~1');
});

test('maximum quality preserves 4K and manual selection falls back when absent', () => {
  const variants = [{ id: '720', height: 720 }, { id: '4k', label: '4K' }, { id: '2k', label: '2K' }, { id: '1080', height: 1080 }];
  assert.equal(selectVariant(variants, 'max').id, '4k');
  assert.equal(selectVariant(variants, '720').id, '720');
  assert.equal(selectVariant(variants, '2K · MP4').id, '2k');
  assert.equal(selectVariant(variants, 'missing').id, '4k');
  assert.equal(selectVariant([], 'max'), null);
});
test('short seek moves ten seconds and holding keeps accelerating within media bounds', () => {
  assert.equal(seekPosition(100, 1000, 1, 0), 110);
  assert.equal(seekPosition(100, 1000, -1, 999), 90);
  assert.equal(seekPosition(100, 1000, 1, 1000), 130);
  assert.equal(seekPosition(100, 1000, 1, 2999), 130);
  assert.equal(seekPosition(100, 1000, 1, 3000), 160);
  assert.equal(seekPosition(100, 1000, 1, 5999), 160);
  assert.equal(seekPosition(100, 1000, 1, 6000), 220);
  assert.equal(seekPosition(3, 100, -1, 0), 0);
  assert.equal(seekPosition(3, NaN, 1, 0), 3);
});
test('next episode follows actual available episodes across seasons without inventing gaps', () => {
  const episodes = [{ season: 2, episode: 1 }, { season: 1, episode: 3 }, { season: 1, episode: 1 }];
  assert.deepEqual(nextEpisode(episodes, 1, 1), { season: 1, episode: 3 });
  assert.deepEqual(nextEpisode(episodes, 1, 3), { season: 2, episode: 1 });
  assert.equal(nextEpisode(episodes, 2, 1), null);
  assert.equal(nextEpisode(episodes, 8, 1), null);
});
test('previous episode follows actual available episodes across seasons without inventing gaps', () => {
  const episodes = [{ season: 2, episode: 1 }, { season: 1, episode: 3 }, { season: 1, episode: 1 }];
  assert.equal(previousEpisode(episodes, 1, 1), null);
  assert.deepEqual(previousEpisode(episodes, 1, 3), { season: 1, episode: 1 });
  assert.deepEqual(previousEpisode(episodes, 2, 1), { season: 1, episode: 3 });
  assert.equal(previousEpisode(episodes, 8, 1), null);
  assert.deepEqual(previousEpisode([{ season: 1, episode: 0 }, { season: 1, episode: 1 }], 1, 1), { season: 1, episode: 0 });
});
test('save queue serializes writes and coalesces the latest series episode', async () => {
  const sent = [];
  const gates = [];
  const states = [];
  const queue = createProgressQueue(async value => { sent.push(value); await new Promise(resolve => gates.push(resolve)); }, state => states.push(state));
  queue.enqueue({ id: 'x', season: 1, episode: 1, position: 10 });
  queue.enqueue({ id: 'x', season: 1, episode: 1, position: 20 });
  queue.enqueue({ id: 'x', season: 1, episode: 1, position: 30 });
  queue.enqueue({ id: 'x', season: 1, episode: 2, position: 4 });
  assert.equal(sent.length, 1);
  gates.shift()(); await new Promise(setImmediate);
  assert.equal(sent[1].position, 4);
  assert.equal(sent[1].episode, 2);
  gates.shift()(); await queue.idle();
  assert.equal(states.at(-1).status, 'synced');
});
test('failed writes stay unsynced and retry preserves a deliberate rewind', async () => {
  let fail = true;
  const sent = [];
  const states = [];
  const queue = createProgressQueue(async value => { if (fail) throw new Error('Offline'); sent.push(value); }, state => states.push(state));
  queue.enqueue({ id: 'x', position: 80 }); await queue.idle();
  assert.equal(states.at(-1).status, 'failed');
  assert.equal(queue.pending()[0].position, 80);
  queue.enqueue({ id: 'x', position: 20 }); await queue.idle();
  fail = false;
  await queue.retry();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].position, 20);
  assert.equal(states.at(-1).status, 'synced');
});

test('quality preferences keep Ultra distinct and exact choices do not drift to another variant', () => {
  const variants = [
    { id: '720p:0', label: '720p', height: 720, mime: 'video/mp4' },
    { id: '1080p:4', label: '1080p', height: 1080, mime: 'video/mp4' },
    { id: '1080p:5', label: '1080p', height: 1080, mime: 'application/vnd.apple.mpegurl' },
    { id: '1080p Ultra:6', label: '1080p Ultra', height: 1080, mime: 'video/mp4' },
    { id: '1440p:7', label: '1440p', height: 1440, mime: 'video/mp4' },
    { id: '2160p:8', label: '2160p', height: 2160, mime: 'video/mp4' },
  ];
  assert.equal(qualityPreference({ id: '1080p:1', label: '1080p Ultra', mime: 'application/vnd.apple.mpegurl' }), '1080p Ultra');
  assert.deepEqual([...new Set(variants.map(qualityPreference))], ['720p', '1080p', '1080p Ultra', '2K', '4K']);
  assert.equal(findVariant(variants, '1080p').id, '1080p:4');
  assert.equal(findVariant(variants, '1080p Ultra').id, '1080p Ultra:6');
  assert.equal(findVariant(variants, '2K').id, '1440p:7');
  assert.equal(findVariant(variants, '4K').id, '2160p:8');
  assert.equal(selectVariant(variants, '1080p · MP4').id, '1080p:4');
  assert.equal(selectVariant(variants, 'missing · HLS').id, '2160p:8');
});
test('maximum quality chooses Ultra over ordinary video at equal resolution', () => {
  const variants = [
    { id: '1080p:0', label: '1080p', height: 1080 },
    { id: '1080p Ultra:1', label: '1080p Ultra', height: 1080 },
    { id: '720p Ultra:2', label: '720p Ultra', height: 720 },
  ];
  assert.equal(selectVariant(variants, 'max').id, '1080p Ultra:1');
});

test('native video rectangles preserve original aspect and fill only by proportional cropping', async () => {
  const { videoRectangle } = await import('../src/player.mjs');
  assert.deepEqual(videoRectangle(1920, 800, 1920, 1080, 'contain'), { left: 0, top: 140, width: 1920, height: 800 });
  assert.deepEqual(videoRectangle(1440, 1080, 1920, 1080, 'contain'), { left: 240, top: 0, width: 1440, height: 1080 });
  assert.deepEqual(videoRectangle(1280, 720, 1920, 1080, 'contain'), { left: 0, top: 0, width: 1920, height: 1080 });
  assert.deepEqual(videoRectangle(1280, 720, 1920, 1080, 'cover'), { left: -240, top: -135, width: 2400, height: 1350 });
  assert.deepEqual(videoRectangle(1920, 800, 1920, 1080, 'cover'), { left: -336, top: 0, width: 2592, height: 1080 });
  assert.deepEqual(videoRectangle(1440, 1080, 1920, 1080, 'cover'), { left: 0, top: -180, width: 1920, height: 1440 });
  assert.deepEqual(videoRectangle(0, 0, 1920, 1080, 'contain'), { left: 0, top: 0, width: 1920, height: 1080 });
});

test('seek intent accumulates while native values lag and coalesces writes until acknowledged', async () => {
  const { createSeekState } = await import('../src/player.mjs');
  const seek = createSeekState(30);
  seek.hold(true);
  assert.equal(seek.request(40), 40);
  assert.equal(seek.request(50), null);
  assert.equal(seek.observe(30, false), null);
  assert.equal(seek.position(), 50);
  assert.equal(seek.observe(40, false), null);
  assert.equal(seek.observe(40, false, true), 50);
  assert.equal(seek.request(80), null);
  assert.equal(seek.observe(50, false, true), 80);
  seek.hold(false);
  assert.equal(seek.observe(30, false), null);
  assert.equal(seek.position(), 80);
  assert.equal(seek.observe(80, false, true), null);
  assert.equal(seek.pending(), false);
  assert.equal(seek.request(20), 20);
  seek.observe(80, false);
  assert.equal(seek.position(), 20);
  seek.observe(20, false, true);
  assert.equal(seek.pending(), false);
});

test('restored series queue keeps the latest captured episode across voices, including episode zero', async () => {
  const queue = createProgressQueue(async () => {});
  queue.restore([
    { id: 'series', translatorId: 'b', season: 1, episode: 0, position: 12, updatedAt: '2026-09-28T12:02:00Z' },
    { id: 'series', translatorId: 'a', season: 1, episode: 3, position: 90, updatedAt: '2026-09-28T12:01:00Z' },
    { id: 'movie', translatorId: 'a', position: 9 }, { id: 'movie', translatorId: 'b', position: 8 },
  ]);
  assert.equal(queue.pending().length, 3);
  assert.equal(queue.pending().find(item => item.id === 'series').episode, 0);
});

test('authoritative native seeked accepts keyframe rounding without getting stuck', async () => {
  const { createSeekState } = await import('../src/player.mjs');
  const seek = createSeekState(30);
  seek.request(43);
  seek.observe(40, false);
  assert.equal(seek.position(), 43);
  assert.equal(seek.pending(), true);
  seek.observe(40, false, true);
  assert.equal(seek.position(), 40);
  assert.equal(seek.pending(), false);
});
