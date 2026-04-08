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

function formatPct(value: number): string {
  const num = Number(value)
  // If the value is already 0-100 range, use as-is; if 0-1, multiply by 100
  const pct = num > 1 ? num : num * 100
  return pct.toFixed(2) + '%'
}

function Composition() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['composition'],
    queryFn: () => fetchComposition(),
  })

  if (isLoading)
    return (
      <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
        Loading composition...
      </div>
    )
  if (error)
    return (
      <div className="flex items-center justify-center py-10 text-sm text-destructive">
        Failed to load composition: {error.message}
      </div>
    )
  if (!data || data.length === 0)
    return (
      <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
        No composition data
      </div>
    )

  // Sort by weight descending
  const sorted = [...data].sort(
    (a: CompositionEntry, b: CompositionEntry) =>
      Number(b.percentage) - Number(a.percentage),
  )

  return (
    <Card className="max-h-[480px] overflow-y-auto">
      <CardHeader className="pb-4">
        <CardTitle className="text-base">Current Composition</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="w-9 font-mono text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                #
              </TableHead>
              <TableHead className="w-[100px] font-mono text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Ticker
              </TableHead>
              <TableHead className="w-20 text-right font-mono text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Weight
              </TableHead>
              <TableHead className="text-xs uppercase tracking-wider" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((item: CompositionEntry, i: number) => {
              const pctNum =
                Number(item.percentage) > 1
                  ? Number(item.percentage)
                  : Number(item.percentage) * 100
              return (
                <TableRow
                  key={item.ticker}
                  className="border-border/50 transition-colors duration-200 hover:bg-primary/[0.04]"
                >
                  <TableCell className="font-mono text-muted-foreground">{i + 1}</TableCell>
                  <TableCell>
                    <Badge variant="blue" className="font-mono text-[0.7rem] font-semibold tracking-wide">
                      {item.ticker}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-[0.8125rem]">
                    {formatPct(item.percentage)}
                  </TableCell>
                  <TableCell className="pl-4">
                    <div
                      className="h-1.5 min-w-0.5 rounded-full bg-gradient-to-r from-primary/90 to-primary/40"
                      style={{ width: `${Math.min(pctNum, 100)}%` }}
                    />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

export default Composition
