import { For, Show } from "solid-js"
import { useNotebook } from "~/context/notebook"
import { NotebookCell } from "~/components/notebook/notebook-cell"

export function NotebookPanel() {
  const notebook = useNotebook()

  return (
    <div class="flex flex-col gap-2 p-3">
      <Show
        when={notebook.state.cells.length > 0}
        fallback={
          <div class="flex flex-col items-center justify-center gap-3 py-12">
            <svg class="size-10 text-secondary-foreground/40" viewBox="0 0 24 24" fill="currentColor">
              <path d="M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zm0 2v12h16V6H4zm2 2h12v2H6V8zm0 4h12v2H6v-2zm0 4h8v2H6v-2z" />
            </svg>
            <p class="text-xs text-secondary-foreground">No notebook cells yet</p>
            <p class="text-xs text-secondary-foreground/60">Cells will appear here when you run analysis code</p>
          </div>
        }
      >
        <div class="mb-2 flex items-center justify-between">
          <span class="text-xs font-medium text-secondary-foreground">
            {notebook.state.cells.length} cell{notebook.state.cells.length !== 1 ? "s" : ""}
          </span>
          <button
            onClick={() => notebook.addCell("code")}
            class="rounded px-2 py-1 text-xs text-secondary-foreground hover:bg-muted hover:text-foreground"
          >
            + Add Cell
          </button>
        </div>
        <For each={notebook.state.cells}>
          {(cell) => (
            <NotebookCell
              cell={cell}
              isActive={notebook.state.activeCellId === cell.id}
              onSelect={() => notebook.setActiveCell(cell.id)}
              onUpdateSource={(source) => notebook.updateCellSource(cell.id, source)}
              onDelete={() => notebook.removeCell(cell.id)}
            />
          )}
        </For>
      </Show>
    </div>
  )
}
