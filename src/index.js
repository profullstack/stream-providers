/**
 * @profullstack/stream-providers
 *
 * One adapter per streaming or radio provider, behind one interface, so every
 * site that signs a reader into their own account (or sells lines on ours) runs
 * the same protocol code. Storage stays with the app: an adapter takes a session
 * and returns a session, and never touches a database, a vault or a cookie.
 *
 * Every adapter is also its own subpath, so a page that only needs Xtream does
 * not load SiriusXM's browser mint:
 *
 *   import { siriusxm } from '@profullstack/stream-providers/siriusxm';
 *   import { xtream } from '@profullstack/stream-providers/xtream';
 *   import { argontv, createReseller } from '@profullstack/stream-providers/argontv';
 *
 * The interface (every method optional except id/name/kind):
 *
 *   id, name, kind ('radio' | 'iptv'), account ('reader' | 'reseller'), signIn [...]
 *   connect(input, ctx)          -> { step: 'code', state } | { step: 'done', session }
 *   verify(state, code, ctx)     -> session                   (code-based sign-in)
 *   refresh(session, ctx)        -> session
 *   channels(session, opts, ctx) -> Channel[]
 *   search(session, query, ctx)  -> Channel[]
 *   resolve(session, id, ctx)    -> { url, validUntil }
 *
 * Errors are ProviderError (or a subclass): `status` is HTTP-shaped and
 * `readerFault` is true for anything the reader can fix.
 */

import { argontv } from './argontv.js';
import { siriusxm } from './siriusxm.js';
import { xtream } from './xtream.js';

export { isProviderError, ProviderError } from './errors.js';
export { ArgonTvError, createLineup, createReseller, lineFrom, lineLogin } from './argontv.js';
export { SiriusXmError } from './siriusxm.js';
export { XtreamError } from './xtream.js';
export { argontv, siriusxm, xtream };

/** Every adapter, by id. */
export const providers = Object.freeze({ argontv, siriusxm, xtream });

/** One adapter by id, or null. */
export function provider(id) {
  return Object.hasOwn(providers, id) ? providers[id] : null;
}
