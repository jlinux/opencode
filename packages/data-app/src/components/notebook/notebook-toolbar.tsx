export function NotebookToolbar(props: {
  onAddCodeCell: () => void
  onAddMarkdownCell: () => void
  onRunAll: () => void
  onClearOutputs: () => void
  cellCount: number
}) {
  return (
    <div class="flex items-center gap-1 border-b border-border px-3 py-1.5">
      <button
        onClick={props.onAddCodeCell}
        class="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium text-secondary-foreground hover:bg-muted hover:text-foreground"
        title="Add code cell"
      >
        <svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Code
      </button>
      <button
        onClick={props.onAddMarkdownCell}
        class="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium text-secondary-foreground hover:bg-muted hover:text-foreground"
        title="Add markdown cell"
      >
        <svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Markdown
      </button>

      <div class="mx-1 h-4 w-px bg-border" />

      <button
        onClick={props.onRunAll}
        disabled={props.cellCount === 0}
        class="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium text-secondary-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        title="Run all cells"
      >
        <svg class="size-3" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z" />
        </svg>
        Run All
      </button>
      <button
        onClick={props.onClearOutputs}
        disabled={props.cellCount === 0}
        class="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium text-secondary-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        title="Clear all outputs"
      >
        Clear
      </button>
    </div>
  )
}
