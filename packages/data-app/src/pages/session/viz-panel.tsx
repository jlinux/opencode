import { For, Show } from "solid-js"
import { useVisualization } from "~/context/visualization"
import { ChartContainer } from "~/components/chart/chart-container"

export function VizPanel() {
  const viz = useVisualization()

  return (
    <div class="flex flex-col gap-3 p-3">
      <Show
        when={viz.state.charts.length > 0}
        fallback={
          <div class="flex flex-col items-center justify-center gap-3 py-12">
            <svg class="size-10 text-secondary-foreground/40" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 3v18h18V3H3zm2 16V7h2v12H5zm4 0V10h2v9H9zm4 0V5h2v14h-2zm4 0V8h2v11h-2z" />
            </svg>
            <p class="text-xs text-secondary-foreground">No charts yet</p>
            <p class="text-xs text-secondary-foreground/60">
              Ask the assistant to create visualizations from your data
            </p>
          </div>
        }
      >
        <div class="mb-1 flex items-center justify-between">
          <span class="text-xs font-medium text-secondary-foreground">
            {viz.state.charts.length} chart{viz.state.charts.length !== 1 ? "s" : ""}
          </span>
        </div>
        <For each={viz.state.charts}>
          {(chart) => (
            <ChartContainer
              chart={chart}
              isActive={viz.state.activeChartId === chart.id}
              onClick={() => viz.setActiveChart(chart.id)}
              onRemove={() => viz.removeChart(chart.id)}
            />
          )}
        </For>
      </Show>
    </div>
  )
}
