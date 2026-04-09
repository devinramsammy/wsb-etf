import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchChangelog, fetchChangelogMeta } from '../api/client'
import type { ChangelogEntry } from '../api/client'
import { cn } from '@/lib/utils'
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

function formatPct(value: number | null | undefined): string {
  if (value == null) return ''
  const num = Number(value)
  const pct = num > 1 ? num : num * 100
  return pct.toFixed(2) + '%'
}

type ActionVariant = 'green' | 'red' | 'orange'

function actionVariant(action: string): ActionVariant {
  const a = (action || '').toLowerCase()
  if (a === 'added' || a === 'add') return 'green'
  if (a === 'removed' || a === 'remove') return 'red'
  return 'orange'
}

function actionLabel(action: string): string {
  const a = (action || '').toLowerCase()
  if (a === 'added' || a === 'add') return 'Added'
  if (a === 'removed' || a === 'remove') return 'Removed'
  return 'Rebalanced'
}

function Changelog() {
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  const { data: meta, isLoading: metaLoading, error: metaError } = useQuery({
    queryKey: ['changelog-meta'],
    queryFn: fetchChangelogMeta,
  })

  const effectiveDate = selectedDate ?? meta?.dates[0] ?? null

  const { data: rows, isLoading: rowsLoading, error: rowsError } = useQuery({
    queryKey: ['changelog', effectiveDate],
    queryFn: () => fetchChangelog(effectiveDate!),
    enabled: !!effectiveDate,
  })

  if (metaLoading)
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10 text-sm text-muted-foreground">
          Loading changelog…
        </CardContent>
      </Card>
    )
  if (metaError)
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10 text-sm text-destructive">
          Failed to load changelog: {(metaError as Error).message}
        </CardContent>
      </Card>
    )
  if (!meta || meta.dates.length === 0)
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10 text-sm text-muted-foreground">
          No changes recorded yet
        </CardContent>
      </Card>
    )

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Rebalance Log</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5">
          {meta.dates.map((date) => (
            <button
              key={date}
              type="button"
              onClick={() => setSelectedDate(date)}
              className={cn(
                'rounded-md px-2.5 py-1 font-mono text-[0.65rem] font-medium tracking-wide transition-colors',
                effectiveDate === date
                  ? 'bg-primary/20 text-primary'
                  : 'bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground',
              )}
            >
              {formatDate(date)}
            </button>
          ))}
        </div>

        {rowsError && (
          <p className="text-sm text-destructive">
            Failed to load entries: {(rowsError as Error).message}
          </p>
        )}

        <div className="max-h-[400px] overflow-y-auto">
          {rowsLoading && (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading entries…</p>
          )}
          {!rowsLoading && rows && (
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="font-mono text-[0.6rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    Date
                  </TableHead>
                  <TableHead className="font-mono text-[0.6rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    Action
                  </TableHead>
                  <TableHead className="font-mono text-[0.6rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    Ticker
                  </TableHead>
                  <TableHead className="text-right font-mono text-[0.6rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    Weight
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      No rows for this date
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((entry: ChangelogEntry, i: number) => (
                    <TableRow
                      key={`${entry.date}-${entry.ticker}-${entry.action}-${i}`}
                      className="border-border/40 transition-colors duration-150 hover:bg-primary/[0.035]"
                    >
                      <TableCell className="py-2 font-mono text-xs text-muted-foreground">
                        {formatDate(entry.date)}
                      </TableCell>
                      <TableCell className="py-2">
                        <Badge
                          variant={actionVariant(entry.action)}
                          className="font-mono text-[0.6rem] font-semibold uppercase tracking-wider"
                        >
                          {actionLabel(entry.action)}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2">
                        <Badge variant="blue" className="font-mono text-[0.65rem] font-semibold tracking-wide">
                          {entry.ticker}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2 text-right font-mono text-[0.78rem] tabular-nums">
                        {formatPct(entry.weight)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export default Changelog
