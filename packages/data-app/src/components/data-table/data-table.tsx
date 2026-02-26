import { createSignal, For, Show } from "solid-js"
import type { DatasetInfo } from "~/context/analysis"
import { ColumnHeader } from "./column-header"

interface TableData {
  columns: string[]
  rows: string[][]
  totalRows: number
}

export function DataTable(props: { dataset: DatasetInfo }) {
  const [data] = createSignal<TableData | null>(null)
  const [sortColumn, setSortColumn] = createSignal<string | null>(null)
  const [sortDirection, setSortDirection] = createSignal<"asc" | "desc">("asc")

  const handleSort = (column: string) => {
    if (sortColumn() === column) {
      setSortDirection(sortDirection() === "asc" ? "desc" : "asc")
    } else {
      setSortColumn(column)
      setSortDirection("asc")
    }
  }

  return (
    <div class="flex flex-col gap-2">
      {/* Dataset Info */}
      <div class="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2">
        <svg class="size-4 text-secondary-foreground" viewBox="0 0 24 24" fill="currentColor">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" />
        </svg>
        <div class="flex-1">
          <div class="text-xs font-medium text-foreground">{props.dataset.name}</div>
          <div class="text-[10px] text-secondary-foreground">
            {props.dataset.rowCount !== undefined && `${props.dataset.rowCount.toLocaleString()} rows`}
            {props.dataset.columns && ` \u00B7 ${props.dataset.columns.length} columns`}
          </div>
        </div>
      </div>

      {/* Table */}
      <Show
        when={data()}
        fallback={
          <div class="flex items-center justify-center py-8">
            <p class="text-xs text-secondary-foreground">Loading data preview...</p>
          </div>
        }
      >
        {(tableData) => (
          <div class="overflow-auto rounded-lg border border-border">
            <table class="w-full text-xs">
              <thead>
                <tr class="border-b border-border bg-muted/50">
                  <For each={tableData().columns}>
                    {(column) => (
                      <ColumnHeader
                        name={column}
                        sortDirection={sortColumn() === column ? sortDirection() : undefined}
                        onSort={() => handleSort(column)}
                      />
                    )}
                  </For>
                </tr>
              </thead>
              <tbody>
                <For each={tableData().rows}>
                  {(row) => (
                    <tr class="border-b border-border/50 hover:bg-muted/30">
                      <For each={row}>
                        {(cell) => (
                          <td class="max-w-48 truncate px-3 py-1.5 text-foreground">{cell}</td>
                        )}
                      </For>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
            <Show when={tableData().totalRows > tableData().rows.length}>
              <div class="border-t border-border bg-muted/30 px-3 py-1.5 text-center text-[10px] text-secondary-foreground">
                Showing {tableData().rows.length} of {tableData().totalRows.toLocaleString()} rows
              </div>
            </Show>
          </div>
        )}
      </Show>
    </div>
  )
}
