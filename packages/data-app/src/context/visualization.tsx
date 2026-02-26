import { createContext, useContext, type ParentProps } from "solid-js"
import { createStore, produce } from "solid-js/store"

export interface ChartConfig {
  id: string
  type: "line" | "bar" | "scatter" | "histogram" | "box" | "heatmap" | "pie" | "area" | "violin"
  title: string
  imagePath?: string
  dataSource?: string
  xColumn?: string
  yColumn?: string
  createdAt: number
}

export interface VisualizationState {
  charts: ChartConfig[]
  activeChartId: string | null
}

const defaultState: VisualizationState = {
  charts: [],
  activeChartId: null,
}

const VisualizationContext = createContext<{
  state: VisualizationState
  addChart: (chart: ChartConfig) => void
  removeChart: (id: string) => void
  setActiveChart: (id: string | null) => void
  clear: () => void
}>()

export function VisualizationProvider(props: ParentProps) {
  const [state, setState] = createStore<VisualizationState>({ ...defaultState })

  const addChart = (chart: ChartConfig) => {
    setState(
      produce((s) => {
        s.charts.push(chart)
        s.activeChartId = chart.id
      }),
    )
  }

  const removeChart = (id: string) => {
    setState(
      produce((s) => {
        s.charts = s.charts.filter((c) => c.id !== id)
        if (s.activeChartId === id) s.activeChartId = s.charts[0]?.id ?? null
      }),
    )
  }

  const setActiveChart = (id: string | null) => {
    setState("activeChartId", id)
  }

  const clear = () => {
    setState({ ...defaultState })
  }

  return (
    <VisualizationContext.Provider value={{ state, addChart, removeChart, setActiveChart, clear }}>
      {props.children}
    </VisualizationContext.Provider>
  )
}

export function useVisualization() {
  const ctx = useContext(VisualizationContext)
  if (!ctx) throw new Error("useVisualization must be used within VisualizationProvider")
  return ctx
}
