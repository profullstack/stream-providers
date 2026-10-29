/**
 * ArgonTV, from both sides of the counter.
 *
 * 1. The RESELLER API (distributors.argontv.nl): our own account issues IPTV
 *    lines that a site sells. Authenticated with `X-ApiKey`; JSON in and out;
 *    failures arrive as `{"error": true, "err": "..."}`, sometimes with a 200, so
 *    both the status and the body are checked. Verified against the live API
 *    2026-10-29: `Authorization: Bearer` is refused ("Unauthorized"), the line
 *    route is `/lines/:id` (`/line/:id` is "Route not found"), `extend` and
 *    `refund` take `{ lines: [id], package }`.
 *
 * 2. The PUBLIC lineup (argontv.nl/api/v1): the categories and channels its own
 *    channel-list page shows. No key; ten a page.
 *
 * A line is an Xtream Codes login, so playing one is the `xtream` adapter's job:
 * `lineLogin(line)` hands it over.
 *
 * Runs anywhere fetch does. Nothing here is shown to a buyer; whether a site
 * names the provider at all is the site's call.
 */

import { ProviderError } from './errors.js';

export const RESELLER_BASE_URL = 'https://distributors.argontv.nl';
export const PUBLIC_API_URL = 'https://argontv.nl/api/v1';

/**
 * Package ids on the reseller account (from the distributor panel). Test lines
 * are refused over the API ("Creating trials using the API was disabled",
 * 2026-10-17).
 */
export const PACKAGES = {
  month: 113653,
  quarter: 113654,
  half: 113655,
  year: 113656,
  trial24h: 113657,
  trial3h: 113658,
};

/** Months of service each package buys. */
export const PACKAGE_MONTHS = {
  [PACKAGES.month]: 1,
  [PACKAGES.quarter]: 3,
  [PACKAGES.half]: 6,
  [PACKAGES.year]: 12,
};

export class ArgonTvError extends ProviderError {
  constructor(message, status = 502, data = null) {
    super(message, status, data, { provider: 'argontv' });
    this.name = 'ArgonTvError';
  }
}

const defaultFetch = (url, init) => globalThis.fetch(url, init);

/** The reason the API gave, under whichever field name it used this time. */
const reasonOf = (data) => data?.err ?? data?.err_message ?? data?.message ?? null;

/**
 * A reseller client.
 *
 * @param {{ apiKey: string, baseUrl?: string, fetch?: typeof fetch, timeoutMs?: number,
 *   templateId?: number|null }} options
 */
export function createReseller({
  apiKey,
  baseUrl = RESELLER_BASE_URL,
  fetch: fetchImpl = defaultFetch,
  timeoutMs = 30_000,
  templateId = null,
} = {}) {
  const base = String(baseUrl || RESELLER_BASE_URL).replace(/\/+$/, '').replace(/\/api\/v1$/, '');

  async function call(path, { method = 'GET', body } = {}) {
    if (!apiKey) throw new ArgonTvError('the ArgonTV reseller API key is not configured', 500);
    let res;
    try {
      res = await fetchImpl(`${base}/api/v1/${path.replace(/^\/+/, '')}`, {
        method,
        headers: {
          'x-apikey': apiKey,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new ArgonTvError(`ArgonTV did not answer: ${err?.message ?? err}`, 502);
    }
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new ArgonTvError(`ArgonTV ${path}: HTTP ${res.status} ${text.slice(0, 200)}`, 502);
    }
    if (!res.ok || data?.error === true) {
      const reason = reasonOf(data) ?? `HTTP ${res.status}`;
      throw new ArgonTvError(`ArgonTV ${path}: ${reason}`, 502, data);
    }
    return data;
  }

  return {
    call,

    /** `{ credits, bankBalance }`: what the account can still issue. */
    async balance() {
      const d = await call('balance');
      return { credits: Number(d.credits ?? 0), bankBalance: Number(d.bank_balance ?? 0) };
    },

    /** Bouquets the account can issue lines on: `[{ id, name, created_at }]`. */
    async templates() {
      const d = await call('templates');
      return d.templates ?? [];
    },

    /** One page of the account's lines, raw. */
    async lines({ page = 1 } = {}) {
      const d = await call(`lines?page=${Number(page) || 1}`);
      return { page: d.current_page ?? page, totalPages: d.total_pages ?? 1, lines: d.lines ?? [] };
    },

    /** What the panel says about a line, normalised (see `lineFrom`). */
    async getLine(lineId) {
      return lineFrom(await call(`lines/${Number(lineId)}`));
    },

    /**
     * Open a new line. `connections` is the total a buyer may use at once; the
     * API's `additional_cons` is connections BEYOND the one a line comes with.
     * Returns the normalised line plus `raw`.
     */
    async createLine({
      packageId,
      connections = 1,
      additionalConnections,
      template = templateId,
      notes,
      username,
      password,
    } = {}) {
      if (!packageId) throw new ArgonTvError('createLine needs a packageId', 500);
      const body = { package: Number(packageId) };
      if (template) body.template = Number(template);
      // Said outright (even 0) it is sent as given; derived from `connections` it is
      // only sent when there are extras, which is what the API defaults to anyway.
      if (additionalConnections !== undefined && additionalConnections !== null) {
        body.additional_cons = Math.max(0, Math.trunc(Number(additionalConnections) || 0));
      } else {
        const extra = Math.max(0, Math.trunc(Number(connections) || 1) - 1);
        if (extra > 0) body.additional_cons = extra;
      }
      if (notes) body.notes = String(notes).slice(0, 200);
      if (username) body.username = String(username);
      if (password) body.password = String(password);
      const d = await call('create-line', { method: 'POST', body });
      return { ...lineFrom(d), raw: d };
    },

    /**
     * Add a package's length to lines that exist. The panel answers with counts
     * rather than the new expiry, so read the line back afterwards.
     */
    async extendLine({ lineId, lineIds, packageId } = {}) {
      const lines = (lineIds ?? [lineId]).map(Number);
      const d = await call('extend', { method: 'POST', body: { lines, package: Number(packageId) } });
      if (!d.successful) throw new ArgonTvError('ArgonTV extended nothing', 502, d);
      return { successful: Number(d.successful), failed: Number(d.failed ?? 0) };
    },

    /** Give a line back and restore its credit. */
    async refund({ lineId, lineIds } = {}) {
      const lines = (lineIds ?? [lineId]).map(Number);
      const d = await call('refund', { method: 'POST', body: { lines } });
      return { successful: Number(d.successful ?? 0), failed: Number(d.failed ?? 0) };
    },
  };
}

/**
 * A line as the API sends it, in one shape. Timestamps are unix seconds on the
 * detail route; `status` and `max_connections` are read when present and
 * derived from `is_suspended` / `additional_connections` when not.
 *
 * @returns {{ id: number, username: string, password: string, m3u: string|null,
 *   expiresAt: Date|null, status: string|null, maxConnections: number|null, packageId: number|null }}
 */
export function lineFrom(data) {
  const id = Number(data?.id);
  if (!Number.isFinite(id) || id < 1) throw new ArgonTvError('ArgonTV sent no line id', 502, data);
  const username = data.xtream_codes_username ?? data.username ?? data.line_username;
  const password = data.xtream_codes_password ?? data.password ?? data.line_password;
  if (!username || !password) throw new ArgonTvError('ArgonTV sent no credential', 502);
  const exp = Number(data.expiration_time);
  const max = Number(data.max_connections);
  const extra = Number(data.additional_connections);
  return {
    id,
    username: String(username),
    password: String(password),
    m3u: data.m3u_download_link ? String(data.m3u_download_link) : null,
    expiresAt: Number.isFinite(exp) && exp > 0 ? new Date(exp * 1000) : null,
    status:
      data.status !== undefined && data.status !== null
        ? String(data.status)
        : data.is_suspended === true
          ? 'suspended'
          : data.is_suspended === false
            ? 'active'
            : null,
    maxConnections: Number.isFinite(max) && max > 0 ? max : Number.isFinite(extra) ? extra + 1 : null,
    packageId: Number.isFinite(Number(data.package_id)) ? Number(data.package_id) : null,
  };
}

/**
 * The Xtream login behind a line, for the `xtream` adapter: the server is the
 * M3U link's origin.
 */
export function lineLogin(line) {
  if (!line?.m3u) return null;
  try {
    const u = new URL(line.m3u);
    return { server: u.origin, username: line.username, password: line.password };
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------- public lineup -- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The public lineup, as its own channel-list page reads it.
 *
 * @param {{ baseUrl?: string, fetch?: typeof fetch, userAgent?: string, pauseMs?: number,
 *   attempts?: number, timeoutMs?: number }} [options]
 */
export function createLineup({
  baseUrl = PUBLIC_API_URL,
  fetch: fetchImpl = defaultFetch,
  userAgent = 'stream-providers (+https://github.com/profullstack/stream-providers)',
  pauseMs = 150,
  attempts = 4,
  timeoutMs = 30_000,
} = {}) {
  const base = String(baseUrl).replace(/\/+$/, '');

  async function post(path, body, attempt = 1) {
    try {
      const res = await fetchImpl(`${base}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': userAgent },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(reasonOf(data) ?? 'api error');
      return data;
    } catch (err) {
      if (attempt >= attempts) {
        throw new ArgonTvError(`${path} ${JSON.stringify(body)}: ${err.message}`, 502);
      }
      await sleep(1000 * 2 ** attempt);
      return post(path, body, attempt + 1);
    }
  }

  async function walk(path, body) {
    const first = await post(`${path}?page=1`, body);
    const all = [...(first.entries ?? [])];
    for (let page = 2; page <= (first.total_pages ?? 1); page++) {
      await sleep(pauseMs);
      const d = await post(`${path}?page=${page}`, body);
      all.push(...(d.entries ?? []));
    }
    return all;
  }

  return {
    post,
    /** Every category: `[{ name, name2, name_display, type, ... }]`. */
    categories: () => walk('search-cats-v2', { query: '' }),
    /** Every channel in one category, by its `name2` (or `name`). */
    channels: (categoryName) =>
      walk('search-channels-v2', { query: '', category_name: categoryName }),
  };
}

/* --------------------------------------------------------------- adapter -- */

/**
 * ArgonTV behind the common provider interface. The account is the SITE's
 * reseller account, not a reader's: `connect({ apiKey })` checks the key
 * against the balance route, `channels` reads the public lineup, and a sold
 * line is played through the `xtream` adapter (`lineLogin`).
 */
export const argontv = {
  id: 'argontv',
  name: 'ArgonTV',
  kind: 'iptv',
  account: 'reseller',
  signIn: ['apikey'],
  categories: [],

  async connect({ apiKey, baseUrl } = {}, { fetch: fetchImpl } = {}) {
    const reseller = createReseller({ apiKey, baseUrl, fetch: fetchImpl });
    const balance = await reseller.balance();
    return { step: 'done', session: { apiKey, baseUrl: baseUrl ?? RESELLER_BASE_URL, balance } };
  },

  /** The public lineup. `{ category }` is a category `name2`; without one, the categories. */
  channels(_session, { category } = {}, { fetch: fetchImpl, baseUrl } = {}) {
    const lineup = createLineup({ fetch: fetchImpl, ...(baseUrl ? { baseUrl } : {}) });
    return category ? lineup.channels(category) : lineup.categories();
  },

  async resolve() {
    throw new ArgonTvError(
      'ArgonTV lines play through the xtream adapter: xtream.resolve(lineLogin(line), id).',
      400,
    );
  },
};

export default argontv;
