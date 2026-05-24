export const BENCHMARKS = [
  { id: 'VOO', name: 'S&P 500' },
  { id: 'VTI', name: 'Total Market' },
  { id: 'QQQ', name: 'Nasdaq 100' },
  { id: 'IWM', name: 'Russell 2000' },
  { id: 'VT', name: 'World' },
] as const

export type BenchmarkId = (typeof BENCHMARKS)[number]['id']

export const DEFAULT_BENCHMARK: BenchmarkId = 'VOO'

export function getBenchmarkConfig(id: BenchmarkId) {
  return BENCHMARKS.find((b) => b.id === id)!
}
