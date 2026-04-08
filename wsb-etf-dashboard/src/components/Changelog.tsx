import { useQuery } from '@tanstack/react-query'
import { fetchChangelog } from '../api/client'
import type { ChangelogEntry } from '../api/client'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type DotColor = 'green' | 'red' | 'orange'

function actionColor(action: string): DotColor {
  const a = (action || '').toLowerCase()
  if (a === 'added' || a === 'add') return 'green'
  if (a === 'removed' || a === 'remove') return 'red'
  return 'orange'
}

const dotColorClass: Record<DotColor, string> = {
  green: 'bg-primary shadow-[0_0_12px_rgba(45,212,191,0.4)]',
  red: 'bg-red-500 shadow-[0_0_10px_rgba(248,113,113,0.45)]',
  orange: 'bg-amber-500 shadow-[0_0_10px_rgba(251,191,36,0.4)]',
}

function formatPct(value: number | null | undefined): string {
  if (value == null) return ''
  const num = Number(value)
  const pct = num > 1 ? num : num * 100
  return pct.toFixed(2) + '%'
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function describeChange(entry: ChangelogEntry): string {
  const action = (entry.action || '').toLowerCase()
  const ticker = entry.ticker
  const weight = formatPct(entry.weight)

  if (action === 'added' || action === 'add') {
    return `${ticker} added at ${weight}`
  }
  if (action === 'removed' || action === 'remove') {
    return `${ticker} removed at ${weight}`
  }
  return `${ticker} rebalanced to ${weight}`
}

function Changelog() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['changelog'],
    queryFn: () => fetchChangelog(),
  })

  if (isLoading)
    return (
      <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
        Loading changelog...
      </div>
    )
  if (error)
    return (
      <div className="flex items-center justify-center py-10 text-sm text-destructive">
        Failed to load changelog: {error.message}
      </div>
    )
  if (!data || data.length === 0)
    return (
      <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
        No changes recorded yet
      </div>
    )

  return (
    <Card className="max-h-[480px] overflow-y-auto">
      <CardHeader className="pb-4">
        <CardTitle className="text-base">Recent Changes</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="m-0 list-none p-0">
          {data.map((entry: ChangelogEntry, i: number) => {
            const color = actionColor(entry.action)
            return (
              <li
                key={i}
                className="flex items-start gap-3 rounded-lg border-b border-border py-2.5 transition-colors duration-200 last:border-b-0 hover:bg-primary/[0.035]"
              >
                <span
                  className={cn(
                    'mt-1.5 size-2 shrink-0 rounded-full',
                    dotColorClass[color],
                  )}
                  aria-hidden
                />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm leading-snug text-foreground">
                    {describeChange(entry)}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {formatDate(entry.date)}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}

export default Changelog
