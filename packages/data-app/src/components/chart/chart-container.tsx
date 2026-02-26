import { Show } from "solid-js"
import type { ChartConfig } from "~/context/visualization"

export function ChartContainer(props: {
  chart: ChartConfig
  isActive: boolean
  onClick: () => void
  onRemove: () => void
}) {
  return (
    <div
      class="group cursor-pointer rounded-lg border transition-colors"
      classList={{
        "border-primary": props.isActive,
        "border-border hover:border-primary/50": !props.isActive,
      }}
      onClick={props.onClick}
    >
      {/* Chart Header */}
      <div class="flex items-center justify-between px-3 py-2">
        <div class="flex items-center gap-2">
          <span class="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300">
            {props.chart.type}
          </span>
          <span class="text-xs font-medium text-foreground">{props.chart.title}</span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            props.onRemove()
          }}
          class="rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900"
          title="Remove chart"
        >
          <svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Chart Image */}
      <Show when={props.chart.imagePath}>
        <div class="border-t border-border/50 p-2">
          <img
            src={props.chart.imagePath}
            alt={props.chart.title}
            class="w-full rounded"
            loading="lazy"
          />
        </div>
      </Show>

      {/* Chart Metadata */}
      <Show when={props.chart.dataSource}>
        <div class="border-t border-border/50 px-3 py-1.5">
          <span class="text-[10px] text-secondary-foreground">Source: {props.chart.dataSource}</span>
        </div>
      </Show>
    </div>
  )
}
