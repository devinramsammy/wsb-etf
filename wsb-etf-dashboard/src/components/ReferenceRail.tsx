import { cn } from '@/lib/utils'
import { BENCHMARKS, type BenchmarkId } from '@/lib/benchmarks'

function formatPctSigned(v: number): string {
  const sign = v >= 0 ? '+' : ''
  return sign + v.toFixed(2) + '%'
}

export interface ReferenceRow {
  id: BenchmarkId
  benchmarkReturn: number | null
  alpha: number | null
}

interface ReferenceRailProps {
  rows: ReferenceRow[]
  selected: BenchmarkId
  onSelect: (id: BenchmarkId) => void
  layout?: 'vertical' | 'horizontal'
}

function ReferenceRail({
  rows,
  selected,
  onSelect,
  layout = 'vertical',
}: ReferenceRailProps) {
  const isHorizontal = layout === 'horizontal'

  return (
    <div
      className={cn(
        'reference-rail',
        isHorizontal ? 'reference-rail-horizontal' : 'reference-rail-vertical',
      )}
      role="listbox"
      aria-label="Compare ETF to benchmarks"
    >
      <div className={cn('reference-rail-list', isHorizontal && 'reference-rail-list-horizontal')}>
        {BENCHMARKS.map((benchmark) => {
          const row = rows.find((item) => item.id === benchmark.id)
          const isSelected = benchmark.id === selected
          const alpha = row?.alpha ?? null

          return (
            <button
              key={benchmark.id}
              type="button"
              role="option"
              aria-selected={isSelected}
              onClick={() => onSelect(benchmark.id)}
              className={cn(
                'reference-rail-row',
                isSelected && 'reference-rail-row-selected',
              )}
            >
              <div className="reference-rail-row-main">
                <span
                  className={cn(
                    'reference-rail-ticker',
                    isSelected && 'text-[#bbf7d0]',
                  )}
                >
                  {isSelected && (
                    <span className="reference-rail-dot" aria-hidden />
                  )}
                  {benchmark.id}
                </span>
                <span className="reference-rail-name">{benchmark.name}</span>
              </div>

              <div className="reference-rail-row-meta">
                {row?.benchmarkReturn != null && (
                  <span className="reference-rail-return tabular-nums">
                    {formatPctSigned(row.benchmarkReturn)}
                  </span>
                )}
                {alpha != null && (
                  <span
                    className={cn(
                      'reference-rail-alpha tabular-nums',
                      alpha >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]',
                    )}
                  >
                    {formatPctSigned(alpha)} α
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default ReferenceRail
