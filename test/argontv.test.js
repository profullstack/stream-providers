import { test } from 'node:test';
import assert from 'node:assert/strict';
import { argontv, createLineup, createReseller, lineFrom, lineLogin, PACKAGES } from '../src/argontv.js';
import { xtream } from '../src/xtream.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The reseller API as observed 2026-10-29. */
function fakeReseller() {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path: u.pathname + u.search, method: init.method ?? 'GET', headers: init.headers, body });
    if (init.headers?.['x-apikey'] !== 'k') return json({ error: true, err: 'Unauthorized' }, 401);
    switch (u.pathname) {
      case '/api/v1/balance':
        return json({ error: false, bank_balance: 57, credits: 5.38 });
      case '/api/v1/templates':
        return json({ error: false, templates: [{ id: 2633, name: 'EVERYTHING' }] });
      case '/api/v1/lines/7':
        return json({
          error: false,
          id: 7,
          expiration_time: 1801029223,
          username: 'u',
          password: 'p',
          xtream_codes_username: 'xu',
          xtream_codes_password: 'xp',
          m3u_download_link: 'http://line.example:8080/get.php?username=xu&password=xp&type=m3u_plus',
          package_id: 113656,
          is_suspended: false,
          additional_connections: 2,
        });
      case '/api/v1/create-line':
        return json({ error: false, id: 8, username: 'n', password: 'm', m3u_download_link: 'http://l.tv/get.php?username=n&password=m', expiration_time: 1 });
      case '/api/v1/extend':
        return json({ error: false, failed: 0, successful: body.lines.length });
      case '/api/v1/refund':
        return json({ error: false, failed: 1, successful: 0 });
      default:
        return json({ error: true, err_message: 'Route not found' }, 404);
    }
  };
  return { fetch, calls };
}

test('reseller authenticates with X-ApiKey, never a bearer', async () => {
  const { fetch, calls } = fakeReseller();
  const r = createReseller({ apiKey: 'k', fetch });
  assert.deepEqual(await r.balance(), { credits: 5.38, bankBalance: 57 });
  assert.equal(calls[0].headers['x-apikey'], 'k');
  assert.equal(calls[0].headers.authorization, undefined);
});

test('a refused key surfaces the API reason', async () => {
  const { fetch } = fakeReseller();
  const r = createReseller({ apiKey: 'wrong', fetch });
  await assert.rejects(r.balance(), /Unauthorized/);
  await assert.rejects(createReseller({ fetch }).balance(), /not configured/);
});

test('getLine reads /lines/:id and normalises it', async () => {
  const { fetch, calls } = fakeReseller();
  const line = await createReseller({ apiKey: 'k', fetch }).getLine(7);
  assert.equal(calls[0].path, '/api/v1/lines/7');
  assert.equal(line.username, 'xu');
  assert.equal(line.password, 'xp');
  assert.equal(line.status, 'active');
  assert.equal(line.maxConnections, 3);
  assert.equal(line.packageId, PACKAGES.year);
  assert.equal(line.expiresAt.getTime(), 1801029223000);
});

test('createLine sends connections beyond the first, the template and notes', async () => {
  const { fetch, calls } = fakeReseller();
  const r = createReseller({ apiKey: 'k', fetch, templateId: 2633 });
  const line = await r.createLine({ packageId: PACKAGES.month, connections: 3, notes: 'order 1' });
  assert.deepEqual(calls[0].body, { package: 113653, template: 2633, additional_cons: 2, notes: 'order 1' });
  assert.equal(line.id, 8);
  await r.createLine({ packageId: PACKAGES.month, additionalConnections: 0, template: null });
  assert.deepEqual(calls[1].body, { package: 113653, additional_cons: 0 });
  await r.createLine({ packageId: PACKAGES.month, template: null });
  assert.deepEqual(calls[2].body, { package: 113653 });
});

test('extend and refund take a list of lines', async () => {
  const { fetch, calls } = fakeReseller();
  const r = createReseller({ apiKey: 'k', fetch });
  assert.deepEqual(await r.extendLine({ lineId: 7, packageId: PACKAGES.month }), { successful: 1, failed: 0 });
  assert.deepEqual(calls[0].body, { lines: [7], package: 113653 });
  await r.refund({ lineId: 7 });
  assert.deepEqual(calls[1].body, { lines: [7] });
});

test('the base URL may carry /api/v1 or a trailing slash', async () => {
  const { fetch, calls } = fakeReseller();
  await createReseller({ apiKey: 'k', fetch, baseUrl: 'https://d.example/api/v1/' }).balance();
  assert.equal(calls[0].path, '/api/v1/balance');
});

test('lineFrom refuses a line with no id or credential', () => {
  assert.throws(() => lineFrom({}), /no line id/);
  assert.throws(() => lineFrom({ id: 3 }), /no credential/);
});

test('a sold line plays through the xtream adapter', async () => {
  const { fetch } = fakeReseller();
  const line = await createReseller({ apiKey: 'k', fetch }).getLine(7);
  const login = lineLogin(line);
  assert.deepEqual(login, { server: 'http://line.example:8080', username: 'xu', password: 'xp' });
  const { url } = await xtream.resolve(login, 'x5');
  assert.equal(url, 'http://line.example:8080/live/xu/xp/5.ts');
});

test('public lineup walks every page', async () => {
  const fetch = async (url, init) => {
    const u = new URL(url);
    const page = Number(u.searchParams.get('page'));
    const body = JSON.parse(init.body);
    if (u.pathname.endsWith('search-cats-v2')) {
      return json({ error: false, total_pages: 2, entries: [{ name: `c${page}`, name2: `c${page}` }] });
    }
    return json({ error: false, total_pages: 1, entries: [{ id: 1, name: `${body.category_name} One` }] });
  };
  const lineup = createLineup({ fetch, pauseMs: 0 });
  assert.deepEqual((await lineup.categories()).map((c) => c.name), ['c1', 'c2']);
  assert.equal((await argontv.channels(null, { category: 'c1' }, { fetch }))[0].name, 'c1 One');
});

test('adapter connect checks the key', async () => {
  const { fetch } = fakeReseller();
  const r = await argontv.connect({ apiKey: 'k' }, { fetch });
  assert.equal(r.step, 'done');
  assert.equal(r.session.balance.credits, 5.38);
});
