'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFixtureProvider } = require('../scripts/fixture-provider.cjs');

test('fixture exposes the V2 detail, person, schedule and trailer flows', async () => {
  const provider = createFixtureProvider();
  const details = await provider.dispatch('details', { url: 'https://hdrezka-home.tv/series/100-test.html' });
  assert.equal(details.trailerAvailable, true);
  assert.ok(details.rankings?.length);
  assert.ok(details.directors?.length);
  assert.ok(details.actors?.length);
  assert.ok(details.parts?.length);
  assert.ok(details.schedule?.some(item => item.state === 'upcoming'));

  const person = await provider.dispatch('person', { url: details.actors[0].url });
  assert.equal(person.name, details.actors[0].name);
  assert.ok(person.careers[0].items.length);

  const trailer = await provider.dispatch('trailer', { id: details.id, url: details.url });
  assert.match(trailer.url, /^https:\/\/www\.youtube\.com\/embed\/[\w-]{11}/);
});
