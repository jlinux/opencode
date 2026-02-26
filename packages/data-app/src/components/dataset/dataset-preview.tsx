import { Show } from "solid-js"
import type { DatasetInfo } from "~/context/analysis"

export function DatasetPreview(props: { dataset: DatasetInfo }) {
  const fileTypeLabel = () => {
    switch (props.dataset.type) {
      case "csv":
        return "CSV"
      case "tsv":
        return "TSV"
      case "parquet":
        return "Parquet"
      case "excel":
        return "Excel"
      default:
        return "Unknown"
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div class="rounded-lg border border-border p-3">
      <div class="flex items-center gap-3">
        <div class="flex size-8 items-center justify-center rounded bg-muted">
          <svg class="size-4 text-foreground" viewBox="0 0 24 24" fill="currentColor">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" />
          </svg>
        </div>
        <div class="flex-1">
          <div class="text-xs font-medium text-foreground">{props.dataset.name}</div>
          <div class="flex gap-2 text-[10px] text-secondary-foreground">
            <span>{fileTypeLabel()}</span>
            <span>{formatSize(props.dataset.size)}</span>
            <Show when={props.dataset.rowCount !== undefined}>
              <span>{props.dataset.rowCount!.toLocaleString()} rows</span>
            </Show>
            <Show when={props.dataset.columns}>
              <span>{props.dataset.columns!.length} cols</span>
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}
