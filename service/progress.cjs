'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fail } = require('./parsers.cjs');
const MAX_BYTES = 4 * 1024 * 1024;
const key = (accountId, value) => [accountId, value.id, value.translatorId, value.season || 0, value.episode || 0].join(':');
const valid = value => value && /^\d+$/.test(value.id) && /^\d{1,16}(?:~[01]~[01]~[01])?$/.test(value.translatorId) && Number.isFinite(value.position) && value.position >= 0 && Number.isFinite(value.duration) && value.duration > 0 && value.position <= value.duration && typeof value.completed === 'boolean' && ((value.season === undefined && value.episode === undefined) || (Number.isInteger(value.season) && value.season > 0 && Number.isInteger(value.episode) && value.episode >= 0));
function timestamp(value) {
  const time = typeof value.updatedAt === 'string' ? Date.parse(value.updatedAt) : NaN;
  return Number.isFinite(time) ? time : null;
}
function latestSeriesPositions(records) {
  const latest = new Map();
  const next = { ...records };
  for (const [name, value] of Object.entries(records)) {
    if (value.season === undefined) continue;
    const scope = name.split(':').slice(0, 2).join(':');
    const time = timestamp(value) ?? -Infinity;
    const previous = latest.get(scope);
    // Equal or missing timestamps use file order, never the largest episode number.
    if (!previous || time >= previous.time) {
      if (previous) delete next[previous.name];
      latest.set(scope, { name, time });
    } else delete next[name];
  }
  return next;
}
function createProgressStore(file) {
  let entries;
  const error = () => fail('PROGRESS_STORAGE', 'Не удалось прочитать или сохранить позиции на устройстве. Проверьте локальное хранилище.');
  function write(next) {
    const temporary = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
    let fd;
    try {
      // ponytail: rewrite one bounded JSON file; use SQLite if history size or save frequency becomes costly.
      const data = JSON.stringify({ version: 1, entries: next });
      if (Buffer.byteLength(data) > MAX_BYTES) throw error();
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, data); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(temporary, file);
      entries = next;
    } catch { throw error(); }
    finally {
      if (fd !== undefined) fs.closeSync(fd);
      try { fs.unlinkSync(temporary); } catch { /* Renamed or never created. */ }
    }
  }
  function read() {
    if (entries) return entries;
    let fd, records;
    try {
      fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > MAX_BYTES) throw error();
      const data = JSON.parse(fs.readFileSync(fd, 'utf8'));
      if (data.version !== 1 || !data.entries || typeof data.entries !== 'object' || Array.isArray(data.entries)) throw error();
      for (const [name, value] of Object.entries(data.entries)) {
        if (!/^\d{1,16}:\d{1,16}:\d{1,16}(?:~[01]~[01]~[01])?:\d{1,5}:\d{1,5}$/.test(name) || !valid(value) || key(name.split(':')[0], value) !== name) throw error();
      }
      fs.fchmodSync(fd, 0o600);
      records = data.entries;
    } catch (cause) {
      if (cause.code === 'ENOENT') records = {};
      else throw error();
    } finally { if (fd !== undefined) fs.closeSync(fd); }
    const compacted = latestSeriesPositions(records);
    if (Object.keys(compacted).length !== Object.keys(records).length) write(compacted);
    else entries = compacted;
    return entries;
  }
  return {
    get(accountId, selection) {
      const value = read()[key(accountId, selection)];
      return value ? { ...value, positionSource: 'local' } : null;
    },
    set(accountId, value, recovery = false) {
      if (!valid(value)) throw error();
      const records = read();
      const prefix = `${accountId}:${value.id}:`;
      const previous = value.season === undefined ? records[key(accountId, value)] : Object.entries(records).find(([name, item]) => name.startsWith(prefix) && item.season !== undefined)?.[1];
      if (recovery && previous) {
        const incomingTime = timestamp(value), previousTime = timestamp(previous);
        if (incomingTime === null || (previousTime !== null && incomingTime <= previousTime)) return { ...previous, positionSource: 'local' };
      }
      const next = { ...records };
      if (value.season !== undefined) {
        for (const [name, previous] of Object.entries(next)) {
          if (name.startsWith(prefix) && previous.season !== undefined) delete next[name];
        }
      }
      next[key(accountId, value)] = value;
      write(next);
      return { ...value, positionSource: 'local' };
    }
  };
}
module.exports = { createProgressStore };
