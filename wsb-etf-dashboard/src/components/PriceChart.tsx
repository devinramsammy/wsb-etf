import { useCallback, useRef, useState } from 'react'
import { createChart, LineSeries } from 'lightweight-charts'
import type { IChartApi, ISeriesApi, SeriesType, Time } from 'lightweight-charts'
import { useQuery } from '@tanstack/react-query'
import { fetchPriceHistory, fetchBenchmark } from '../api/client'
import type { PricePoint, BenchmarkPoint } from '../api/client'

/* ── helpers ─────────────────────────────────────────────────── */

function toDay(dateStr: string): string {
  return dateStr.slice(0, 10)
}

function normalizeToReturn(data: { date: string; price: number }[]): { time: string; value: number }[] {
  if (data.length === 0) return []
  const base = data[0]!.price
  if (base === 0) return []
  return data.map((d) => ({
    time: toDay(d.date),
    value: ((d.price - base) / base) * 100,
  }))
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function formatPctSigned(v: number): string {
  const sign = v >= 0 ? '+' : ''
  return sign + v.toFixed(2) + '%'
}

/* ── tooltip state ───────────────────────────────────────────── */

interface TooltipData {
  x: number
  y: number
  date: string
  etfReturn: number | null
  vooReturn: number | null
}

/* ── component ───────────────────────────────────────────────── */

function PriceChart() {
  const chartRef = useRef<IChartApi | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const etfSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const vooSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const [tooltip, setTooltip] = useState<TooltipData | null>(null)

  const { data: etfData, isLoading: etfLoading, error: etfError } = useQuery({
    queryKey: ['priceHistory'],
    queryFn: () => fetchPriceHistory(),
  })

  const { data: vooData, isLoading: vooLoading } = useQuery({
    queryKey: ['benchmark'],
    queryFn: () => fetchBenchmark(),
  })

  const isLoading = etfLoading || vooLoading

  const chartCallbackRef = useCallback(
    (container: HTMLDivElement | null) => {
      if (observerRef.current) {
        observerRef.current.disconnect()
        observerRef.current = null
      }
      if (chartRef.current) {
        chartRef.current.remove()
        chartRef.current = null
      }
      etfSeriesRef.current = null
      vooSeriesRef.current = null

      if (!container || !etfData || etfData.length === 0) return

      const initialW = container.clientWidth
      const initialH = Math.max(Math.round(container.clientHeight), 200)

      const chart = createChart(container, {
        width: initialW,
        height: initialH,
        layout: {
          background: { color: 'transparent' },
          textColor: '#525252',
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11,
        },
        grid: {
          vertLines: { color: 'rgba(255,255,255,0.03)' },
          horzLines: { color: 'rgba(255,255,255,0.03)' },
        },
        crosshair: {
          mode: 0,
          vertLine: {
            color: 'rgba(74, 222, 128, 0.2)',
            style: 2,
            width: 1,
            labelBackgroundColor: '#1a1a1a',
          },
          horzLine: {
            color: 'rgba(74, 222, 128, 0.15)',
            style: 2,
            width: 1,
            labelBackgroundColor: '#1a1a1a',
          },
        },
        rightPriceScale: {
          borderColor: 'rgba(255,255,255,0.04)',
          scaleMargins: { top: 0.08, bottom: 0.08 },
        },
        timeScale: {
          borderColor: 'rgba(255,255,255,0.04)',
          timeVisible: false,
        },
      })

      // WSB ETF line — green accent
      const etfSeries = chart.addSeries(LineSeries, {
        color: '#4ade80',
        lineWidth: 2,
        priceFormat: {
          type: 'custom',
          formatter: (v: number) => v.toFixed(2) + '%',
        },
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerRadius: 5,
        crosshairMarkerBackgroundColor: '#4ade80',
        crosshairMarkerBorderColor: '#111111',
        crosshairMarkerBorderWidth: 2,
      })

      const etfNormalized = normalizeToReturn(
        etfData.map((d: PricePoint) => ({ date: toDay(d.date), price: Number(d.price) })),
      )
      etfSeries.setData(etfNormalized)
      etfSeriesRef.current = etfSeries as unknown as ISeriesApi<'Line'>

      // VOO benchmark — muted
      if (vooData && vooData.length > 0) {
        const vooSeries = chart.addSeries(LineSeries, {
          color: '#525252',
          lineWidth: 1,
          lineStyle: 0,
          priceFormat: {
            type: 'custom',
            formatter: (v: number) => v.toFixed(2) + '%',
          },
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerRadius: 4,
          crosshairMarkerBackgroundColor: '#525252',
          crosshairMarkerBorderColor: '#111111',
          crosshairMarkerBorderWidth: 2,
        })

        const firstEtfDate = toDay(etfData[0]!.date)
        const vooSorted = [...vooData].sort(
          (a: BenchmarkPoint, b: BenchmarkPoint) => a.date.localeCompare(b.date),
        )

        let vooBase: BenchmarkPoint | null = null
        for (const p of vooSorted) {
          if (p.date <= firstEtfDate) vooBase = p
          if (p.date >= firstEtfDate) break
        }
        if (!vooBase && vooSorted.length > 0) vooBase = vooSorted[0]!

        if (vooBase) {
          const basePrice = vooBase.price
          const vooFiltered = vooSorted.filter(
            (d: BenchmarkPoint) => d.date >= firstEtfDate,
          )
          const vooNormalized = vooFiltered.map((d: BenchmarkPoint) => ({
            time: toDay(d.date),
            value: ((d.price - basePrice) / basePrice) * 100,
          }))

          const dateMap = new Map<string, { time: string; value: number }>()
          for (const point of vooNormalized) {
            dateMap.set(point.time, point)
          }
          const deduped = Array.from(dateMap.values()).sort((a, b) =>
            a.time.localeCompare(b.time),
          )

          vooSeries.setData(deduped)
          vooSeriesRef.current = vooSeries as unknown as ISeriesApi<'Line'>
        }
      }

      // Crosshair tooltip
      chart.subscribeCrosshairMove((param) => {
        if (
          !param.time ||
          !param.point ||
          param.point.x < 0 ||
          param.point.y < 0
        ) {
          setTooltip(null)
          return
        }

        const dateStr = param.time as string

        let etfReturn: number | null = null
        let vooReturn: number | null = null

        const seriesData = param.seriesData as Map<
          ISeriesApi<SeriesType, Time>,
          { value?: number }
        >
        for (const [series, data] of seriesData) {
          if (data.value !== undefined) {
            if (series === etfSeriesRef.current) {
              etfReturn = data.value
            } else if (series === vooSeriesRef.current) {
              vooReturn = data.value
            }
          }
        }

        setTooltip({
          x: param.point.x,
          y: param.point.y,
          date: dateStr,
          etfReturn,
          vooReturn,
        })
      })

      chart.timeScale().fitContent()
      chartRef.current = chart

      const applySize = () => {
        const w = Math.max(Math.round(container.clientWidth), 1)
        const h = Math.max(Math.round(container.clientHeight), 200)
        chart.applyOptions({ width: w, height: h })
      }

      requestAnimationFrame(() => requestAnimationFrame(applySize))

      const resizeObserver = new ResizeObserver(() => {
        applySize()
      })
      resizeObserver.observe(container)
      observerRef.current = resizeObserver
    },
    [etfData, vooData],
  )

  if (isLoading)
    return (
      <div className="chart-panel h-full min-h-[280px]">
        <div className="flex min-h-[200px] flex-1 items-center justify-center py-12">
          <p className="animate-pulse font-mono text-sm text-[#475569]">
            Loading performance data...
          </p>
        </div>
      </div>
    )
  if (etfError)
    return (
      <div className="chart-panel h-full min-h-[280px]">
        <div className="flex flex-1 items-center justify-center py-10 font-mono text-sm text-red-400">
          Failed to load prices: {etfError.message}
        </div>
      </div>
    )
  if (!etfData || etfData.length === 0)
    return (
      <div className="chart-panel h-full min-h-[280px]">
        <div className="flex flex-1 items-center justify-center py-10 font-mono text-sm text-[#475569]">
          No price data available
        </div>
      </div>
    )

  // Compute latest returns for the header
  const etfNorm = normalizeToReturn(
    etfData.map((d: PricePoint) => ({ date: toDay(d.date), price: Number(d.price) })),
  )
  const latestEtf = etfNorm.length > 0 ? etfNorm[etfNorm.length - 1]!.value : null
  const firstDate = etfData.length > 0 ? toDay(etfData[0]!.date) : ''
  const lastDate = etfData.length > 0 ? toDay(etfData[etfData.length - 1]!.date) : ''

  return (
    <div className="chart-panel h-full min-h-[280px]">
      {/* Header */}
      <div className="chart-header shrink-0">
        <div className="flex items-baseline gap-3">
          <h2 className="chart-title">Performance</h2>
          {firstDate && lastDate && (
            <span className="font-mono text-[0.7rem] text-[#475569]">
              {formatDateLabel(firstDate)} &ndash; {formatDateLabel(lastDate)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="inline-block h-[3px] w-5 rounded-sm bg-[#4ade80]" />
            <span className="font-mono text-[0.7rem] font-semibold tracking-wide text-[#a3a3a3]">
              WSB ETF
            </span>
            {latestEtf != null && (
              <span
                className={`font-mono text-[0.7rem] font-bold tabular-nums ${latestEtf >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}
              >
                {formatPctSigned(latestEtf)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-[3px] w-5 rounded-sm bg-[#525252]" />
            <span className="font-mono text-[0.7rem] font-semibold tracking-wide text-[#525252]">
              VOO
            </span>
          </div>
        </div>
      </div>

      {/* Chart area — flex-1 so the panel matches About height on wide layouts */}
      <div className="relative flex min-h-0 flex-1 flex-col px-5 pb-5">
        <div
          className="chart-canvas-wrap"
          ref={chartCallbackRef}
          onMouseLeave={() => setTooltip(null)}
        />

        {/* Tooltip */}
        {tooltip && (
          <div
            className="chart-tooltip"
            style={{
              left: Math.min(tooltip.x + 16, (chartRef.current as unknown as { _private__width?: number })?._private__width ? 300 : 9999),
              top: tooltip.y - 10,
              transform: tooltip.x > 500 ? 'translate(-110%, -10%)' : 'translate(0, -10%)',
            }}
          >
            <div className="chart-tooltip-date">{formatDateLabel(tooltip.date)}</div>
            <div className="chart-tooltip-rows">
              {tooltip.etfReturn != null && (
                <div className="chart-tooltip-row">
                  <span className="chart-tooltip-dot" style={{ background: '#4ade80' }} />
                  <span className="chart-tooltip-label">WSB ETF</span>
                  <span
                    className={`chart-tooltip-value ${tooltip.etfReturn >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}
                  >
                    {formatPctSigned(tooltip.etfReturn)}
                  </span>
                </div>
              )}
              {tooltip.vooReturn != null && (
                <div className="chart-tooltip-row">
                  <span className="chart-tooltip-dot" style={{ background: '#525252' }} />
                  <span className="chart-tooltip-label">VOO</span>
                  <span
                    className={`chart-tooltip-value ${tooltip.vooReturn >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}
                  >
                    {formatPctSigned(tooltip.vooReturn)}
                  </span>
                </div>
              )}
              {tooltip.etfReturn != null && tooltip.vooReturn != null && (
                <div className="chart-tooltip-row chart-tooltip-spread">
                  <span className="chart-tooltip-label">Spread</span>
                  <span
                    className={`chart-tooltip-value font-bold ${(tooltip.etfReturn - tooltip.vooReturn) >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}
                  >
                    {formatPctSigned(tooltip.etfReturn - tooltip.vooReturn)}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default PriceChart
