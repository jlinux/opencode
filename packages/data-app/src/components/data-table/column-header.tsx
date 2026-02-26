import { Show } from "solid-js"

export function ColumnHeader(props: {
  name: string
  sortDirection?: "asc" | "desc"
  onSort: () => void
}) {
  return (
    <th
      class="cursor-pointer select-none whitespace-nowrap px-3 py-2 text-left font-medium text-foreground hover:bg-muted"
      onClick={props.onSort}
    >
      <div class="flex items-center gap-1">
        <span>{props.name}</span>
        <Show when={props.sortDirection}>
          <svg class="size-3 text-primary" viewBox="0 0 24 24" fill="currentColor">
            {props.sortDirection === "asc" ? <path d="M7 14l5-5 5 5H7z" /> : <path d="M7 10l5 5 5-5H7z" />}
          </svg>
        </Show>
      </div>
    </th>
  )
}
