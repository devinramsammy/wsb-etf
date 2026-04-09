import { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchComposition, fetchChangelog, fetchChangelogMeta } from '../api/client'
import type { ChangelogEntry, CompositionEntry } from '../api/client'
import { cn } from '@/lib/utils'
import KpiStrip from './KpiStrip'

/* ── helpers ─────────────────────────────────────────────────── */

function toPct(value: number): number {
  return Number(value) > 1 ? Number(value) : Number(value) * 100
}

function formatPct(value: number): string {
  return toPct(value).toFixed(2) + '%'
}

function formatCurrency(value: number): string {
  return '$' + Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function toDay(dateStr: string): string {
  return dateStr.slice(0, 10)
}

function formatDate(dateStr: string): string {
  const d = new Date(toDay(dateStr) + 'T00:00:00Z')
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function formatPctSigned(value: number | null | undefined): string {
  if (value == null) return ''
  const num = Number(value)
  const pct = num > 1 ? num : num * 100
  return pct.toFixed(2) + '%'
}

type ActionKind = 'added' | 'removed' | 'rebalanced'

function normalizeAction(action: string): ActionKind {
  const a = (action || '').toLowerCase()
  if (a === 'added' || a === 'add') return 'added'
  if (a === 'removed' || a === 'remove') return 'removed'
  return 'rebalanced'
}

const ACTION_LABELS: Record<ActionKind, string> = {
  added: 'ADD',
  removed: 'RMV',
  rebalanced: 'RBL',
}

/** Ledger row — left rail (Tailwind) */
const ACTION_ROW_RAIL: Record<ActionKind, string> = {
  added: 'border-l-[3px] border-l-[#4ade80]',
  removed: 'border-l-[3px] border-l-[#f87171]',
  rebalanced: 'border-l-[3px] border-l-[#eab308]',
}

const ACTION_BADGE: Record<ActionKind, string> = {
  added:
    'bg-[#4ade80]/[0.11] text-[#86efac] ring-1 ring-[#4ade80]/25 shadow-[0_0_12px_-4px_rgba(74,222,128,0.45)]',
  removed:
    'bg-[#f87171]/[0.11] text-[#fecaca] ring-1 ring-[#f87171]/25 shadow-[0_0_12px_-4px_rgba(248,113,113,0.4)]',
  rebalanced:
    'bg-[#eab308]/[0.11] text-[#fef9c3] ring-1 ring-[#eab308]/30 shadow-[0_0_12px_-4px_rgba(234,179,8,0.35)]',
}

const DONUT_COLORS = [
  '#2dd4bf', '#60a5fa', '#a78bfa', '#f472b6', '#fbbf24',
  '#34d399', '#f87171', '#818cf8', '#fb923c', '#94a3b8',
]

/* ── Donut chart ─────────────────────────────────────────────── */

const INSIGHT_DONUT = {
  size: 160,
  outerR: 72,
  innerR: 50,
} as const

function findDonutSegmentIndex(
  mx: number,
  my: number,
  items: CompositionEntry[],
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
): number | null {
  const dx = mx - cx
  const dy = my - cy
  const dist = Math.hypot(dx, dy)
  if (dist < innerR || dist > outerR) return null
  const total = items.reduce((s, i) => s + toPct(i.percentage), 0)
  if (total <= 0) return null
  const angleFromTop =
    (Math.atan2(dy, dx) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI)
  let acc = 0
  for (let idx = 0; idx < items.length; idx++) {
    const sweep = (toPct(items[idx]!.percentage) / total) * 2 * Math.PI
    const isLast = idx === items.length - 1
    if (
      angleFromTop >= acc - 1e-9 &&
      (isLast ? angleFromTop <= acc + sweep + 1e-9 : angleFromTop < acc + sweep - 1e-9)
    ) {
      return idx
    }
    acc += sweep
  }
  return null
}

function DonutChart({ items }: { items: CompositionEntry[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<{
    x: number
    y: number
    ticker: string
    pctLabel: string
  } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || items.length === 0) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const size = INSIGHT_DONUT.size
    canvas.width = size * dpr
    canvas.height = size * dpr
    canvas.style.width = size + 'px'
    canvas.style.height = size + 'px'
    ctx.scale(dpr, dpr)

    const cx = size / 2
    const cy = size / 2
    const outerR = INSIGHT_DONUT.outerR
    const innerR = INSIGHT_DONUT.innerR
    const total = items.reduce((s, i) => s + toPct(i.percentage), 0)
    let startAngle = -Math.PI / 2

    ctx.clearRect(0, 0, size, size)

    items.forEach((item, idx) => {
      const pct = toPct(item.percentage)
      const sweep = (pct / total) * Math.PI * 2
      const endAngle = startAngle + sweep

      ctx.beginPath()
      ctx.arc(cx, cy, outerR, startAngle, endAngle)
      ctx.arc(cx, cy, innerR, endAngle, startAngle, true)
      ctx.closePath()
      ctx.fillStyle = DONUT_COLORS[idx % DONUT_COLORS.length]!
      ctx.fill()

      startAngle = endAngle
    })

    // Center label
    ctx.fillStyle = '#b0bec5'
    ctx.font = "600 13px 'IBM Plex Mono', monospace"
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${items.length}`, cx, cy - 7)
    ctx.fillStyle = '#607d8b'
    ctx.font = "500 9px 'IBM Plex Mono', monospace"
    ctx.fillText('HOLDINGS', cx, cy + 8)
  }, [items])

  function onCanvasMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap || items.length === 0) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const { size, outerR, innerR } = INSIGHT_DONUT
    const cx = size / 2
    const cy = size / 2
    const idx = findDonutSegmentIndex(mx, my, items, cx, cy, outerR, innerR)
    const wr = wrap.getBoundingClientRect()
    if (idx == null) {
      setTip(null)
      return
    }
    const item = items[idx]!
    setTip({
      x: e.clientX - wr.left + 12,
      y: e.clientY - wr.top + 12,
      ticker: item.ticker,
      pctLabel: formatPct(item.percentage),
    })
  }

  return (
    <div ref={wrapRef} className="relative mx-auto w-fit">
      <canvas
        ref={canvasRef}
        className="mx-auto block cursor-crosshair"
        onMouseMove={onCanvasMove}
        onMouseLeave={() => setTip(null)}
      />
      {tip && (
        <div
          className="pointer-events-none absolute z-20 flex w-max flex-col gap-1 rounded-sm border border-white/[0.08] bg-[#111111] px-2.5 py-2 font-mono text-[0.75rem] leading-none shadow-[0_2px_12px_rgba(0,0,0,0.55)]"
          style={{ left: tip.x, top: tip.y }}
        >
          <div className="font-semibold uppercase tracking-[0.08em] text-term-cyan">
            {tip.ticker}
          </div>
          <div className="tabular-nums text-term-dim">{tip.pctLabel}</div>
        </div>
      )}
    </div>
  )
}

/* ── Tab definitions ─────────────────────────────────────────── */

type Tab = 'holdings' | 'rebalance'

const TABS: { id: Tab; label: string }[] = [
  { id: 'holdings', label: 'Holdings' },
  { id: 'rebalance', label: 'Rebalance Log' },
]

/* ── Holdings tab ────────────────────────────────────────────── */

function HoldingsTab({ data }: { data: CompositionEntry[] }) {
  const sorted = useMemo(
    () => [...data].sort((a, b) => Number(b.percentage) - Number(a.percentage)),
    [data],
  )

  return (
    <div className="flex flex-col gap-5">
      <DonutChart items={sorted} />
      <div className="term-table-wrap">
        <table className="term-table">
          <thead>
            <tr>
              <th className="w-8">#</th>
              <th>Ticker</th>
              <th className="text-right">Weight</th>
              <th className="text-right">Price</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((item, i) => (
                <tr key={item.ticker}>
                  <td className="text-term-dim">{i + 1}</td>
                  <td>
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="inline-block size-2 rounded-full"
                        style={{ backgroundColor: DONUT_COLORS[i % DONUT_COLORS.length] }}
                      />
                      <span className="text-term-cyan font-semibold">{item.ticker}</span>
                    </span>
                  </td>
                  <td className="text-right tabular-nums">{formatPct(item.percentage)}</td>
                  <td className="text-right tabular-nums text-term-dim">
                    {item.price ? formatCurrency(item.price) : '—'}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ── Rebalance log tab ───────────────────────────────────────── */

function RebalanceTab() {
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [ledgerQuery, setLedgerQuery] = useState('')

  const { data: meta, isLoading: metaLoading, error: metaError } = useQuery({
    queryKey: ['changelog-meta'],
    queryFn: fetchChangelogMeta,
  })

  const effectiveDate = selectedDate ?? meta?.dates[0] ?? null

  const { data: entries, isLoading: entriesLoading, error: entriesError } = useQuery({
    queryKey: ['changelog', effectiveDate],
    queryFn: () => fetchChangelog(effectiveDate!),
    enabled: !!effectiveDate,
  })

  useEffect(() => {
    setLedgerQuery('')
  }, [effectiveDate])

  const filteredEntries = useMemo(() => {
    if (!entries) return []
    const q = ledgerQuery.trim().toLowerCase()
    if (!q) return entries
    return entries.filter((e: ChangelogEntry) => {
      const ticker = e.ticker.toLowerCase()
      const kind = normalizeAction(e.action)
      const leg = ACTION_LABELS[kind].toLowerCase()
      return (
        ticker.includes(q) ||
        leg.includes(q) ||
        e.action.toLowerCase().includes(q)
      )
    })
  }, [entries, ledgerQuery])

  if (metaLoading) {
    return (
      <p className="py-8 text-center text-sm text-term-dim">Loading rebalance dates…</p>
    )
  }

  if (metaError) {
    return (
      <p className="py-8 text-center text-sm text-term-red">
        Failed to load rebalance dates: {(metaError as Error).message}
      </p>
    )
  }

  if (!meta || meta.dates.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-term-dim">No rebalance entries yet</p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto pb-0.5 [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.25)_transparent]">
        <div className="flex w-max min-w-full gap-2 pr-1">
          {meta.dates.map((date) => {
            const active = effectiveDate === date
            return (
              <button
                key={date}
                type="button"
                onClick={() => setSelectedDate(date)}
                className={cn(
                  'shrink-0 snap-start rounded-lg border px-3 py-2 font-mono text-[0.7rem] font-medium tracking-[0.06em] transition-all duration-200',
                  active
                    ? 'border-[#4ade80]/45 bg-[#4ade80]/[0.12] text-[#bbf7d0] shadow-[0_0_24px_-10px_rgba(74,222,128,0.55)]'
                    : 'border-white/[0.07] bg-black/30 text-slate-500 hover:border-white/12 hover:bg-white/[0.04] hover:text-slate-400',
                )}
              >
                {formatDate(date)}
              </button>
            )
          })}
        </div>
      </div>

      {entriesError && (
        <p className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 font-mono text-[0.75rem] text-red-400">
          Failed to load entries: {(entriesError as Error).message}
        </p>
      )}

      <div
        className={cn(
          'relative overflow-hidden rounded-xl border border-white/[0.08]',
          'bg-[linear-gradient(165deg,rgba(255,255,255,0.042)_0%,transparent_42%),#080808]',
          'shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_18px_48px_-28px_rgba(0,0,0,0.85)]',
        )}
      >
        <div
          className="pointer-events-none absolute -left-6 top-1/2 h-40 w-40 -translate-y-1/2 rounded-full bg-[#4ade80]/[0.035] blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -right-10 bottom-0 h-32 w-32 rounded-full bg-cyan-400/[0.04] blur-3xl"
          aria-hidden
        />

        <header className="relative flex flex-col gap-3 border-b border-white/[0.06] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <p className="font-mono text-[0.58rem] font-semibold uppercase tracking-[0.24em] text-slate-600">
              Rebalance ledger
            </p>
            <p className="mt-1 font-[family-name:var(--font-display)] text-xl font-medium tracking-[-0.03em] text-slate-50">
              {effectiveDate ? formatDate(effectiveDate) : '—'}
            </p>
          </div>
          <div className="relative w-full sm:w-72 sm:shrink-0">
            <label htmlFor="ledger-search" className="sr-only">
              Filter by symbol or leg type
            </label>
            <span
              className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 font-mono text-[0.7rem] text-slate-500"
              aria-hidden
            >
              /
            </span>
            <input
              id="ledger-search"
              type="search"
              autoComplete="off"
              value={ledgerQuery}
              onChange={(e) => setLedgerQuery(e.target.value)}
              disabled={entriesLoading || !entries}
              placeholder="Search symbol, leg…"
              className={cn(
                'w-full rounded-lg border border-white/[0.1] bg-black/50 py-2 pl-8 pr-3 font-mono text-[0.75rem] text-slate-200',
                'placeholder:text-slate-600',
                'outline-none transition-[border-color,box-shadow] duration-150',
                'focus:border-[#4ade80]/40 focus:ring-2 focus:ring-[#4ade80]/15',
                'disabled:cursor-not-allowed disabled:opacity-45',
              )}
            />
          </div>
        </header>

        {/* ~6 body rows visible (sticky thead + row ky/padding in this table) */}
        <div className="relative h-[20.5rem] overflow-auto [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.28)_transparent]">
          {entriesLoading && (
            <table className="w-full border-collapse font-mono">
              <tbody className="divide-y divide-white/[0.04]">
                {Array.from({ length: 7 }).map((_, i) => (
                  <tr key={i}>
                    <td className="px-4 py-3" colSpan={4}>
                      <div className="flex items-center gap-3">
                        <div className="h-3.5 w-6 animate-pulse rounded-sm bg-white/[0.06]" />
                        <div className="h-3.5 w-12 animate-pulse rounded-sm bg-white/[0.06]" />
                        <div className="h-3.5 flex-1 animate-pulse rounded-sm bg-white/[0.05]" />
                        <div className="h-3.5 w-14 animate-pulse rounded-sm bg-white/[0.06]" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {!entriesLoading && entries && (
            <table className="w-full border-collapse font-mono text-[0.8125rem]">
              <thead>
                <tr className="sticky top-0 z-[1] border-b border-white/[0.06] bg-[#080808]/90 backdrop-blur-md">
                  <th
                    scope="col"
                    className="w-11 px-3 py-3 text-left text-[0.58rem] font-semibold uppercase tracking-[0.2em] text-slate-600"
                  >
                    #
                  </th>
                  <th
                    scope="col"
                    className="px-2 py-3 text-left text-[0.58rem] font-semibold uppercase tracking-[0.2em] text-slate-600"
                  >
                    Leg
                  </th>
                  <th
                    scope="col"
                    className="px-2 py-3 text-left text-[0.58rem] font-semibold uppercase tracking-[0.2em] text-slate-600"
                  >
                    Symbol
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-right text-[0.58rem] font-semibold uppercase tracking-[0.2em] text-slate-600"
                  >
                    Target
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-14 text-center font-mono text-[0.8rem] text-slate-600"
                    >
                      No fills for this session.
                    </td>
                  </tr>
                ) : filteredEntries.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-14 text-center font-mono text-[0.8rem] text-slate-600"
                    >
                      No matches for “{ledgerQuery.trim()}”.
                    </td>
                  </tr>
                ) : (
                  filteredEntries.map((entry, i) => {
                    const kind = normalizeAction(entry.action)
                    return (
                      <tr
                        key={`${entry.date}-${entry.ticker}-${entry.action}-${i}`}
                        className={cn(
                          'animate-design-in opacity-0 border-b border-white/[0.035] transition-[background-color] duration-150 hover:bg-white/[0.025]',
                          ACTION_ROW_RAIL[kind],
                        )}
                        style={{ animationDelay: `${55 + i * 38}ms` }}
                      >
                        <td className="px-3 py-3.5 align-middle tabular-nums text-[0.72rem] text-slate-600">
                          {String(i + 1).padStart(2, '0')}
                        </td>
                        <td className="px-2 py-3.5 align-middle">
                          <span
                            className={cn(
                              'inline-flex rounded-md px-2 py-0.5 font-mono text-[0.62rem] font-bold tracking-[0.14em]',
                              ACTION_BADGE[kind],
                            )}
                          >
                            {ACTION_LABELS[kind]}
                          </span>
                        </td>
                        <td className="px-2 py-3.5 align-middle">
                          <span className="inline-flex rounded-md border border-cyan-400/20 bg-cyan-400/[0.06] px-2 py-0.5 font-mono text-[0.78rem] font-semibold tracking-wide text-cyan-200">
                            {entry.ticker}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 align-middle text-right tabular-nums tracking-tight text-slate-300">
                          <span className="inline-block min-w-[4.75rem] rounded-md border border-white/[0.05] bg-white/[0.03] px-2 py-1 text-slate-100">
                            {formatPctSigned(entry.weight)}
                          </span>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Main component ──────────────────────────────────────────── */

function PortfolioInsight() {
  const [activeTab, setActiveTab] = useState<Tab>('holdings')
  const tabRowRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({
    holdings: null,
    rebalance: null,
  })
  const [tabUnderline, setTabUnderline] = useState({ left: 0, width: 0 })

  const updateTabUnderline = useCallback(() => {
    const row = tabRowRef.current
    const btn = tabRefs.current[activeTab]
    if (!row || !btn) return
    const inset = 8
    setTabUnderline({
      left: btn.offsetLeft + inset,
      width: Math.max(0, btn.offsetWidth - inset * 2),
    })
  }, [activeTab])

  useLayoutEffect(() => {
    updateTabUnderline()
  }, [updateTabUnderline])

  useEffect(() => {
    const row = tabRowRef.current
    if (!row || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => updateTabUnderline())
    ro.observe(row)
    window.addEventListener('resize', updateTabUnderline)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', updateTabUnderline)
    }
  }, [updateTabUnderline])

  const { data: composition, isLoading: compLoading, error: compError } = useQuery({
    queryKey: ['composition'],
    queryFn: () => fetchComposition(),
  })

  const isLoading = compLoading
  const error = compError

  return (
    <div className="term-panel">
      <div className="term-panel-header">
        <h2 className="term-panel-title">Portfolio Insight</h2>
      </div>

      <div className="border-b border-white/[0.06] px-6 pb-5 pt-1">
        <h3 className="mb-3 font-mono text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[#525252]">
          Key performance
        </h3>
        <KpiStrip />
      </div>

      <div className="term-tab-bar">
        <div ref={tabRowRef} className="relative inline-flex shrink-0">
          <span
            aria-hidden
            className="pointer-events-none absolute -bottom-px left-0 h-0.5 rounded-sm bg-[#4ade80] transition-[left,width] duration-300 ease-out motion-reduce:transition-none"
            style={{ left: tabUnderline.left, width: tabUnderline.width }}
          />
          {TABS.map((tab) => (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[tab.id] = el
              }}
              onClick={() => setActiveTab(tab.id)}
              className={cn('term-tab', activeTab === tab.id && 'term-tab-active')}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="term-panel-body">
        {activeTab === 'holdings' && isLoading && (
          <div className="flex items-center justify-center py-16 text-sm text-term-dim">
            Loading portfolio data...
          </div>
        )}

        {activeTab === 'holdings' && !isLoading && error && (
          <div className="flex items-center justify-center py-16 text-sm text-term-red">
            Failed to load: {(error as Error).message}
          </div>
        )}

        {activeTab === 'holdings' && !isLoading && !error && composition && composition.length > 0 && (
          <HoldingsTab data={composition} />
        )}
        {activeTab === 'holdings' && !isLoading && !error && (!composition || composition.length === 0) && (
          <p className="py-8 text-center text-sm text-term-dim">No holdings data</p>
        )}

        {activeTab === 'rebalance' && <RebalanceTab />}
      </div>
    </div>
  )
}

export default PortfolioInsight
