import { useParams } from "@solidjs/router"
import { createSignal, For, Show } from "solid-js"
import { useAnalysis } from "~/context/analysis"
import { ConversationPanel } from "~/pages/session/conversation-panel"
import { NotebookPanel } from "~/pages/session/notebook-panel"
import { VizPanel } from "~/pages/session/viz-panel"
import { DataTablePanel } from "~/pages/session/data-table-panel"
import { Composer } from "~/pages/session/composer"

type SidePanelTab = "notebook" | "chart" | "data"

export default function Session() {
  const params = useParams()
  const analysis = useAnalysis()
  const [activeSideTab, setActiveSideTab] = createSignal<SidePanelTab>("notebook")
  const [sidePanelOpen, setSidePanelOpen] = createSignal(true)
  const [panelWidth, setPanelWidth] = createSignal(480)

  const sideTabs: { id: SidePanelTab; label: string }[] = [
    { id: "notebook", label: "Notebook" },
    { id: "chart", label: "Charts" },
    { id: "data", label: "Data" },
  ]

  return (
    <div class="flex size-full flex-col overflow-hidden">
      {/* Header */}
      <div class="flex items-center justify-between border-b border-border px-4 py-2">
        <div class="flex items-center gap-3">
          <h2 class="text-sm font-medium text-foreground">{params.id ? `Session ${params.id}` : "New Analysis"}</h2>
          <Show when={analysis.state.kernelStatus !== "idle"}>
            <span
              class="rounded-full px-2 py-0.5 text-xs"
              classList={{
                "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200":
                  analysis.state.kernelStatus === "busy",
                "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200":
                  analysis.state.kernelStatus === "error",
                "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200":
                  analysis.state.kernelStatus === "disconnected",
              }}
            >
              {analysis.state.kernelStatus}
            </span>
          </Show>
        </div>
        <div class="flex items-center gap-2">
          <button
            onClick={() => setSidePanelOpen(!sidePanelOpen())}
            class="rounded p-1.5 text-secondary-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={sidePanelOpen() ? "Hide side panel" : "Show side panel"}
          >
            <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M15 3v18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div class="flex flex-1 overflow-hidden">
        {/* Conversation Panel */}
        <div class="flex flex-1 flex-col overflow-hidden">
          <div class="flex-1 overflow-y-auto">
            <ConversationPanel sessionId={params.id} />
          </div>
          <Composer sessionId={params.id} />
        </div>

        {/* Side Panel */}
        <Show when={sidePanelOpen()}>
          <div class="flex flex-col border-l border-border" style={{ width: `${panelWidth()}px` }}>
            {/* Side Panel Tabs */}
            <div class="flex border-b border-border">
              <For each={sideTabs}>
                {(tab) => (
                  <button
                    onClick={() => setActiveSideTab(tab.id)}
                    class="flex-1 px-3 py-2 text-xs font-medium transition-colors"
                    classList={{
                      "border-b-2 border-primary text-primary": activeSideTab() === tab.id,
                      "text-secondary-foreground hover:text-foreground": activeSideTab() !== tab.id,
                    }}
                  >
                    {tab.label}
                  </button>
                )}
              </For>
            </div>

            {/* Side Panel Content */}
            <div class="flex-1 overflow-y-auto">
              <Show when={activeSideTab() === "notebook"}>
                <NotebookPanel />
              </Show>
              <Show when={activeSideTab() === "chart"}>
                <VizPanel />
              </Show>
              <Show when={activeSideTab() === "data"}>
                <DataTablePanel />
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </div>
  )
}
