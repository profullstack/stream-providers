import type { ProviderError, StreamProvider } from './index';

export class SiriusXmError extends ProviderError {
  constructor(message: string, status: number, data?: unknown);
}

export interface SiriusXmSettings {
  fetch: typeof fetch | null;
  /** Turns a proxy URL into fetch init fields. Default `{ proxy }` (Bun). On Node: `{ dispatcher: new ProxyAgent(url) }`. */
  proxyInit: (proxyUrl: string) => object;
  /** null = read SIRIUSXM_BROWSER_MINT (on unless "off"). */
  browserMint: boolean | null;
  /** null = read PUPPETEER_EXECUTABLE_PATH. */
  executablePath: string | null;
  /** null = import('puppeteer-core'). */
  loadPuppeteer: (() => Promise<any>) | null;
  browserLaunches: number;
  /** Chrome channel when no executablePath is set; null for full puppeteer's bundled Chromium. */
  channel: string | null;
  /** Whether a thrown fetch is retried. Default: all but the caller's abort. */
  isRetryable: (err: unknown) => boolean;
}
export function configure(options?: Partial<{ [K in keyof SiriusXmSettings]: SiriusXmSettings[K] | null }>): SiriusXmSettings;

export interface SiriusXmSession {
  accessToken: string;
  cookies: string;
  accessTokenExpiresAt: string | null;
  refreshTokenExpiresAt: string | null;
}
export interface PendingOtp {
  identityId: string;
  anonAccessToken: string;
  cookies: string;
}
export interface SiriusXmChannel {
  id: string;
  type: 'channel-linear' | 'channel-xtra';
  number: number | null;
  title: string;
  description: string | null;
  image: string | null;
  stationId: string;
}
export interface CallCtx {
  bearer: () => Promise<string>;
  proxy?: string | null;
  unauthorized?: () => unknown;
}

export const CATEGORIES: readonly ['sports', 'news'];
export const QUALITIES: readonly string[];
export const DEFAULT_QUALITY: string;
export const AUTH_HEADERS: Record<string, string>;
export const API_HEADERS: Record<string, string>;
export const UNKNOWN_EMAIL_MESSAGE: string;
export const EDGE_BLOCK_MESSAGE: string;

export function explainStatus(status: number, otherwise: string): string;
export function isEdgeBlock(res: Response): boolean;
export function sxmFetch(url: string | URL, init?: RequestInit, opts?: { proxy?: string | null }): Promise<Response>;
export function sxmCall(path: string, opts?: Record<string, unknown>): Promise<{ status: number; data: any; raw: string; setCookie: string[] }>;
export function mergeCookies(existing: string | null | undefined, setCookie: string[] | null | undefined): string;
export function jwtExpiryMs(token: string | null | undefined): number | null;
export function resetDeviceGrantCache(): void;
export function startOtpLogin(email: string, opts?: { proxy?: string | null; deviceGrant?: string | null }): Promise<PendingOtp>;
export function completeOtpLogin(state: PendingOtp, otp: string, opts?: { proxy?: string | null }): Promise<SiriusXmSession>;
export function passwordLogin(handle: string, password: string, opts?: { proxy?: string | null; deviceGrant?: string | null }): Promise<SiriusXmSession>;
export function refreshSession(cookies: string, opts?: { proxy?: string | null }): Promise<SiriusXmSession>;
export function stationId(channelId: string, type: string): string;
export function parseStationId(id: unknown): { id: string; type: string } | null;
export function categoryQuery(cat: string): string;
export function imageUrl(raw: unknown): string | null;
export function itemToChannel(item: unknown): SiriusXmChannel | null;
export function dedupeChannels(channels: SiriusXmChannel[]): SiriusXmChannel[];
export function browseChannels(cat: string, ctx: CallCtx): Promise<SiriusXmChannel[]>;
export function searchChannels(query: string, ctx: CallCtx): Promise<SiriusXmChannel[]>;
export function tuneChannel(parsed: { id: string; type: string }, ctx: CallCtx): Promise<{ url: string; validUntil: string | null }>;
export function isSiriusXmUrl(url: string): boolean;
export function looksLikePlaylist(url: string, contentType?: string | null): boolean;
export function isKeyUrl(url: string): boolean;
export function rewritePlaylist(text: string, playlistUrl: string, quality: string, proxify: (url: string) => string): string;
export function decodeKeyJson(json: unknown): Buffer;

export const siriusxm: StreamProvider<SiriusXmSession, SiriusXmChannel, PendingOtp> & {
  expiresSoon(session: SiriusXmSession, marginMs?: number): boolean;
  isStreamUrl(url: string): boolean;
};
export default siriusxm;
