import { createSignal, For } from "solid-js"

const CHART_TYPES = [
  { id: "line", label: "Line" },
  { id: "bar", label: "Bar" },
  { id: "scatter", label: "Scatter" },
  { id: "histogram", label: "Histogram" },
  { id: "box", label: "Box" },
  { id: "heatmap", label: "Heatmap" },
  { id: "pie", label: "Pie" },
  { id: "area", label: "Area" },
  { id: "violin", label: "Violin" },
] as const

export function ChartConfig(props: {
  columns: string[]
  onGenerate: (config: {
    type: string
    xColumn?: string
    yColumn?: string
    title: string
  }) => void
}) {
  const [chartType, setChartType] = createSignal("bar")
  const [xColumn, setXColumn] = createSignal("")
  const [yColumn, setYColumn] = createSignal("")
  const [title, setTitle] = createSignal("")

  const handleGenerate = () => {
    props.onGenerate({
      type: chartType(),
      xColumn: xColumn() || undefined,
      yColumn: yColumn() || undefined,
      title: title() || `${chartType()} chart`,
    })
  }

  return (
    <div class="flex flex-col gap-3 rounded-lg border border-border p-3">
      <h3 class="text-xs font-medium text-foreground">Chart Configuration</h3>

      <div class="flex flex-col gap-2">
        <label class="text-[10px] font-medium text-secondary-foreground">Chart Type</label>
        <select
          value={chartType()}
          onChange={(e) => setChartType(e.currentTarget.value)}
          class="rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground"
        >
          <For each={CHART_TYPES}>{(type) => <option value={type.id}>{type.label}</option>}</For>
        </select>
      </div>

      <div class="flex gap-2">
        <div class="flex flex-1 flex-col gap-1">
          <label class="text-[10px] font-medium text-secondary-foreground">X Column</label>
          <select
            value={xColumn()}
            onChange={(e) => setXColumn(e.currentTarget.value)}
            class="rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground"
          >
            <option value="">Auto</option>
            <For each={props.columns}>{(col) => <option value={col}>{col}</option>}</For>
          </select>
        </div>
        <div class="flex flex-1 flex-col gap-1">
          <label class="text-[10px] font-medium text-secondary-foreground">Y Column</label>
          <select
            value={yColumn()}
            onChange={(e) => setYColumn(e.currentTarget.value)}
            class="rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground"
          >
            <option value="">Auto</option>
            <For each={props.columns}>{(col) => <option value={col}>{col}</option>}</For>
          </select>
        </div>
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-[10px] font-medium text-secondary-foreground">Title</label>
        <input
          type="text"
          value={title()}
          onInput={(e) => setTitle(e.currentTarget.value)}
          placeholder="Chart title"
          class="rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-secondary-foreground/50"
        />
      </div>

      <button
        onClick={handleGenerate}
        class="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
      >
        Generate Chart
      </button>
    </div>
  )
}
