# @profullstack/stream-providers

Sign a reader into their own streaming or radio account, and pull lineups and playable stream URLs from it. One adapter per provider, one interface, and no storage: an adapter takes a session and hands one back, and your app decides where (and how sealed) it lives.

| Adapter | Import | Who holds the account | Sign-in |
| --- | --- | --- | --- |
| `siriusxm` | `@profullstack/stream-providers/siriusxm` | the reader (bring your own subscription) | emailed code, or password |
| `xtream` | `@profullstack/stream-providers/xtream` | the reader (their IPTV provider's Xtream Codes panel) | server + username + password, or a playlist URL |
| `argontv` | `@profullstack/stream-providers/argontv` | the site (an ArgonTV reseller account) | API key |

```sh
npm install @profullstack/stream-providers
# SiriusXM's device-grant mint needs a Chromium:
npm install puppeteer-core
```

## The interface

```js
import { provider } from '@profullstack/stream-providers';

const p = provider('siriusxm');
const started = await p.connect({ email }, { proxy });          // { step: 'code', state } | { step: 'done', session }
const session = await p.verify(started.state, code, { proxy }); // code-based sign-in only
const fresh = await p.refresh(session, { proxy });
const lineup = await p.channels(session, { category: 'sports' }, { proxy });
const { url, validUntil } = await p.resolve(session, lineup[0].stationId, { proxy });
```

Every adapter has `id`, `name`, `kind` (`radio` | `iptv`), `account` (`reader` | `reseller`), `signIn` and `categories`, plus `connect`, `channels`, `resolve` and, where the provider has them, `verify`, `refresh` and `search`.

Errors are `ProviderError` subclasses (`SiriusXmError`, `XtreamError`, `ArgonTvError`). `status` is HTTP-shaped, so a route can pass it through; `readerFault` is true for a 4xx, which is the reader's to fix (a wrong code, an unknown email, a refused login). Messages are written for the reader; `data` holds what the provider said, for logs.

## SiriusXM

The reader connects their own subscription; nothing is pooled. Everything known about the edge gateway is in here:

- **Residential exit.** SiriusXM answers datacenter addresses with a 403 from its AWS edge (`server: awselb`), and pins a session to the IP that made it. Pass the same `proxy` for the login, every refresh and every segment; hash the reader's id over a pool to keep it stable.
- **Edge blocks are retried** through the proxy on a fresh connection (`keepalive: false`, so the exit rotates), up to four attempts.
- **Device grant.** When the gateway wants an anonymous session it needs a `DEVICE_GRANT` only the web player's JavaScript mints, so a headless Chromium loads the player through the proxy and reads the cookie. A refused exit relaunches the browser (four launches at most). One mint at a time; reused until ten minutes before it expires.
- **Unknown email** is the live gateway's 404 `userServices.identity.identityDoesNotExist`, surfaced as a 404 with `UNKNOWN_EMAIL_MESSAGE`. A proxy out of bandwidth (402) says so instead of blaming SiriusXM.
- **HLS.** `rewritePlaylist` collapses the ladder to one bitrate and points every segment and key at your own proxy route; `decodeKeyJson` turns the AES key JSON into the 16 bytes a player wants; `isSiriusXmUrl` is the allowlist for what your proxy may fetch.

```js
import * as sxm from '@profullstack/stream-providers/siriusxm';

// Defaults suit Bun. On Node, give it undici's ProxyAgent:
import { ProxyAgent } from 'undici';
sxm.configure({ proxyInit: (url) => ({ dispatcher: new ProxyAgent(url) }) });

// Optional: your own fetch, a Chromium path, or no browser at all (tests).
sxm.configure({ executablePath: '/usr/bin/chromium', browserMint: false });
```

Unset settings fall back to `PUPPETEER_EXECUTABLE_PATH` and `SIRIUSXM_BROWSER_MINT=off`, read at call time.

The lower-level functions (`startOtpLogin`, `completeOtpLogin`, `passwordLogin`, `refreshSession`, `browseChannels`, `searchChannels`, `tuneChannel`, `sxmFetch`, ...) are exported too; `browseChannels` and friends take `{ bearer, proxy, unauthorized }`, so an app can hand in its own refreshing bearer.

## Xtream Codes

Runs anywhere fetch does, browsers included.

```js
import { xtream, lineInfo, maskPlaylistUrl } from '@profullstack/stream-providers/xtream';

const { session } = await xtream.connect({ url: 'http://host/get.php?username=U&password=P&type=m3u_plus' });
session.account.maxConnections; // what the panel enforces
const live = await xtream.channels(session);                       // or { category: 'movie' | 'series' }
const { url } = await xtream.resolve(session, live[0].id, { ext: 'm3u8' });

await lineInfo(playlistUrl); // connections and expiry, or null; never throws
maskPlaylistUrl(playlistUrl); // safe to show
```

Also: `apiUrl`, `liveUrl`, `movieUrl`, `episodeUrl`, `timeshiftUrl`, `xmltvUrl`, `movies`, `series`, `seriesInfo`, `shortEpg`, `panelApiUrl`, `loginFromPlaylistUrl`.

## ArgonTV (reseller)

```js
import { createReseller, createLineup, lineLogin, PACKAGES } from '@profullstack/stream-providers/argontv';

const argon = createReseller({ apiKey: process.env.ARGON_RESELLER_API_KEY, templateId: 2633 });
await argon.balance();                                              // { credits, bankBalance }
const line = await argon.createLine({ packageId: PACKAGES.month, connections: 3, notes: orderId });
await argon.extendLine({ lineId: line.id, packageId: PACKAGES.month });
await argon.getLine(line.id);                                       // normalised, see lineFrom
await argon.refund({ lineId: line.id });

xtream.resolve(lineLogin(line), 'x123');                            // a sold line plays as Xtream

const lineup = createLineup();                                     // public, no key
for (const cat of await lineup.categories()) await lineup.channels(cat.name2);
```

The reseller API authenticates with `X-ApiKey` (a bearer is refused), reads lines at `/api/v1/lines/:id`, and `extend` / `refund` take `{ lines: [id] }`, as verified against the live API.

## Not here (yet)

No Netflix, Spotify or other adapter exists until a site actually signs readers into one. Adding a provider means a new `src/<id>.js` exporting an object with the interface above, a subpath in `package.json`, and tests against a faked provider.

## License

MIT
