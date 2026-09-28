'use strict';
const path = require('path');
const { createDispatcher } = require('../service/dispatch.cjs');
const { createDevServer } = require('./dev-server.cjs');
const fixtureMode = process.env.REZKA_FIXTURE === '1';
let provider;
if (fixtureMode) provider = require('./fixture-provider.cjs').createFixtureProvider();
else {
  const { RezkaTransport } = require('../service/transport.cjs');
  const { createProvider } = require('../service/provider.cjs');
  const transport = new RezkaTransport({ mirror: 'https://hdrezka-home.tv', sessionFile: path.join(__dirname, '..', '.state', 'live-session.json') });
  provider = createProvider({ transport, progressFile: path.join(__dirname, '..', '.state', 'live-progress.json') });
}
const server = createDevServer({ dispatch: createDispatcher(provider), fixture: fixtureMode ? provider : null, mediaFile: path.join(__dirname, '..', '.state', 'test-video.mp4') });
server.listen(5174, '127.0.0.1', () => console.log(`Rezka development service: http://127.0.0.1:5174 (${fixtureMode ? 'FIXTURE: no live account calls' : 'live'})`));
for (const event of ['SIGINT', 'SIGTERM']) process.on(event, () => server.close(() => process.exit(0)));
