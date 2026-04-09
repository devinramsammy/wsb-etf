import { useRef, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchComposition } from '../api/client'
import type { CompositionEntry } from '../api/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

const DONUT_COLORS = [
  '#2dd4bf', '#60a5fa', '#a78bfa', '#f472b6', '#fbbf24',
  '#34d399', '#f87171', '#818cf8', '#fb923c', '#94a3b8',
]

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

const COMPOSITION_DONUT = {
  size: 180,
  outerR: 82,
  innerR: 56,
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
    const size = COMPOSITION_DONUT.size
    canvas.width = size * dpr
    canvas.height = size * dpr
    canvas.style.width = size + 'px'
    canvas.style.height = size + 'px'
    ctx.scale(dpr, dpr)

    const cx = size / 2
    const cy = size / 2
    const outerR = COMPOSITION_DONUT.outerR
    const innerR = COMPOSITION_DONUT.innerR
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
    ctx.fillStyle = '#e2e8f0'
    ctx.font = "600 13px 'IBM Plex Mono', monospace"
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${items.length}`, cx, cy - 7)
    ctx.fillStyle = '#6b7f94'
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
    const { size, outerR, innerR } = COMPOSITION_DONUT
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
          className="pointer-events-none absolute z-20 flex w-max flex-col gap-1 rounded-sm border border-border bg-popover px-2.5 py-2 font-mono text-[0.75rem] leading-none text-popover-foreground shadow-md"
          style={{ left: tip.x, top: tip.y }}
        >
          <div className="font-semibold uppercase tracking-[0.08em]">
            {tip.ticker}
          </div>
          <div className="tabular-nums text-muted-foreground">{tip.pctLabel}</div>
        </div>
      )}
    </div>
  )
}

function Composition() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['composition'],
    queryFn: () => fetchComposition(),
  })

  if (isLoading)
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10 text-sm text-muted-foreground">
          Loading composition...
        </CardContent>
      </Card>
    )
  if (error)
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10 text-sm text-destructive">
          Failed to load composition: {error.message}
        </CardContent>
      </Card>
    )
  if (!data || data.length === 0)
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10 text-sm text-muted-foreground">
          No composition data
        </CardContent>
      </Card>
    )

  const sorted = [...data].sort(
    (a: CompositionEntry, b: CompositionEntry) =>
      Number(b.percentage) - Number(a.percentage),
  )

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Allocation</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <DonutChart items={sorted} />

        <div className="max-h-[340px] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="w-8 font-mono text-[0.6rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  #
                </TableHead>
                <TableHead className="font-mono text-[0.6rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Ticker
                </TableHead>
                <TableHead className="text-right font-mono text-[0.6rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Weight
                </TableHead>
                <TableHead className="text-right font-mono text-[0.6rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Price
                </TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((item: CompositionEntry, i: number) => {
                const pctNum = toPct(item.percentage)
                return (
                  <TableRow
                    key={item.ticker}
                    className="border-border/40 transition-colors duration-150 hover:bg-primary/[0.035]"
                  >
                    <TableCell className="py-2 font-mono text-xs text-muted-foreground">
                      {i + 1}
                    </TableCell>
                    <TableCell className="py-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block size-2 rounded-full"
                          style={{ backgroundColor: DONUT_COLORS[i % DONUT_COLORS.length] }}
                        />
                        <Badge variant="blue" className="font-mono text-[0.65rem] font-semibold tracking-wide">
                          {item.ticker}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="py-2 text-right font-mono text-[0.78rem] tabular-nums">
                      {formatPct(item.percentage)}
                    </TableCell>
                    <TableCell className="py-2 text-right font-mono text-[0.78rem] tabular-nums text-muted-foreground">
                      {item.price ? formatCurrency(item.price) : '—'}
                    </TableCell>
                    <TableCell className="py-2 pl-3">
                      <div
                        className="h-1 min-w-0.5 rounded-full bg-gradient-to-r from-primary/80 to-primary/30"
                        style={{ width: `${Math.min(pctNum, 100)}%` }}
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

export default Composition
