import type { BenchmarkPoint } from '@/api/client'

function toDay(dateStr: string): string {
  return dateStr.slice(0, 10)
}

/** Total return for a benchmark aligned to the ETF inception date. */
export function computeAlignedReturn(
  benchmarkData: BenchmarkPoint[] | undefined,
  anchorDate: string,
): number | null {
  if (!benchmarkData || benchmarkData.length === 0) return null

  const sorted = [...benchmarkData].sort((a, b) => a.date.localeCompare(b.date))
  const anchor = toDay(anchorDate)

  let base: BenchmarkPoint | null = null
  for (const point of sorted) {
    if (point.date <= anchor) base = point
    if (point.date >= anchor) break
  }
  if (!base) base = sorted[0]!

  const filtered = sorted.filter((point) => point.date >= anchor)
  if (filtered.length === 0) return null

  const latest = filtered[filtered.length - 1]!
  return ((latest.price - base.price) / base.price) * 100
}

/** Normalized return series for chart overlay, anchored to ETF start. */
export function normalizeBenchmarkToReturn(
  benchmarkData: BenchmarkPoint[],
  anchorDate: string,
): { time: string; value: number }[] {
  if (benchmarkData.length === 0) return []

  const sorted = [...benchmarkData].sort((a, b) => a.date.localeCompare(b.date))
  const anchor = toDay(anchorDate)

  let base: BenchmarkPoint | null = null
  for (const point of sorted) {
    if (point.date <= anchor) base = point
    if (point.date >= anchor) break
  }
  if (!base) base = sorted[0]!

  const basePrice = base.price
  if (basePrice === 0) return []

  const filtered = sorted.filter((point) => point.date >= anchor)
  const dateMap = new Map<string, { time: string; value: number }>()

  for (const point of filtered) {
    const time = toDay(point.date)
    dateMap.set(time, {
      time,
      value: ((point.price - basePrice) / basePrice) * 100,
    })
  }

  return Array.from(dateMap.values()).sort((a, b) => a.time.localeCompare(b.time))
}
