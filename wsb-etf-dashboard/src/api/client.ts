import { DEFAULT_SUBREDDIT } from '@/lib/subreddits'
import type { SubredditId } from '@/lib/subreddits'

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export interface CompositionEntry {
  ticker: string;
  percentage: number;
  shares: number;
  price: number;
}

export interface PricePoint {
  price: number;
  date: string;
}

export interface ChangelogEntry {
  action: string;
  ticker: string;
  weight: number;
  date: string;
}

export interface ChangelogMeta {
  dates: string[];
  totalEntries: number;
  lastRebalanceDate: string | null;
}

export interface BenchmarkPoint {
  date: string;
  price: number;
}

interface ApiResponse<T> {
  data: T[];
}

function subredditQuery(subreddit: SubredditId = DEFAULT_SUBREDDIT): string {
  return `subreddit=${encodeURIComponent(subreddit)}`
}

function appendSubreddit(path: string, subreddit: SubredditId): string {
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}${subredditQuery(subreddit)}`
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}

/** Current composition, or historical if date provided (YYYY-MM-DD) */
export function fetchComposition(
  subreddit: SubredditId = DEFAULT_SUBREDDIT,
  date?: string,
): Promise<CompositionEntry[]> {
  const base = date ? `/api/composition?date=${date}` : '/api/composition'
  return request<ApiResponse<CompositionEntry>>(appendSubreddit(base, subreddit)).then(
    (r) => r.data,
  );
}

/** ETF price history over time */
export function fetchPriceHistory(
  subreddit: SubredditId = DEFAULT_SUBREDDIT,
): Promise<PricePoint[]> {
  return request<ApiResponse<PricePoint>>(appendSubreddit('/api/price-history', subreddit)).then(
    (r) => r.data,
  );
}

/** Distinct rebalance dates, totals, and last event (lightweight). */
export function fetchChangelogMeta(
  subreddit: SubredditId = DEFAULT_SUBREDDIT,
): Promise<ChangelogMeta> {
  return request<{ data: ChangelogMeta }>(appendSubreddit('/api/changelog/meta', subreddit)).then(
    (r) => r.data,
  );
}

/** Changelog rows for one rebalance date (YYYY-MM-DD), or all rows if no date. */
export function fetchChangelog(
  subreddit: SubredditId = DEFAULT_SUBREDDIT,
  date?: string,
): Promise<ChangelogEntry[]> {
  const base =
    date !== undefined && date !== ''
      ? `/api/changelog?date=${encodeURIComponent(date)}`
      : '/api/changelog'
  return request<ApiResponse<ChangelogEntry>>(appendSubreddit(base, subreddit)).then(
    (r) => r.data,
  );
}

/** VOO benchmark price history */
export function fetchBenchmark(): Promise<BenchmarkPoint[]> {
  return request<ApiResponse<BenchmarkPoint>>('/api/benchmark').then(
    (r) => r.data,
  );
}
