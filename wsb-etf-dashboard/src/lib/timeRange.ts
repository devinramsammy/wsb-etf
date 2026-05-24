export const TIME_RANGES = [
  { id: '1W', label: '1W', days: 7 },
  { id: '1M', label: '1M', days: 30 },
  { id: '1Y', label: '1Y', days: 365 },
  { id: 'ALL', label: 'All', days: null },
] as const

export type TimeRangeId = (typeof TIME_RANGES)[number]['id']

export const DEFAULT_TIME_RANGE: TimeRangeId = 'ALL'

function toDay(dateStr: string): string {
  return dateStr.slice(0, 10)
}

function subtractDays(dateStr: string, days: number): string {
  const date = new Date(`${toDay(dateStr)}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

/** Keep points within the selected lookback from the latest observation. */
export function filterSeriesByTimeRange<T extends { date: string }>(
  data: T[],
  range: TimeRangeId,
): T[] {
  if (data.length === 0 || range === 'ALL') return data

  const sorted = [...data].sort((a, b) => toDay(a.date).localeCompare(toDay(b.date)))
  const config = TIME_RANGES.find((item) => item.id === range)
  if (!config?.days) return sorted

  const endDate = toDay(sorted[sorted.length - 1]!.date)
  const cutoff = subtractDays(endDate, config.days)
  const filtered = sorted.filter((point) => toDay(point.date) >= cutoff)

  if (filtered.length >= 2) return filtered
  return sorted.length >= 2 ? sorted : filtered
}
