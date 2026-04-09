import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchPriceHistory, fetchComposition, fetchChangelogMeta } from '../api/client'
import type { PricePoint } from '../api/client'

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

/** Compute stats from price series */
function useMetrics(prices: PricePoint[] | undefined) {
  return useMemo(() => {
    if (!prices || prices.length < 2) return null

    const navs = prices.map((p) => Number(p.price))
    const first = navs[0]!
    const last = navs[navs.length - 1]!

    // Daily returns
    const dailyReturns: number[] = []
    for (let i = 1; i < navs.length; i++) {
      dailyReturns.push((navs[i]! - navs[i - 1]!) / navs[i - 1]!)
    }

    // Total return
    const totalReturn = ((last - first) / first) * 100

    // CAGR
    const startDate = new Date(prices[0]!.date)
    const endDate = new Date(prices[prices.length - 1]!.date)
    const years = (endDate.getTime() - startDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
    const cagr = years > 0 ? (Math.pow(last / first, 1 / years) - 1) * 100 : null

    // Max drawdown
    let peak = navs[0]!
    let maxDD = 0
    for (const nav of navs) {
      if (nav > peak) peak = nav
      const dd = (peak - nav) / peak
      if (dd > maxDD) maxDD = dd
    }

    // Win rate + avg win/loss
    const wins = dailyReturns.filter((r) => r > 0)
    const losses = dailyReturns.filter((r) => r < 0)
    const winRate = (wins.length / dailyReturns.length) * 100
    const avgWin = wins.length > 0 ? (wins.reduce((s, r) => s + r, 0) / wins.length) * 100 : 0
    const avgLoss = losses.length > 0 ? (losses.reduce((s, r) => s + r, 0) / losses.length) * 100 : 0

    // Volatility (annualized std dev of daily returns)
    const meanReturn = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length
    const variance = dailyReturns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / dailyReturns.length
    const dailyVol = Math.sqrt(variance)
    const annualVol = dailyVol * Math.sqrt(252) * 100

    // Sharpe (assuming 0 risk-free rate for simplicity)
    const annualReturn = meanReturn * 252
    const sharpe = annualVol > 0 ? (annualReturn / (dailyVol * Math.sqrt(252))) : 0

    // 30d return
    const thirtyDayIdx = Math.max(0, navs.length - 31)
    const return30d = ((last - navs[thirtyDayIdx]!) / navs[thirtyDayIdx]!) * 100

    // 1Y return
    const oneYearIdx = Math.max(0, navs.length - 253)
    const return1y = ((last - navs[oneYearIdx]!) / navs[oneYearIdx]!) * 100

    return {
      totalReturn,
      cagr,
      maxDD: maxDD * 100,
      winRate,
      avgWin,
      avgLoss,
      annualVol,
      sharpe,
      return30d,
      return1y,
    }
  }, [prices])
}

const kpiGridClass = 'grid grid-cols-2 gap-3 sm:grid-cols-4'

/** Smooth vertical expand/collapse without measuring content (grid 0fr → 1fr). */
const kpiExpandGridClass =
  'grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none'

function KpiStrip() {
  const [showMoreKpis, setShowMoreKpis] = useState(false)

  const { data: prices } = useQuery({
    queryKey: ['priceHistory'],
    queryFn: fetchPriceHistory,
  })

  const { data: composition } = useQuery({
    queryKey: ['composition'],
    queryFn: () => fetchComposition(),
  })

  const { data: changelogMeta } = useQuery({
    queryKey: ['changelog-meta'],
    queryFn: fetchChangelogMeta,
  })

  const metrics = useMetrics(prices)

  const latestNav = prices && prices.length > 0 ? Number(prices[prices.length - 1]!.price) : null
  const holdingsCount = composition?.length ?? null
  const lastRebalanceDate = changelogMeta?.lastRebalanceDate ?? null
  const totalTrades = changelogMeta?.totalEntries ?? null

  return (
    <div>
      <div className={kpiGridClass}>
        {/* Row 1 */}
        <KpiCard
          label="NAV"
          value={latestNav != null ? formatCurrency(latestNav) : '—'}
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
          label="CAGR (Total)"
          value={metrics?.cagr != null ? formatPctSigned(metrics.cagr) : '—'}
          positive={metrics?.cagr != null ? metrics.cagr >= 0 : null}
        />

        {/* Row 2 */}
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
      </div>

      <div
        className={`${kpiExpandGridClass} ${showMoreKpis ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className={`${kpiGridClass} pt-3 transition-opacity duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none ${showMoreKpis ? 'opacity-100' : 'opacity-0'}`}
          >
            {/* Row 3 */}
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
              label="Total Trades"
              value={totalTrades != null ? String(totalTrades) : '—'}
            />

            {/* Row 4 */}
            <KpiCard
              label="Last Rebalance"
              value={lastRebalanceDate ? formatDate(lastRebalanceDate) : '—'}
            />
            <KpiCard
              label="Total Return"
              value={metrics ? formatPctSigned(metrics.totalReturn) : '—'}
              positive={metrics ? metrics.totalReturn >= 0 : null}
            />
            <KpiCard
              label="Rebalance Cadence"
              value="Weekly"
            />
            <KpiCard
              label="Benchmark"
              value="VOO"
            />
          </div>
        </div>
      </div>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          aria-expanded={showMoreKpis}
          onClick={() => setShowMoreKpis((v) => !v)}
          className="text-sm text-[#a3a3a3] transition-colors hover:text-[#d4d4d4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#525252]"
        >
          {showMoreKpis ? 'Show Less' : 'Show More'}
        </button>
      </div>
    </div>
  )
}

export default KpiStrip
