import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as x from '../src/xtream.js';
import { ProviderError } from '../src/errors.js';

const json = (body, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** A fake panel: answers player_api.php by action, records every URL asked for. */
function panel({ auth = 1 } = {}) {
  const seen = [];
  const fetch = async (url) => {
    seen.push(String(url));
    const u = new URL(url);
    const action = u.searchParams.get('action');
    if (u.pathname !== '/player_api.php') return json({}, 404);
    if (!action) {
      return json({
        user_info: { auth, status: 'Active', exp_date: '1800000000', max_connections: '3', active_cons: '1' },
        server_info: { timezone: 'Europe/Amsterdam' },
      });
    }
    if (action === 'get_live_categories') return json([{ category_id: '7', category_name: 'Sports' }]);
    if (action === 'get_live_streams') {
      return json([{ stream_id: 42, name: ' ESPN ', category_id: '7', num: '5', tv_archive: 1, tv_archive_duration: '3' }]);
    }
    return json([]);
  };
  return { fetch, seen };
}

test('serverOf normalises what people paste', () => {
  assert.equal(x.serverOf('host.tv:8080/'), 'http://host.tv:8080');
  assert.equal(x.serverOf('https://host.tv/player_api.php'), 'https://host.tv');
});

test('loginFromPlaylistUrl reads both panel shapes and nothing else', () => {
  assert.deepEqual(x.loginFromPlaylistUrl('http://h.tv/get.php?username=u&password=p&type=m3u_plus'), {
    server: 'http://h.tv',
    username: 'u',
    password: 'p',
  });
  assert.deepEqual(x.loginFromPlaylistUrl('http://h.tv:8080/playlist/u%40x/p/m3u_plus'), {
    server: 'http://h.tv:8080',
    username: 'u@x',
    password: 'p',
  });
  assert.equal(x.loginFromPlaylistUrl('http://h.tv/u/p/123'), null);
  assert.equal(x.loginFromPlaylistUrl('ftp://h.tv/get.php?username=u&password=p'), null);
  assert.equal(x.loginFromPlaylistUrl('not a url'), null);
});

test('panelApiUrl points at player_api.php with the pair', () => {
  const api = new URL(x.panelApiUrl('http://h.tv/live/u/p/1.ts'));
  assert.equal(api.pathname, '/player_api.php');
  assert.equal(api.searchParams.get('username'), 'u');
  assert.equal(api.searchParams.get('password'), 'p');
});

test('maskPlaylistUrl never shows a full credential', () => {
  const m = x.maskPlaylistUrl('http://h.tv/get.php?username=alice123&password=secret99&type=m3u');
  assert.ok(!m.includes('alice123') && !m.includes('secret99'));
  assert.ok(m.includes('type=m3u'));
  const p = x.maskPlaylistUrl('http://h.tv/playlist/alice123/secret99/m3u_plus');
  assert.ok(p.startsWith('http://h.tv/playlist/al'));
  assert.ok(!p.includes('secret99'));
});

test('lineInfo reads connections and expiry, null on anything odd', async () => {
  const { fetch } = panel();
  const info = await x.lineInfo('http://h.tv/get.php?username=u&password=p', { fetch });
  assert.equal(info.maxConnections, 3);
  assert.equal(info.activeConnections, 1);
  assert.equal(info.status, 'Active');
  assert.equal(info.expiresAt.getTime(), 1_800_000_000_000);
  assert.equal(await x.lineInfo('http://h.tv/whatever.m3u', { fetch }), null);
  const broken = async () => {
    throw new Error('down');
  };
  assert.equal(await x.lineInfo('http://h.tv/get.php?username=u&password=p', { fetch: broken }), null);
});

test('adapter: connect checks the login with the panel', async () => {
  const { fetch } = panel();
  const r = await x.xtream.connect({ url: 'http://h.tv/get.php?username=u&password=p' }, { fetch });
  assert.equal(r.step, 'done');
  assert.equal(r.session.username, 'u');
  assert.equal(r.session.account.maxConnections, 3);
  assert.equal(r.session.account.timeZone, 'Europe/Amsterdam');
});

test('adapter: a refused login is the reader\'s to fix', async () => {
  const { fetch } = panel({ auth: 0 });
  await assert.rejects(
    x.xtream.connect({ server: 'h.tv', username: 'u', password: 'bad' }, { fetch }),
    (err) => err instanceof ProviderError && err.readerFault && err.provider === 'xtream',
  );
  await assert.rejects(x.xtream.connect({}, { fetch }), (err) => err.status === 400);
});

test('adapter: channels and resolve', async () => {
  const { fetch } = panel();
  const session = { server: 'http://h.tv', username: 'u', password: 'p' };
  const [ch] = await x.xtream.channels(session, {}, { fetch });
  assert.equal(ch.id, 'x42');
  assert.equal(ch.name, 'ESPN');
  assert.equal(ch.group, 'Sports');
  assert.equal(ch.chno, 5);
  assert.deepEqual(ch.catchup, { type: 'xc', days: 3 });
  assert.equal(ch.url, 'http://h.tv/live/u/p/42.ts');
  const r = await x.xtream.resolve(session, 'x42', { ext: 'm3u8' });
  assert.deepEqual(r, { url: 'http://h.tv/live/u/p/42.m3u8', validUntil: null });
  await assert.rejects(x.xtream.resolve(session, '../etc'), (err) => err.status === 400);
});

test('configure sets the default fetch and user agent', async () => {
  const { fetch, seen } = panel();
  let ua = null;
  x.configure({
    fetch: (url, init) => {
      ua = init.headers['user-agent'];
      return fetch(url, init);
    },
    userAgent: 'site/1',
  });
  try {
    await x.account({ server: 'http://h.tv', username: 'u', password: 'p' });
    assert.equal(ua, 'site/1');
    assert.equal(seen.length, 1);
  } finally {
    x.configure({ fetch: null, userAgent: null });
  }
  assert.equal(x.configure().userAgent, 'curl/8.5.0');
});

test('timeshiftUrl uses the server time zone', () => {
  const login = { server: 'http://h.tv', username: 'u', password: 'p' };
  const url = x.timeshiftUrl(login, 9, Date.UTC(2026, 0, 2, 3, 4), 30, 'UTC');
  assert.equal(url, 'http://h.tv/timeshift/u/p/30/2026-01-02:03-04/9.ts');
});
