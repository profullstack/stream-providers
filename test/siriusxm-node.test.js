import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as sxm from '../src/siriusxm.js';

/*
 * The SiriusXM protocol under Node, with every network call going through an
 * injected fetch. The full fake-gateway suite runs under Bun (test-bun/); this
 * proves the injection points: fetch, proxyInit, and the browser mint switch.
 */

const reply = (status, body, headers = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

test('an unknown email is the live gateway 404, mapped for the reader', async () => {
  const seen = [];
  sxm.configure({
    fetch: async (url, init) => {
      seen.push({ url: String(url), init });
      return reply(404, { code: 'userServices.identity.identityDoesNotExist' });
    },
    proxyInit: (proxy) => ({ dispatcher: `agent:${proxy}` }),
  });
  try {
    await assert.rejects(
      sxm.siriusxm.connect({ email: 'qa-nobody@example.com' }, { proxy: 'http://p:1' }),
      (err) =>
        err instanceof sxm.SiriusXmError &&
        err.status === 404 &&
        err.readerFault &&
        err.message === sxm.UNKNOWN_EMAIL_MESSAGE,
    );
    assert.equal(seen.length, 1);
    assert.ok(seen[0].url.startsWith('https://api.edge-gateway.siriusxm.com/identity/v1/identities/status?handle='));
    assert.equal(seen[0].init.dispatcher, 'agent:http://p:1');
    assert.equal(seen[0].init.proxy, undefined);
  } finally {
    sxm.configure({ fetch: null, proxyInit: null });
  }
});

test('an edge block through a proxy is retried on a fresh connection', async () => {
  let n = 0;
  const inits = [];
  sxm.configure({
    fetch: async (_url, init) => {
      inits.push(init);
      n++;
      return n < 3
        ? new Response('<html>403</html>', { status: 403, headers: { server: 'awselb/2.0', 'content-type': 'text/html' } })
        : reply(200, { ok: true });
    },
  });
  try {
    const res = await sxm.sxmFetch('https://api.edge-gateway.siriusxm.com/x', {}, { proxy: 'http://p:1' });
    assert.equal(res.status, 200);
    assert.equal(n, 3);
    assert.equal(inits[0].keepalive, undefined);
    assert.equal(inits[1].keepalive, false);
  } finally {
    sxm.configure({ fetch: null });
  }
});

test('the browser mint can be switched off by option as well as env', async () => {
  sxm.configure({
    browserMint: false,
    fetch: async (url) =>
      String(url).includes('identities/status') ? reply(401, {}) : reply(403, '<html/>', { 'content-type': 'text/html' }),
  });
  try {
    sxm.resetDeviceGrantCache();
    await assert.rejects(sxm.startOtpLogin('a@b.c'), (err) => {
      assert.equal(err.status, 502);
      assert.match(err.data.browser, /browser mint is off/);
      return true;
    });
  } finally {
    sxm.configure({ fetch: null, browserMint: null });
  }
});

test('configure refuses an unknown option', () => {
  assert.throws(() => sxm.configure({ nope: 1 }), /unknown option/);
});

test('adapter resolve refuses anything that is not a station id', async () => {
  await assert.rejects(sxm.siriusxm.resolve({ accessToken: 't' }, 'sxm:show:x'), (err) => err.status === 400);
});

test('expiresSoon reads the JWT', () => {
  const token = (exp) => `h.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.s`;
  assert.equal(sxm.siriusxm.expiresSoon({ accessToken: token(Date.now() / 1000 + 10) }), true);
  assert.equal(sxm.siriusxm.expiresSoon({ accessToken: token(Date.now() / 1000 + 3600) }), false);
  assert.equal(sxm.siriusxm.expiresSoon({ accessToken: 'opaque' }), false);
});
