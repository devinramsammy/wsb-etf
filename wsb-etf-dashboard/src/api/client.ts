const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export interface CompositionEntry {
  ticker: string;
  percentage: number;
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
  return request<CompositionEntry[]>(`/api/composition${query}`);
}

/** ETF price history over time */
export function fetchPriceHistory(): Promise<PricePoint[]> {
  return request<PricePoint[]>('/api/price-history');
}

/** Recent changelog entries */
export function fetchChangelog(): Promise<ChangelogEntry[]> {
  return request<ChangelogEntry[]>('/api/changelog');
}
