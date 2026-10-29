import type { ArgonTvError } from './argontv';
import type { SiriusXmError } from './siriusxm';
import type { XtreamError } from './xtream';

export class ProviderError extends Error {
  constructor(message: string, status?: number, data?: unknown, opts?: { provider?: string });
  /** HTTP-shaped: 4xx the reader can fix, 5xx is ours or the provider's. */
  status: number;
  /** What the provider said, for logs; never shown to a reader. */
  data: unknown;
  provider: string | null;
  /** True for any 4xx. */
  readonly readerFault: boolean;
}
export function isProviderError(err: unknown): err is ProviderError;

export type ConnectResult<State, Session> =
  | { step: 'code'; state: State }
  | { step: 'done'; session: Session };

export interface Stream {
  url: string;
  validUntil: string | null;
}

/** The common interface every adapter implements. */
export interface StreamProvider<Session = unknown, Channel = unknown, State = unknown> {
  id: string;
  name: string;
  kind: 'radio' | 'iptv';
  account: 'reader' | 'reseller';
  signIn: Array<'otp' | 'password' | 'credentials' | 'apikey'>;
  categories: readonly string[];
  connect(input: Record<string, unknown>, ctx?: Record<string, unknown>): Promise<ConnectResult<State, Session>>;
  verify?(state: State, code: string, ctx?: Record<string, unknown>): Promise<Session>;
  refresh?(session: Session, ctx?: Record<string, unknown>): Promise<Session>;
  channels(session: Session, opts?: Record<string, unknown>, ctx?: Record<string, unknown>): Promise<Channel[]>;
  search?(session: Session, query: string, ctx?: Record<string, unknown>): Promise<Channel[]>;
  resolve(session: Session, channelId: string | number | object, ctx?: Record<string, unknown>): Promise<Stream>;
}

export { argontv, ArgonTvError, createLineup, createReseller, lineFrom, lineLogin } from './argontv';
export { siriusxm, SiriusXmError } from './siriusxm';
export { xtream, XtreamError } from './xtream';

export const providers: Readonly<Record<'argontv' | 'siriusxm' | 'xtream', StreamProvider<any, any, any>>>;
export function provider(id: string): StreamProvider<any, any, any> | null;
