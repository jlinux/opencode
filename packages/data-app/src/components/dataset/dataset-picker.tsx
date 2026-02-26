import { createSignal } from "solid-js"

export function DatasetPicker() {
  const [dragOver, setDragOver] = createSignal(false)

  const handleFileSelect = async () => {
    // TODO: integrate with platform file picker or server file API
    console.log("Open file picker")
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files = e.dataTransfer?.files
    if (!files?.length) return
    // TODO: handle file upload
    console.log("Dropped files:", Array.from(files).map((f) => f.name))
  }

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }

  return (
    <div
      class="rounded-lg border-2 border-dashed p-4 text-center transition-colors"
      classList={{
        "border-primary bg-primary/5": dragOver(),
        "border-border": !dragOver(),
      }}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
    >
      <button
        onClick={handleFileSelect}
        class="flex w-full flex-col items-center gap-2"
      >
        <svg class="size-6 text-secondary-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
        </svg>
        <div>
          <p class="text-xs font-medium text-foreground">Drop a file or click to browse</p>
          <p class="text-[10px] text-secondary-foreground">CSV, TSV, Parquet, Excel</p>
        </div>
      </button>
    </div>
  )
}
