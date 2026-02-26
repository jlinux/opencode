import { Show } from "solid-js"
import { useAnalysis } from "~/context/analysis"
import { DataTable } from "~/components/data-table/data-table"
import { DatasetPicker } from "~/components/dataset/dataset-picker"

export function DataTablePanel() {
  const analysis = useAnalysis()

  return (
    <div class="flex flex-col gap-3 p-3">
      <DatasetPicker />

      <Show
        when={analysis.state.activeDatasets.length > 0}
        fallback={
          <div class="flex flex-col items-center justify-center gap-3 py-12">
            <svg class="size-10 text-secondary-foreground/40" viewBox="0 0 24 24" fill="currentColor">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM6 20V4h7v5h5v11H6z" />
            </svg>
            <p class="text-xs text-secondary-foreground">No datasets loaded</p>
            <p class="text-xs text-secondary-foreground/60">Load a CSV, Parquet, or Excel file to preview data</p>
          </div>
        }
      >
        <DataTable dataset={analysis.state.activeDatasets[0]} />
      </Show>
    </div>
  )
}
