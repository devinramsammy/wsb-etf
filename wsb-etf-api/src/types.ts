// --- Database row types ---

export interface CompositionRow {
  ticker: string;
  percentage: number;
  shares: number;
  price: number;
}

export interface PriceRow {
  price: number;
  date: string;
}

export interface ChangelogRow {
  action: string;
  ticker: string;
  weight: number;
  date: string;
}

// --- API response types ---

export interface ApiResponse<T> {
  data: T[];
}

export interface ApiError {
  error: string;
}

export interface HealthResponse {
  status: string;
}

// --- Query parameter types ---

export interface CompositionQuery {
  date?: string;
}

export interface PriceHistoryQuery {
  from?: string;
  to?: string;
}

export interface ChangelogQuery {
  date?: string;
}

export interface ChangelogMeta {
  dates: string[];
  totalEntries: number;
  lastRebalanceDate: string | null;
}

export interface BenchmarkQuery {
  from?: string;
  to?: string;
}

// --- Express error with status ---

export interface HttpError extends Error {
  status?: number;
}
