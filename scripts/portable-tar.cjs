'use strict';
// webOS CLI preserves the local account name in tar headers. Force its tar
// writer into portable mode so public IPKs contain no builder identity.
const Module = require('node:module');
const load = Module._load;
Module._load = function (request, parent, isMain) {
  const value = load.call(this, request, parent, isMain);
  if (request === 'tar' && value && typeof value.c === 'function' && !value.__rezkaPortable) {
    const create = value.c;
    Object.defineProperty(value, 'c', { configurable: true, enumerable: true, value(options, ...args) {
      return create({ ...options, portable: true }, ...args);
    } });
    Object.defineProperty(value, '__rezkaPortable', { value: true });
  }
  return value;
};
