// Xtream Codes ("player_api.php") client. Runs anywhere fetch does: Node, Bun,
// a worker or a browser. No Node built-ins.
//
// A provider line is three things: a server, a username and a password. Every
// URL below carries the last two in the clear, because that is how the protocol
// works, so none of them may be logged or put in a page address.
//
// First written for hdtilt (the API client) and tipoffwatch (the panel account
// probe and the playlist mask); one copy now.

import { ProviderError } from './errors.js';

const settings = {
  /** @type {typeof fetch | null} */
  fetch: null,
  /** What every request sends. These panels answer curl; some refuse odd strings. */
  userAgent: 'curl/8.5.0',
};

/** Set the default `fetch` and `userAgent`. Returns the settings in force. */
export function configure(options = {}) {
  for (const [k, v] of Object.entries(options)) {
    if (!(k in settings)) throw new TypeError(`xtream.configure: unknown option ${k}`);
    settings[k] = v ?? (k === 'userAgent' ? 'curl/8.5.0' : null);
  }
  return { ...settings };
}

const defaultFetch = (url, init) => (settings.fetch ?? globalThis.fetch)(url, init);

/** An Xtream answer the reader can act on (status 4xx) or we cannot (5xx). */
export class XtreamError extends ProviderError {
  constructor(message, status = 502, data = null) {
    super(message, status, data, { provider: 'xtream' });
    this.name = 'XtreamError';
  }
}

/** @typedef {{ server: string, username: string, password: string }} XtreamLogin */

/** Normalise what people paste: no trailing slash, no player_api.php, a scheme. */
export function serverOf(raw) {
  let s = String(raw || '').trim();
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  const u = new URL(s);
  return `${u.protocol}//${u.host}`;
}

/**
 * Pull a login out of an M3U URL that is really an Xtream line in disguise:
 * `http://host/get.php?username=U&password=P&type=m3u_plus`.
 * Returns null for anything else.
 */
export function loginFromM3uUrl(raw) {
  try {
    const u = new URL(raw);
    const username = u.searchParams.get('username');
    const password = u.searchParams.get('password');
    if (/\/get\.php$/i.test(u.pathname) && username && password) {
      return { server: `${u.protocol}//${u.host}`, username, password };
    }
  } catch {}
  return null;
}

export function apiUrl(login, action, params = {}) {
  const u = new URL(`${serverOf(login.server)}/player_api.php`);
  u.searchParams.set('username', login.username);
  u.searchParams.set('password', login.password);
  if (action) u.searchParams.set('action', action);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u.toString();
}

export const xmltvUrl = (login) =>
  `${serverOf(login.server)}/xmltv.php?username=${encodeURIComponent(login.username)}&password=${encodeURIComponent(login.password)}`;

const path = (login) => `${encodeURIComponent(login.username)}/${encodeURIComponent(login.password)}`;

export const liveUrl = (login, streamId, ext = 'ts') =>
  `${serverOf(login.server)}/live/${path(login)}/${streamId}.${ext}`;

export const movieUrl = (login, streamId, ext = 'mp4') =>
  `${serverOf(login.server)}/movie/${path(login)}/${streamId}.${ext}`;

export const episodeUrl = (login, episodeId, ext = 'mp4') =>
  `${serverOf(login.server)}/series/${path(login)}/${episodeId}.${ext}`;

/**
 * Archive playback. Xtream wants the start in the SERVER's local time, which
 * the panel reports as `server_info.timezone`; UTC is right for most panels and
 * is what we fall back to.
 */
export function timeshiftUrl(login, streamId, startMs, minutes, timeZone = 'UTC') {
  const d = new Date(startMs);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const at = `${parts.year}-${parts.month}-${parts.day}:${parts.hour}-${parts.minute}`;
  return `${serverOf(login.server)}/timeshift/${path(login)}/${Math.ceil(minutes)}/${at}/${streamId}.ts`;
}

export async function getJson(url, fetchImpl = defaultFetch) {
  const res = await fetchImpl(url, { headers: { 'user-agent': settings.userAgent } });
  if (!res.ok) {
    throw new XtreamError(
      `provider answered ${res.status}`,
      res.status === 401 || res.status === 403 ? 401 : 502,
    );
  }
  const text = await res.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new XtreamError('provider did not answer with JSON; check the server address', 400);
  }
}

/** Account status. Throws when the login is refused. */
export async function account(login, fetchImpl = defaultFetch) {
  const data = await getJson(apiUrl(login), fetchImpl);
  if (!data?.user_info || Number(data.user_info.auth) === 0) {
    throw new XtreamError('the provider refused that username and password', 401);
  }
  const u = data.user_info;
  return {
    status: u.status,
    expiresAt: u.exp_date ? Number(u.exp_date) * 1000 : null,
    maxConnections: Number(u.max_connections) || null,
    activeConnections: Number(u.active_cons) || 0,
    formats: u.allowed_output_formats || [],
    timeZone: data.server_info?.timezone || 'UTC',
  };
}

/**
 * Live channels in the same shape an M3U produces, so nothing downstream needs
 * to know which kind of source it came from.
 */
export async function liveChannels(login, { fetchImpl = defaultFetch, ext } = {}) {
  const [cats, streams] = await Promise.all([
    getJson(apiUrl(login, 'get_live_categories'), fetchImpl),
    getJson(apiUrl(login, 'get_live_streams'), fetchImpl),
  ]);
  const catName = new Map((cats || []).map((c) => [String(c.category_id), c.category_name]));
  return (streams || []).map((s) => {
    const ch = {
      id: `x${s.stream_id}`,
      name: String(s.name || '').trim() || `Channel ${s.stream_id}`,
      url: liveUrl(login, s.stream_id, ext || 'ts'),
      group: catName.get(String(s.category_id)) || 'Uncategorized',
      kind: 'live',
      streamId: Number(s.stream_id),
    };
    if (s.stream_icon) ch.logo = s.stream_icon;
    if (s.epg_channel_id) ch.tvgId = s.epg_channel_id;
    if (s.num) ch.chno = Number(s.num);
    if (Number(s.tv_archive) === 1) {
      ch.catchup = { type: 'xc', days: Number(s.tv_archive_duration) || undefined };
    }
    return ch;
  });
}

/** Movie or series categories: [{ id, name }]. kind is 'movie' or 'series'. */
export async function vodCategories(login, kind, fetchImpl = defaultFetch) {
  const action = kind === 'series' ? 'get_series_categories' : 'get_vod_categories';
  const cats = await getJson(apiUrl(login, action), fetchImpl);
  return (Array.isArray(cats) ? cats : []).map((c) => ({
    id: String(c.category_id),
    name: String(c.category_name || ''),
  }));
}

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));
const yearOf = (...vs) => {
  for (const v of vs) {
    const y = /\b(19|20)\d{2}\b/.exec(String(v || ''))?.[0];
    if (y) return Number(y);
  }
  return undefined;
};

/** A TMDB id, for subtitles: panels send it as a number, a string, or "0" for none. */
const tmdbOf = (...vs) => {
  for (const v of vs) {
    const n = Number(String(v ?? '').trim());
    if (Number.isInteger(n) && n > 0) return n;
  }
  return undefined;
};

/** One movie as get_vod_streams lists it, in the shape the app shows. */
export function movieOf(login, m, catName = new Map()) {
  return {
    id: `m${m.stream_id}`,
    name: String(m.name || '').trim() || `Movie ${m.stream_id}`,
    group: catName.get(String(m.category_id)) || 'Movies',
    category: String(m.category_id ?? ''),
    logo: m.stream_icon || undefined,
    rating: num(m.rating) || undefined,
    year: yearOf(m.year, m.releasedate, m.name),
    added: num(m.added),
    tmdbId: tmdbOf(m.tmdb, m.tmdb_id),
    url: movieUrl(login, m.stream_id, m.container_extension || 'mp4'),
    kind: 'vod',
  };
}

/** One show as get_series lists it. */
export function showOf(s, catName = new Map()) {
  return {
    id: `s${s.series_id}`,
    seriesId: Number(s.series_id),
    name: String(s.name || '').trim() || `Series ${s.series_id}`,
    group: catName.get(String(s.category_id)) || 'Series',
    category: String(s.category_id ?? ''),
    logo: s.cover || undefined,
    plot: s.plot || undefined,
    rating: num(s.rating) || undefined,
    year: yearOf(s.releaseDate, s.release_date, s.name),
    added: num(s.last_modified),
    kind: 'series',
  };
}

/** Movies, all of them or one category's. All of them can be 100+ MB of JSON. */
export async function movies(login, { category, fetchImpl = defaultFetch } = {}) {
  const [cats, items] = await Promise.all([
    category ? [] : getJson(apiUrl(login, 'get_vod_categories'), fetchImpl),
    getJson(apiUrl(login, 'get_vod_streams', category ? { category_id: category } : {}), fetchImpl),
  ]);
  const catName = new Map((cats || []).map((c) => [String(c.category_id), c.category_name]));
  return (Array.isArray(items) ? items : []).map((m) => movieOf(login, m, catName));
}

/** Shows, all of them or one category's. */
export async function series(login, { category, fetchImpl = defaultFetch } = {}) {
  const [cats, items] = await Promise.all([
    category ? [] : getJson(apiUrl(login, 'get_series_categories'), fetchImpl),
    getJson(apiUrl(login, 'get_series', category ? { category_id: category } : {}), fetchImpl),
  ]);
  const catName = new Map((cats || []).map((c) => [String(c.category_id), c.category_name]));
  return (Array.isArray(items) ? items : []).map((s) => showOf(s, catName));
}

/**
 * "EN - Lost In Space (2018) - S01E01 - Impact" is how panels title an
 * episode; beside its show and its S01 E01 it is "Impact". A title that is
 * nothing but the code keeps the whole thing.
 */
export function episodeTitle(raw, n) {
  const t = String(raw || '').trim();
  const m = /(?:^|[\s\-–|:])S\d{1,3}\s*E\d{1,4}\b\s*(?:[-–|:]\s*)?(.*)$/i.exec(t);
  const rest = m?.[1]?.trim();
  return rest || t || `Episode ${n}`;
}

/**
 * A show's details and episodes. Panels send `episodes` as an object keyed by
 * season, or as a list of lists; both come out as one flat list in order.
 */
export async function seriesInfo(login, seriesId, fetchImpl = defaultFetch) {
  const data = await getJson(apiUrl(login, 'get_series_info', { series_id: seriesId }), fetchImpl);
  if (!data || typeof data !== 'object') throw new XtreamError('the provider has nothing for that show', 404);
  const raw = data.episodes || {};
  const groups = Array.isArray(raw) ? raw.map((list, i) => [list?.[0]?.season ?? i + 1, list]) : Object.entries(raw);
  const episodes = [];
  for (const [season, list] of groups) {
    for (const e of Array.isArray(list) ? list : []) {
      const info = e.info && typeof e.info === 'object' ? e.info : {};
      episodes.push({
        id: `e${e.id}`,
        season: Number(e.season ?? season) || 0,
        episode: Number(e.episode_num) || 0,
        name: episodeTitle(e.title, e.episode_num),
        plot: info.plot || undefined,
        duration: num(info.duration_secs),
        logo: info.movie_image || undefined,
        url: episodeUrl(login, e.id, e.container_extension || 'mp4'),
        kind: 'vod',
      });
    }
  }
  episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
  const i = data.info || {};
  return {
    seriesId: Number(seriesId),
    name: String(i.name || '').trim(),
    plot: i.plot || undefined,
    logo: i.cover || undefined,
    genre: i.genre || undefined,
    rating: num(i.rating) || undefined,
    year: yearOf(i.releaseDate, i.release_date),
    tmdbId: tmdbOf(i.tmdb, i.tmdb_id),
    episodes,
  };
}

/** Back-compat: a show's episodes only. */
export async function episodes(login, seriesId, fetchImpl = defaultFetch) {
  return (await seriesInfo(login, seriesId, fetchImpl)).episodes;
}

const b64 = (s) => {
  try {
    const bin = atob(String(s || ''));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return String(s || '');
  }
};

/** A channel's next few programmes, for a provider with no XMLTV. */
export async function shortEpg(login, streamId, limit = 4, fetchImpl = defaultFetch) {
  const data = await getJson(apiUrl(login, 'get_short_epg', { stream_id: streamId, limit }), fetchImpl);
  return (data?.epg_listings || []).map((p) => ({
    start: Number(p.start_timestamp) * 1000,
    stop: Number(p.stop_timestamp) * 1000,
    title: b64(p.title),
    desc: b64(p.description) || undefined,
  }));
}

/* ------------------------------------------------- playlist URLs + panels -- */

/**
 * A login out of any playlist address an Xtream (XUI.one) panel hands out:
 *
 *   http://host/get.php?username=U&password=P&type=m3u_plus
 *   http://host/playlist/U/P/m3u_plus     (also /get.php/U/P/..., /live/U/P/..., /m3u/..., /xmltv.php/...)
 *
 * Anything else is null. A bare `/U/P/123` is what a STREAM url looks like, and
 * guessing credentials out of an unknown path shape is how a wrong pair gets
 * sent to somebody's server.
 *
 * @param {string} playlistUrl
 * @returns {XtreamLogin|null}
 */
export function loginFromPlaylistUrl(playlistUrl) {
  let parsed;
  try {
    parsed = new URL(playlistUrl);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(parsed.protocol)) return null;

  let username = parsed.searchParams.get('username');
  let password = parsed.searchParams.get('password');

  if (!username || !password) {
    const segments = parsed.pathname.split('/').filter(Boolean);
    const route = segments[0]?.toLowerCase();
    if (
      ['playlist', 'get.php', 'live', 'm3u', 'xmltv.php'].includes(route) &&
      segments.length >= 3
    ) {
      try {
        username = decodeURIComponent(segments[1]);
        password = decodeURIComponent(segments[2]);
      } catch {
        return null;
      }
    }
  }
  if (!username || !password) return null;
  return { server: parsed.origin, username, password };
}

/**
 * Where the panel's account endpoint is, given the playlist address, or null
 * when the address is not an Xtream panel's.
 *
 * @param {string} playlistUrl
 * @returns {string|null}
 */
export function panelApiUrl(playlistUrl) {
  const login = loginFromPlaylistUrl(playlistUrl);
  if (!login) return null;
  const api = new URL('/player_api.php', login.server);
  api.searchParams.set('username', login.username);
  api.searchParams.set('password', login.password);
  return api.toString();
}

/** These panels send numbers as strings ("1"), and some send nothing. */
function count(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/** Unix seconds as a string, or null for a line that does not expire. */
function expiry(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const at = new Date(n * 1000);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * What the panel says about the line behind a playlist URL, or null.
 *
 * Never throws: a list that is not an Xtream panel is a perfectly good list,
 * and an import must not fail because the question about connections could not
 * be asked. It is a JSON request, not a stream, so it does not count against
 * the line's connections.
 *
 * @param {string} playlistUrl
 * @param {{ fetch?: typeof fetch, timeoutMs?: number, userAgent?: string }} [opts]
 * @returns {Promise<{maxConnections: number|null, activeConnections: number|null,
 *   status: string|null, expiresAt: Date|null} | null>}
 */
export async function lineInfo(
  playlistUrl,
  { fetch: fetchImpl = defaultFetch, timeoutMs = 8000, userAgent = settings.userAgent } = {},
) {
  const api = panelApiUrl(playlistUrl);
  if (!api) return null;

  let body;
  try {
    const res = await fetchImpl(api, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': userAgent, accept: 'application/json' },
    });
    if (!res.ok) return null;
    body = await res.json();
  } catch {
    return null;
  }

  const info = body?.user_info;
  if (!info || typeof info !== 'object') return null;

  return {
    maxConnections: count(info.max_connections),
    activeConnections: count(info.active_cons),
    status: typeof info.status === 'string' && info.status ? info.status.slice(0, 40) : null,
    expiresAt: expiry(info.exp_date),
  };
}

/** How much of a secret segment survives masking. Enough to recognise, not to use. */
const KEEP = 2;

function maskSegment(value) {
  if (value.length <= KEEP) return '•'.repeat(value.length);
  return value.slice(0, KEEP) + '•'.repeat(Math.min(value.length - KEEP, 8));
}

/**
 * A version of a playlist URL that identifies the line without handing it over.
 *
 * Both shapes a panel hands out are covered: the path form and the query form.
 * Anything unrecognised is masked from the first path segment on, because
 * guessing wrong in the direction of showing less is free and guessing wrong the
 * other way publishes a password.
 */
export function maskPlaylistUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  // The leading segment of the path form is a route, not a secret ("playlist",
  // "live", "get.php"). Everything after it is the credential.
  const masked = segments.map((s, i) => (i === 0 && segments.length > 1 ? s : maskSegment(s)));

  const search = new URLSearchParams(parsed.search);
  for (const key of [...search.keys()]) {
    if (/user|pass|token|key|auth/i.test(key)) search.set(key, maskSegment(search.get(key) ?? ''));
  }
  const query = search.toString();

  return `${parsed.protocol}//${parsed.host}/${masked.join('/')}${query ? `?${decodeURIComponent(query)}` : ''}`;
}

/* --------------------------------------------------------------- adapter -- */

/**
 * Xtream Codes behind the common provider interface. The session IS the login
 * `{ server, username, password }` plus what the panel said about the account;
 * there is no token to refresh, so `refresh` just asks the panel again.
 */
export const xtream = {
  id: 'xtream',
  name: 'Xtream Codes (IPTV)',
  kind: 'iptv',
  account: 'reader',
  signIn: ['credentials'],
  categories: ['live', 'movie', 'series'],

  /** `{ server, username, password }` or `{ url }` (a playlist URL). Checked with the panel. */
  async connect(input = {}, { fetch: fetchImpl } = {}) {
    const login = input.url
      ? loginFromPlaylistUrl(input.url)
      : input.server && input.username && input.password
        ? { server: serverOf(input.server), username: input.username, password: input.password }
        : null;
    if (!login) {
      throw new XtreamError('Enter the server, username and password your provider gave you.', 400);
    }
    const info = await account(login, fetchImpl);
    return { step: 'done', session: { ...login, account: info } };
  },

  async refresh(session, { fetch: fetchImpl } = {}) {
    return { ...session, account: await account(session, fetchImpl) };
  },

  /** Live channels by default; `{ category: 'movie' | 'series' }` for VOD. */
  channels(session, { category = 'live', ext } = {}, { fetch: fetchImpl } = {}) {
    if (category === 'movie') return movies(session, { fetchImpl });
    if (category === 'series') return series(session, { fetchImpl });
    return liveChannels(session, { fetchImpl, ext });
  },

  /** A live stream id (number, or the `x<id>` channel id) to its URL. Xtream URLs do not expire. */
  async resolve(session, channelId, { ext = 'ts' } = {}) {
    const id = String(channelId).replace(/^x/, '');
    if (!/^\d+$/.test(id)) throw new XtreamError('That is not a live channel id.', 400);
    return { url: liveUrl(session, id, ext), validUntil: null };
  },
};

export default xtream;
