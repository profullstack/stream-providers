import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as pkg from '../src/index.js';

test('every adapter has the common shape', () => {
  for (const [id, p] of Object.entries(pkg.providers)) {
    assert.equal(p.id, id);
    assert.equal(typeof p.name, 'string');
    assert.ok(['radio', 'iptv'].includes(p.kind));
    assert.ok(['reader', 'reseller'].includes(p.account));
    assert.ok(Array.isArray(p.signIn) && p.signIn.length > 0);
    for (const m of ['connect', 'channels', 'resolve']) assert.equal(typeof p[m], 'function', `${id}.${m}`);
  }
  assert.equal(pkg.provider('siriusxm'), pkg.siriusxm);
  assert.equal(pkg.provider('netflix'), null);
  assert.equal(pkg.provider('toString'), null);
});

test('errors carry the provider and whose fault it is', () => {
  const reader = new pkg.SiriusXmError('That code was not accepted.', 400);
  const ours = new pkg.ArgonTvError('down', 502);
  assert.ok(reader instanceof pkg.ProviderError && pkg.isProviderError(ours));
  assert.equal(reader.name, 'SiriusXmError');
  assert.equal(reader.provider, 'siriusxm');
  assert.equal(reader.readerFault, true);
  assert.equal(ours.readerFault, false);
});
