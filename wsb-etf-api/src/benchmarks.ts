export const BENCHMARK_TICKERS = ["VOO", "VTI", "QQQ", "IWM", "VT"] as const;

export type BenchmarkTicker = (typeof BENCHMARK_TICKERS)[number];

export const DEFAULT_BENCHMARK_TICKER: BenchmarkTicker = "VOO";

export function isBenchmarkTicker(value: string): value is BenchmarkTicker {
  return (BENCHMARK_TICKERS as readonly string[]).includes(value);
}
