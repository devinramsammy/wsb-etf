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
export function fetchComposition(date?: string): Promise<CompositionEntry[]> {
  const query = date ? `?date=${date}` : '';
  return request<ApiResponse<CompositionEntry>>(`/api/composition${query}`).then(
    (r) => r.data,
  );
}

/** ETF price history over time */
export function fetchPriceHistory(): Promise<PricePoint[]> {
  return request<ApiResponse<PricePoint>>('/api/price-history').then(
    (r) => r.data,
  );
}

/** Distinct rebalance dates, totals, and last event (lightweight). */
export function fetchChangelogMeta(): Promise<ChangelogMeta> {
  return request<{ data: ChangelogMeta }>('/api/changelog/meta').then(
    (r) => r.data,
  );
}

/** Changelog rows for one rebalance date (YYYY-MM-DD), or all rows if no date. */
export function fetchChangelog(date?: string): Promise<ChangelogEntry[]> {
  const query =
    date !== undefined && date !== ''
      ? `?date=${encodeURIComponent(date)}`
      : '';
  return request<ApiResponse<ChangelogEntry>>(`/api/changelog${query}`).then(
    (r) => r.data,
  );
}

/** VOO benchmark price history */
export function fetchBenchmark(): Promise<BenchmarkPoint[]> {
  return request<ApiResponse<BenchmarkPoint>>('/api/benchmark').then(
    (r) => r.data,
  );
}
