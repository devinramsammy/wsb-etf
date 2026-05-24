import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchPriceHistory, fetchComposition, fetchChangelogMeta } from '../api/client'
import type { PricePoint } from '../api/client'
import { useSubreddit } from '../context/SubredditContext'

function formatCurrency(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatPctSigned(n: number): string {
  const sign = n >= 0 ? '+' : ''
  return sign + n.toFixed(2) + '%'
}

function formatPct(n: number): string {
  return n.toFixed(2) + '%'
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr.slice(0, 10) + 'T00:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

interface KpiCardProps {
  label: string
  value: string
  positive?: boolean | null
}

function KpiCard({ label, value, positive }: KpiCardProps) {
  const valueColor =
    positive === true
      ? 'text-[#4ade80]'
      : positive === false
        ? 'text-[#f87171]'
        : 'text-[#e5e5e5]'

  return (
    <div className="kpi-card">
      <span className="font-mono text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-[#525252]">
        {label}
      </span>
      <span className={`font-mono text-lg font-bold tabular-nums leading-none ${valueColor}`}>
        {value}
      </span>
    </div>
  )
}

function useMetrics(prices: PricePoint[] | undefined) {
  return useMemo(() => {
    if (!prices || prices.length < 2) return null

    const navs = prices.map((p) => Number(p.price))
    const first = navs[0]!
    const last = navs[navs.length - 1]!

    const dailyReturns: number[] = []
    for (let i = 1; i < navs.length; i++) {
      dailyReturns.push((navs[i]! - navs[i - 1]!) / navs[i - 1]!)
    }

    const totalReturn = ((last - first) / first) * 100

    let peak = navs[0]!
    let maxDD = 0
    for (const nav of navs) {
      if (nav > peak) peak = nav
      const dd = (peak - nav) / peak
      if (dd > maxDD) maxDD = dd
    }

    const wins = dailyReturns.filter((r) => r > 0)
    const losses = dailyReturns.filter((r) => r < 0)
    const winRate = (wins.length / dailyReturns.length) * 100
    const avgWin = wins.length > 0 ? (wins.reduce((s, r) => s + r, 0) / wins.length) * 100 : 0
    const avgLoss = losses.length > 0 ? (losses.reduce((s, r) => s + r, 0) / losses.length) * 100 : 0

    const meanReturn = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length
    const variance = dailyReturns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / dailyReturns.length
    const dailyVol = Math.sqrt(variance)
    const annualVol = dailyVol * Math.sqrt(252) * 100
    const annualReturn = meanReturn * 252
    const sharpe = annualVol > 0 ? annualReturn / (dailyVol * Math.sqrt(252)) : 0

    const thirtyDayIdx = Math.max(0, navs.length - 31)
    const return30d = ((last - navs[thirtyDayIdx]!) / navs[thirtyDayIdx]!) * 100

    const oneYearIdx = Math.max(0, navs.length - 253)
    const return1y = ((last - navs[oneYearIdx]!) / navs[oneYearIdx]!) * 100

    return {
      totalReturn,
      maxDD: maxDD * 100,
      return30d,
      return1y,
      sharpe,
      annualVol,
      winRate,
      avgWin,
      avgLoss,
    }
  }, [prices])
}

const kpiGridClass = 'grid grid-cols-2 gap-3 sm:grid-cols-4'

function KpiStrip() {
  const { subreddit } = useSubreddit()

  const { data: prices } = useQuery({
    queryKey: ['priceHistory', subreddit],
    queryFn: () => fetchPriceHistory(subreddit),
  })

  const { data: composition } = useQuery({
    queryKey: ['composition', subreddit],
    queryFn: () => fetchComposition(subreddit),
  })

  const { data: changelogMeta } = useQuery({
    queryKey: ['changelog-meta', subreddit],
    queryFn: () => fetchChangelogMeta(subreddit),
  })

  const metrics = useMetrics(prices)

  const latestNav = prices && prices.length > 0 ? Number(prices[prices.length - 1]!.price) : null
  const holdingsCount = composition?.length ?? null
  const lastRebalanceDate = changelogMeta?.lastRebalanceDate ?? null

  return (
    <div className={kpiGridClass}>
      <KpiCard
        label="NAV"
        value={latestNav != null ? formatCurrency(latestNav) : '—'}
      />
      <KpiCard
        label="Total Return"
        value={metrics ? formatPctSigned(metrics.totalReturn) : '—'}
        positive={metrics ? metrics.totalReturn >= 0 : null}
      />
      <KpiCard
        label="Return (30d)"
        value={metrics ? formatPctSigned(metrics.return30d) : '—'}
        positive={metrics ? metrics.return30d >= 0 : null}
      />
      <KpiCard
        label="Return (1Y)"
        value={metrics ? formatPctSigned(metrics.return1y) : '—'}
        positive={metrics ? metrics.return1y >= 0 : null}
      />
      <KpiCard
        label="Max Drawdown"
        value={metrics ? '-' + formatPct(metrics.maxDD) : '—'}
        positive={false}
      />
      <KpiCard
        label="Sharpe Ratio"
        value={metrics ? metrics.sharpe.toFixed(3) : '—'}
      />
      <KpiCard
        label="Annual Volatility"
        value={metrics ? formatPct(metrics.annualVol) : '—'}
      />
      <KpiCard
        label="Win Rate"
        value={metrics ? formatPct(metrics.winRate) : '—'}
      />
      <KpiCard
        label="Avg Win"
        value={metrics ? formatPctSigned(metrics.avgWin) : '—'}
        positive={true}
      />
      <KpiCard
        label="Avg Loss"
        value={metrics ? formatPct(metrics.avgLoss) : '—'}
        positive={false}
      />
      <KpiCard
        label="Holdings"
        value={holdingsCount != null ? String(holdingsCount) : '—'}
      />
      <KpiCard
        label="Last Rebalance"
        value={lastRebalanceDate ? formatDate(lastRebalanceDate) : '—'}
      />
    </div>
  )
}

export default KpiStrip
