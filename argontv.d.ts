import type { ProviderError, StreamProvider } from './index';
import type { XtreamLogin } from './xtream';

export class ArgonTvError extends ProviderError {
  constructor(message: string, status?: number, data?: unknown);
}
export const RESELLER_BASE_URL: string;
export const PUBLIC_API_URL: string;
export const PACKAGES: { month: number; quarter: number; half: number; year: number; trial24h: number; trial3h: number };
export const PACKAGE_MONTHS: Record<number, number>;

export interface ArgonLine {
  id: number;
  username: string;
  password: string;
  m3u: string | null;
  expiresAt: Date | null;
  status: string | null;
  maxConnections: number | null;
  packageId: number | null;
}
type FetchImpl = typeof fetch | ((url: string, init?: RequestInit) => Promise<Response>);

export interface Reseller {
  call(path: string, opts?: { method?: string; body?: unknown }): Promise<any>;
  balance(): Promise<{ credits: number; bankBalance: number }>;
  templates(): Promise<Array<{ id: number; name: string; created_at?: string }>>;
  lines(opts?: { page?: number }): Promise<{ page: number; totalPages: number; lines: any[] }>;
  getLine(lineId: number): Promise<ArgonLine>;
  createLine(opts: {
    packageId: number;
    connections?: number;
    additionalConnections?: number;
    template?: number | null;
    notes?: string;
    username?: string;
    password?: string;
  }): Promise<ArgonLine & { raw: any }>;
  extendLine(opts: { lineId?: number; lineIds?: number[]; packageId: number }): Promise<{ successful: number; failed: number }>;
  refund(opts: { lineId?: number; lineIds?: number[] }): Promise<{ successful: number; failed: number }>;
}
export function createReseller(opts: { apiKey: string; baseUrl?: string; fetch?: FetchImpl; timeoutMs?: number; templateId?: number | null }): Reseller;
export function lineFrom(data: any): ArgonLine;
export function lineLogin(line: Pick<ArgonLine, 'm3u' | 'username' | 'password'>): XtreamLogin | null;
export function createLineup(opts?: { baseUrl?: string; fetch?: FetchImpl; userAgent?: string; pauseMs?: number; attempts?: number; timeoutMs?: number }): {
  post(path: string, body: unknown): Promise<any>;
  categories(): Promise<any[]>;
  channels(categoryName: string): Promise<any[]>;
};
export const argontv: StreamProvider<{ apiKey: string; baseUrl: string; balance: { credits: number; bankBalance: number } }, any>;
export default argontv;
