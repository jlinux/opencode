import { createContext, useContext, type ParentProps } from "solid-js"
import { createStore, produce } from "solid-js/store"

export interface DatasetInfo {
  path: string
  name: string
  size: number
  columns?: string[]
  rowCount?: number
  type: "csv" | "tsv" | "parquet" | "excel" | "unknown"
}

export interface AnalysisState {
  activeDatasets: DatasetInfo[]
  kernelStatus: "idle" | "busy" | "error" | "disconnected"
  activePanel: "notebook" | "chart" | "data" | "conversation"
  executionCount: number
}

const defaultState: AnalysisState = {
  activeDatasets: [],
  kernelStatus: "idle",
  activePanel: "conversation",
  executionCount: 0,
}

const AnalysisContext = createContext<{
  state: AnalysisState
  addDataset: (dataset: DatasetInfo) => void
  removeDataset: (path: string) => void
  setKernelStatus: (status: AnalysisState["kernelStatus"]) => void
  setActivePanel: (panel: AnalysisState["activePanel"]) => void
  incrementExecution: () => void
}>()

export function AnalysisProvider(props: ParentProps) {
  const [state, setState] = createStore<AnalysisState>({ ...defaultState })

  const addDataset = (dataset: DatasetInfo) => {
    setState(
      produce((s) => {
        if (!s.activeDatasets.find((d) => d.path === dataset.path)) {
          s.activeDatasets.push(dataset)
        }
      }),
    )
  }

  const removeDataset = (path: string) => {
    setState(
      produce((s) => {
        s.activeDatasets = s.activeDatasets.filter((d) => d.path !== path)
      }),
    )
  }

  const setKernelStatus = (status: AnalysisState["kernelStatus"]) => {
    setState("kernelStatus", status)
  }

  const setActivePanel = (panel: AnalysisState["activePanel"]) => {
    setState("activePanel", panel)
  }

  const incrementExecution = () => {
    setState("executionCount", (c) => c + 1)
  }

  return (
    <AnalysisContext.Provider
      value={{
        state,
        addDataset,
        removeDataset,
        setKernelStatus,
        setActivePanel,
        incrementExecution,
      }}
    >
      {props.children}
    </AnalysisContext.Provider>
  )
}

export function useAnalysis() {
  const ctx = useContext(AnalysisContext)
  if (!ctx) throw new Error("useAnalysis must be used within AnalysisProvider")
  return ctx
}
