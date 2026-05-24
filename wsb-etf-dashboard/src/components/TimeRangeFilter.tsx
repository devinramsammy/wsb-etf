import { cn } from '@/lib/utils'
import { TIME_RANGES, type TimeRangeId } from '@/lib/timeRange'

interface TimeRangeFilterProps {
  value: TimeRangeId
  onChange: (range: TimeRangeId) => void
}

function TimeRangeFilter({ value, onChange }: TimeRangeFilterProps) {
  return (
    <div
      className="flex gap-1"
      role="group"
      aria-label="Performance time range"
    >
      {TIME_RANGES.map((range) => {
        const selected = range.id === value
        return (
          <button
            key={range.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(range.id)}
            className={cn(
              'term-pill',
              selected && 'term-pill-active',
            )}
          >
            {range.label}
          </button>
        )
      })}
    </div>
  )
}

export default TimeRangeFilter
