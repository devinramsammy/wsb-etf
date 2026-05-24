import { useCallback, useMemo, useRef, useState } from 'react'
import { createChart, LineSeries } from 'lightweight-charts'
import type { IChartApi, ISeriesApi, SeriesType, Time } from 'lightweight-charts'
import { useQueries, useQuery } from '@tanstack/react-query'
import { fetchPriceHistory, fetchBenchmark } from '../api/client'
import type { PricePoint } from '../api/client'
import { useSubreddit } from '../context/SubredditContext'
import { getEtfLabel } from '@/lib/subreddits'
import { BENCHMARKS, DEFAULT_BENCHMARK, type BenchmarkId } from '@/lib/benchmarks'
import { computeAlignedReturn, normalizeBenchmarkToReturn } from '@/lib/benchmarkReturns'
import ReferenceRail from './ReferenceRail'

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
  benchmarkReturn: number | null
  benchmarkLabel: string
}

/* ── component ───────────────────────────────────────────────── */

function PriceChart() {
  const { subreddit } = useSubreddit()
  const etfLabel = getEtfLabel(subreddit)
  const [selectedBenchmark, setSelectedBenchmark] = useState<BenchmarkId>(DEFAULT_BENCHMARK)
  const chartRef = useRef<IChartApi | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const etfSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const benchmarkSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const [tooltip, setTooltip] = useState<TooltipData | null>(null)

  const { data: etfData, isLoading: etfLoading, error: etfError } = useQuery({
    queryKey: ['priceHistory', subreddit],
    queryFn: () => fetchPriceHistory(subreddit),
  })

  const benchmarkQueries = useQueries({
    queries: BENCHMARKS.map((benchmark) => ({
      queryKey: ['benchmark', benchmark.id],
      queryFn: () => fetchBenchmark(benchmark.id),
      staleTime: 60 * 60 * 1000,
    })),
  })

  const benchmarkDataById = useMemo(() => {
    const map = new Map<BenchmarkId, typeof benchmarkQueries[number]['data']>()
    BENCHMARKS.forEach((benchmark, index) => {
      map.set(benchmark.id, benchmarkQueries[index]?.data)
    })
    return map
  }, [benchmarkQueries])

  const selectedBenchmarkData = benchmarkDataById.get(selectedBenchmark)
  const benchmarksLoading = benchmarkQueries.some((query) => query.isLoading)
  const isLoading = etfLoading || benchmarksLoading

  const firstDate = etfData && etfData.length > 0 ? toDay(etfData[0]!.date) : ''
  const lastDate = etfData && etfData.length > 0 ? toDay(etfData[etfData.length - 1]!.date) : ''

  const etfReturn = useMemo(() => {
    if (!etfData || etfData.length === 0) return null
    const normalized = normalizeToReturn(
      etfData.map((d: PricePoint) => ({ date: toDay(d.date), price: Number(d.price) })),
    )
    return normalized.length > 0 ? normalized[normalized.length - 1]!.value : null
  }, [etfData])

  const referenceRows = useMemo(() => {
    if (!firstDate || etfReturn == null) return []

    return BENCHMARKS.map((benchmark) => {
      const benchmarkReturn = computeAlignedReturn(
        benchmarkDataById.get(benchmark.id),
        firstDate,
      )
      return {
        id: benchmark.id,
        benchmarkReturn,
        alpha: benchmarkReturn != null ? etfReturn - benchmarkReturn : null,
      }
    })
  }, [benchmarkDataById, etfReturn, firstDate])

  const selectedAlpha = referenceRows.find((row) => row.id === selectedBenchmark)?.alpha ?? null

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
      benchmarkSeriesRef.current = null

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

      const anchorDate = toDay(etfData[0]!.date)
      if (selectedBenchmarkData && selectedBenchmarkData.length > 0) {
        const benchmarkSeries = chart.addSeries(LineSeries, {
          color: '#a3a3a3',
          lineWidth: 1,
          lineStyle: 0,
          priceFormat: {
            type: 'custom',
            formatter: (v: number) => v.toFixed(2) + '%',
          },
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerRadius: 4,
          crosshairMarkerBackgroundColor: '#a3a3a3',
          crosshairMarkerBorderColor: '#111111',
          crosshairMarkerBorderWidth: 2,
        })

        const benchmarkNormalized = normalizeBenchmarkToReturn(
          selectedBenchmarkData,
          anchorDate,
        )
        benchmarkSeries.setData(benchmarkNormalized)
        benchmarkSeriesRef.current = benchmarkSeries as unknown as ISeriesApi<'Line'>
      }

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
        let etfReturnAtPoint: number | null = null
        let benchmarkReturnAtPoint: number | null = null

        const seriesData = param.seriesData as Map<
          ISeriesApi<SeriesType, Time>,
          { value?: number }
        >
        for (const [series, data] of seriesData) {
          if (data.value !== undefined) {
            if (series === etfSeriesRef.current) {
              etfReturnAtPoint = data.value
            } else if (series === benchmarkSeriesRef.current) {
              benchmarkReturnAtPoint = data.value
            }
          }
        }

        setTooltip({
          x: param.point.x,
          y: param.point.y,
          date: dateStr,
          etfReturn: etfReturnAtPoint,
          benchmarkReturn: benchmarkReturnAtPoint,
          benchmarkLabel: selectedBenchmark,
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
    [etfData, selectedBenchmark, selectedBenchmarkData],
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

  return (
    <div className="chart-panel h-full min-h-[280px]">
      <div className="chart-header shrink-0">
        <div className="flex items-baseline gap-3">
          <h2 className="chart-title">Performance</h2>
          {firstDate && lastDate && (
            <span className="font-mono text-[0.7rem] text-[#475569]">
              {formatDateLabel(firstDate)} &ndash; {formatDateLabel(lastDate)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="inline-block h-[3px] w-5 rounded-sm bg-[#4ade80]" />
            <span className="font-mono text-[0.7rem] font-semibold tracking-wide text-[#a3a3a3]">
              {etfLabel}
            </span>
            {etfReturn != null && (
              <span
                className={`font-mono text-[0.7rem] font-bold tabular-nums ${etfReturn >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}
              >
                {formatPctSigned(etfReturn)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-[3px] w-5 rounded-sm bg-[#a3a3a3]" />
            <span className="font-mono text-[0.7rem] font-semibold tracking-wide text-[#737373]">
              {selectedBenchmark}
            </span>
            {selectedAlpha != null && (
              <span
                className={`font-mono text-[0.7rem] font-bold tabular-nums ${selectedAlpha >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}
              >
                {formatPctSigned(selectedAlpha)} α
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="reference-rail-horizontal-wrap px-5 pb-3 lg:hidden">
        <ReferenceRail
          rows={referenceRows}
          selected={selectedBenchmark}
          onSelect={setSelectedBenchmark}
          layout="horizontal"
        />
      </div>

      <div className="relative flex min-h-0 flex-1">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col px-5 pb-5">
          <div
            className="chart-canvas-wrap"
            ref={chartCallbackRef}
            onMouseLeave={() => setTooltip(null)}
          />

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
                    <span className="chart-tooltip-label">{etfLabel}</span>
                    <span
                      className={`chart-tooltip-value ${tooltip.etfReturn >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}
                    >
                      {formatPctSigned(tooltip.etfReturn)}
                    </span>
                  </div>
                )}
                {tooltip.benchmarkReturn != null && (
                  <div className="chart-tooltip-row">
                    <span className="chart-tooltip-dot" style={{ background: '#a3a3a3' }} />
                    <span className="chart-tooltip-label">{tooltip.benchmarkLabel}</span>
                    <span
                      className={`chart-tooltip-value ${tooltip.benchmarkReturn >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}
                    >
                      {formatPctSigned(tooltip.benchmarkReturn)}
                    </span>
                  </div>
                )}
                {tooltip.etfReturn != null && tooltip.benchmarkReturn != null && (
                  <div className="chart-tooltip-row chart-tooltip-spread">
                    <span className="chart-tooltip-label">Alpha</span>
                    <span
                      className={`chart-tooltip-value font-bold ${(tooltip.etfReturn - tooltip.benchmarkReturn) >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}
                    >
                      {formatPctSigned(tooltip.etfReturn - tooltip.benchmarkReturn)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="reference-rail-vertical-wrap hidden shrink-0 pb-5 pr-5 lg:block">
          <ReferenceRail
            rows={referenceRows}
            selected={selectedBenchmark}
            onSelect={setSelectedBenchmark}
            layout="vertical"
          />
        </div>
      </div>
    </div>
  )
}

export default PriceChart
