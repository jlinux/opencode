import { Show } from "solid-js"
import type { NotebookCell as NotebookCellType } from "~/context/notebook"
import { NotebookOutput } from "./notebook-output"

export function NotebookCell(props: {
  cell: NotebookCellType
  isActive: boolean
  onSelect: () => void
  onUpdateSource: (source: string) => void
  onDelete: () => void
}) {
  return (
    <div
      class="group rounded-lg border transition-colors"
      classList={{
        "border-primary bg-primary/5": props.isActive,
        "border-border hover:border-primary/50": !props.isActive,
      }}
      onClick={props.onSelect}
    >
      {/* Cell Header */}
      <div class="flex items-center justify-between px-3 py-1.5">
        <div class="flex items-center gap-2">
          <span
            class="rounded px-1.5 py-0.5 text-[10px] font-medium"
            classList={{
              "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300": props.cell.type === "code",
              "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300": props.cell.type === "markdown",
            }}
          >
            {props.cell.type}
          </span>
          <Show when={props.cell.executionCount !== null}>
            <span class="text-[10px] text-secondary-foreground">In [{props.cell.executionCount}]</span>
          </Show>
          <Show when={props.cell.status === "running"}>
            <span class="text-[10px] text-yellow-600 dark:text-yellow-400">running...</span>
          </Show>
        </div>
        <div class="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation()
              props.onDelete()
            }}
            class="rounded p-1 text-secondary-foreground hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900"
            title="Delete cell"
          >
            <svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Cell Source */}
      <div class="border-t border-border/50 px-3 py-2">
        <Show
          when={props.isActive}
          fallback={
            <pre class="max-h-24 overflow-hidden text-xs text-foreground">
              <code>{props.cell.source || "\u00A0"}</code>
            </pre>
          }
        >
          <textarea
            value={props.cell.source}
            onInput={(e) => props.onUpdateSource(e.currentTarget.value)}
            class="w-full resize-none rounded border-0 bg-transparent p-0 font-mono text-xs text-foreground focus:outline-none"
            rows={Math.max(1, props.cell.source.split("\n").length)}
            spellcheck={false}
          />
        </Show>
      </div>

      {/* Cell Outputs */}
      <Show when={props.cell.outputs.length > 0}>
        <div class="border-t border-border/50 px-3 py-2">
          <NotebookOutput outputs={props.cell.outputs} />
        </div>
      </Show>
    </div>
  )
}
