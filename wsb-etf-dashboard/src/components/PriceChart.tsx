import { useCallback, useRef } from 'react'
import { createChart, AreaSeries } from 'lightweight-charts'
import type { IChartApi } from 'lightweight-charts'
import { useQuery } from '@tanstack/react-query'
import { fetchPriceHistory } from '../api/client'
import type { PricePoint } from '../api/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

function PriceChart() {
  const chartRef = useRef<IChartApi | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['priceHistory'],
    queryFn: () => fetchPriceHistory(),
  })

  // Callback ref: called when the DOM node mounts/unmounts.
  // Also re-called whenever `data` changes because we use it as
  // part of the key (by including data in the dependency array of useCallback).
  const chartCallbackRef = useCallback(
    (container: HTMLDivElement | null) => {
      // Cleanup previous chart if any
      if (observerRef.current) {
        observerRef.current.disconnect()
        observerRef.current = null
      }
      if (chartRef.current) {
        chartRef.current.remove()
        chartRef.current = null
      }

      if (!container || !data || data.length === 0) return

      const chart = createChart(container, {
        width: container.clientWidth,
        height: 400,
        layout: {
          background: { color: '#151e2b' },
          textColor: '#8da3b8',
        },
        grid: {
          vertLines: { color: '#1f2d3f' },
          horzLines: { color: '#1f2d3f' },
        },
        crosshair: {
          mode: 0, // Normal
        },
        rightPriceScale: {
          borderColor: '#2a3d52',
        },
        timeScale: {
          borderColor: '#2a3d52',
          timeVisible: false,
        },
      })

      const series = chart.addSeries(AreaSeries, {
        topColor: 'rgba(45, 212, 191, 0.38)',
        bottomColor: 'rgba(45, 212, 191, 0.02)',
        lineColor: '#2dd4bf',
        lineWidth: 2,
      })

      // Expect data shaped as [{ date: "YYYY-MM-DD", price: number }, ...]
      const chartData = data.map((d: PricePoint) => ({
        time: d.date,
        value: Number(d.price),
      }))

      series.setData(chartData)
      chart.timeScale().fitContent()
      chartRef.current = chart

      // Resize observer
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width } = entry.contentRect
          chart.applyOptions({ width })
        }
      })
      resizeObserver.observe(container)
      observerRef.current = resizeObserver
    },
    [data],
  )

  if (isLoading)
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-white/[0.07] bg-card/50 py-12">
        <p className="animate-pulse font-sans text-sm text-muted-foreground">
          Loading price data...
        </p>
      </div>
    )
  if (error)
    return (
      <div className="flex items-center justify-center py-10 text-sm text-destructive">
        Failed to load prices: {error.message}
      </div>
    )
  if (!data || data.length === 0)
    return (
      <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
        No price data available
      </div>
    )

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base">ETF Price History</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className="w-full overflow-hidden rounded-lg ring-1 ring-white/[0.04]"
          ref={chartCallbackRef}
        />
      </CardContent>
    </Card>
  )
}

export default PriceChart
