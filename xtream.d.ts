import type { ProviderError, StreamProvider } from './index';

export class XtreamError extends ProviderError {
  constructor(message: string, status?: number, data?: unknown);
}
export interface XtreamLogin {
  server: string;
  username: string;
  password: string;
}
export interface XtreamAccount {
  status: string;
  expiresAt: number | null;
  maxConnections: number | null;
  activeConnections: number;
  formats: string[];
  timeZone: string;
}
export interface XtreamChannel {
  id: string;
  name: string;
  url: string;
  group: string;
  kind: 'live' | 'vod' | 'series';
  streamId?: number;
  logo?: string;
  tvgId?: string;
  chno?: number;
  catchup?: { type: 'xc'; days?: number };
  [key: string]: unknown;
}
type FetchImpl = typeof fetch | ((url: string, init?: RequestInit) => Promise<Response>);

export function configure(options?: { fetch?: FetchImpl | null; userAgent?: string | null }): { fetch: FetchImpl | null; userAgent: string };
export function serverOf(raw: string): string;
export function loginFromM3uUrl(raw: string): XtreamLogin | null;
export function loginFromPlaylistUrl(playlistUrl: string): XtreamLogin | null;
export function panelApiUrl(playlistUrl: string): string | null;
export function maskPlaylistUrl(url: string): string | null;
export function lineInfo(playlistUrl: string, opts?: { fetch?: FetchImpl; timeoutMs?: number; userAgent?: string }): Promise<{ maxConnections: number | null; activeConnections: number | null; status: string | null; expiresAt: Date | null } | null>;
export function apiUrl(login: XtreamLogin, action?: string, params?: Record<string, unknown>): string;
export function xmltvUrl(login: XtreamLogin): string;
export function liveUrl(login: XtreamLogin, streamId: string | number, ext?: string): string;
export function movieUrl(login: XtreamLogin, streamId: string | number, ext?: string): string;
export function episodeUrl(login: XtreamLogin, episodeId: string | number, ext?: string): string;
export function timeshiftUrl(login: XtreamLogin, streamId: string | number, startMs: number, minutes: number, timeZone?: string): string;
export function getJson(url: string, fetchImpl?: FetchImpl): Promise<any>;
export function account(login: XtreamLogin, fetchImpl?: FetchImpl): Promise<XtreamAccount>;
export function liveChannels(login: XtreamLogin, opts?: { fetchImpl?: FetchImpl; ext?: string }): Promise<XtreamChannel[]>;
export function vodCategories(login: XtreamLogin, kind: 'movie' | 'series', fetchImpl?: FetchImpl): Promise<Array<{ id: string; name: string }>>;
export function movieOf(login: XtreamLogin, m: any, catName?: Map<string, string>): XtreamChannel;
export function showOf(s: any, catName?: Map<string, string>): XtreamChannel;
export function movies(login: XtreamLogin, opts?: { category?: string; fetchImpl?: FetchImpl }): Promise<XtreamChannel[]>;
export function series(login: XtreamLogin, opts?: { category?: string; fetchImpl?: FetchImpl }): Promise<XtreamChannel[]>;
export function episodeTitle(raw: string, n: number | string): string;
export function seriesInfo(login: XtreamLogin, seriesId: string | number, fetchImpl?: FetchImpl): Promise<any>;
export function episodes(login: XtreamLogin, seriesId: string | number, fetchImpl?: FetchImpl): Promise<any[]>;
export function shortEpg(login: XtreamLogin, streamId: string | number, limit?: number, fetchImpl?: FetchImpl): Promise<Array<{ start: number; stop: number; title: string; desc?: string }>>;

export const xtream: StreamProvider<XtreamLogin & { account?: XtreamAccount }, XtreamChannel>;
export default xtream;
