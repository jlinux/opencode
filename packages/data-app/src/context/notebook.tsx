import { createContext, useContext, type ParentProps } from "solid-js"
import { createStore, produce } from "solid-js/store"

export interface NotebookCell {
  id: string
  type: "code" | "markdown"
  source: string
  outputs: CellOutput[]
  executionCount: number | null
  status: "idle" | "running" | "success" | "error"
}

export interface CellOutput {
  outputType: "stream" | "execute_result" | "display_data" | "error"
  text?: string
  data?: Record<string, string>
  ename?: string
  evalue?: string
  traceback?: string[]
}

export interface NotebookState {
  cells: NotebookCell[]
  activeCellId: string | null
  notebookPath: string | null
  dirty: boolean
}

const defaultState: NotebookState = {
  cells: [],
  activeCellId: null,
  notebookPath: null,
  dirty: false,
}

const NotebookContext = createContext<{
  state: NotebookState
  loadNotebook: (path: string, cells: NotebookCell[]) => void
  addCell: (type: "code" | "markdown", index?: number) => void
  updateCellSource: (id: string, source: string) => void
  updateCellOutput: (id: string, outputs: CellOutput[], executionCount: number | null) => void
  setCellStatus: (id: string, status: NotebookCell["status"]) => void
  removeCell: (id: string) => void
  setActiveCell: (id: string | null) => void
  clear: () => void
}>()

let cellIdCounter = 0
const nextCellId = () => `cell-${++cellIdCounter}`

export function NotebookProvider(props: ParentProps) {
  const [state, setState] = createStore<NotebookState>({ ...defaultState })

  const loadNotebook = (path: string, cells: NotebookCell[]) => {
    setState({ cells, activeCellId: cells[0]?.id ?? null, notebookPath: path, dirty: false })
  }

  const addCell = (type: "code" | "markdown", index?: number) => {
    const cell: NotebookCell = {
      id: nextCellId(),
      type,
      source: "",
      outputs: [],
      executionCount: null,
      status: "idle",
    }
    setState(
      produce((s) => {
        const idx = index ?? s.cells.length
        s.cells.splice(idx, 0, cell)
        s.activeCellId = cell.id
        s.dirty = true
      }),
    )
  }

  const updateCellSource = (id: string, source: string) => {
    setState(
      produce((s) => {
        const cell = s.cells.find((c) => c.id === id)
        if (cell) {
          cell.source = source
          s.dirty = true
        }
      }),
    )
  }

  const updateCellOutput = (id: string, outputs: CellOutput[], executionCount: number | null) => {
    setState(
      produce((s) => {
        const cell = s.cells.find((c) => c.id === id)
        if (cell) {
          cell.outputs = outputs
          cell.executionCount = executionCount
        }
      }),
    )
  }

  const setCellStatus = (id: string, status: NotebookCell["status"]) => {
    setState(
      produce((s) => {
        const cell = s.cells.find((c) => c.id === id)
        if (cell) cell.status = status
      }),
    )
  }

  const removeCell = (id: string) => {
    setState(
      produce((s) => {
        s.cells = s.cells.filter((c) => c.id !== id)
        if (s.activeCellId === id) s.activeCellId = s.cells[0]?.id ?? null
        s.dirty = true
      }),
    )
  }

  const setActiveCell = (id: string | null) => {
    setState("activeCellId", id)
  }

  const clear = () => {
    setState({ ...defaultState })
  }

  return (
    <NotebookContext.Provider
      value={{
        state,
        loadNotebook,
        addCell,
        updateCellSource,
        updateCellOutput,
        setCellStatus,
        removeCell,
        setActiveCell,
        clear,
      }}
    >
      {props.children}
    </NotebookContext.Provider>
  )
}

export function useNotebook() {
  const ctx = useContext(NotebookContext)
  if (!ctx) throw new Error("useNotebook must be used within NotebookProvider")
  return ctx
}
