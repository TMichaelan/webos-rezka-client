'use strict';
const path = require('path');
const Service = require('webos-service');
const { RezkaTransport } = require('./transport.cjs');
const { createProvider } = require('./provider.cjs');
const { createDispatcher } = require('./dispatch.cjs');

const service = new Service('io.github.tmichaelan.app.rezkaclient.service');
const transport = new RezkaTransport({ mirror: 'https://hdrezka-home.tv', sessionFile: path.join(__dirname, '.state', 'session.json') });
const dispatch = createDispatcher(createProvider({ transport, progressFile: path.join(__dirname, '.state', 'progress.json') }));
service.register('rpc', message => {
  dispatch(message.payload).then(reply => message.respond(reply));
});
