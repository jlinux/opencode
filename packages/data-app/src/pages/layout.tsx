import { useNavigate, useParams } from "@solidjs/router"
import { createSignal, For, type ParentProps, Show } from "solid-js"

interface SidebarSession {
  id: string
  title: string
}

interface SidebarDataset {
  name: string
  path: string
}

export default function Layout(props: ParentProps) {
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = createSignal(true)
  const [sessions] = createSignal<SidebarSession[]>([])
  const [datasets] = createSignal<SidebarDataset[]>([])
  const [activeTab, setActiveTab] = createSignal<"sessions" | "datasets">("sessions")

  return (
    <div class="flex size-full overflow-hidden">
      {/* Sidebar */}
      <Show when={sidebarOpen()}>
        <div class="flex w-64 shrink-0 flex-col border-r border-border bg-muted/30">
          {/* Sidebar Header */}
          <div class="flex items-center justify-between border-b border-border px-3 py-2">
            <button
              onClick={() => navigate("/")}
              class="text-sm font-semibold text-foreground hover:text-primary"
            >
              Data Analysis
            </button>
            <button
              onClick={() => setSidebarOpen(false)}
              class="rounded p-1 text-secondary-foreground hover:bg-muted"
              title="Hide sidebar"
            >
              <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 19l-7-7 7-7M18 19l-7-7 7-7" />
              </svg>
            </button>
          </div>

          {/* New Analysis Button */}
          <div class="p-2">
            <button
              onClick={() => navigate("/session")}
              class="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 5v14M5 12h14" />
              </svg>
              New Analysis
            </button>
          </div>

          {/* Tab Selector */}
          <div class="flex border-b border-border px-2">
            <button
              onClick={() => setActiveTab("sessions")}
              class="flex-1 border-b-2 px-2 py-2 text-xs font-medium transition-colors"
              classList={{
                "border-primary text-primary": activeTab() === "sessions",
                "border-transparent text-secondary-foreground hover:text-foreground": activeTab() !== "sessions",
              }}
            >
              Sessions
            </button>
            <button
              onClick={() => setActiveTab("datasets")}
              class="flex-1 border-b-2 px-2 py-2 text-xs font-medium transition-colors"
              classList={{
                "border-primary text-primary": activeTab() === "datasets",
                "border-transparent text-secondary-foreground hover:text-foreground": activeTab() !== "datasets",
              }}
            >
              Datasets
            </button>
          </div>

          {/* Sidebar Content */}
          <div class="flex-1 overflow-y-auto p-2">
            <Show when={activeTab() === "sessions"}>
              <Show
                when={sessions().length > 0}
                fallback={
                  <div class="px-2 py-4 text-center text-xs text-secondary-foreground">No sessions yet</div>
                }
              >
                <div class="flex flex-col gap-1">
                  <For each={sessions()}>
                    {(session) => (
                      <button
                        onClick={() => navigate(`/session/${session.id}`)}
                        class="rounded-md px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-muted"
                      >
                        {session.title}
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </Show>

            <Show when={activeTab() === "datasets"}>
              <Show
                when={datasets().length > 0}
                fallback={
                  <div class="px-2 py-4 text-center text-xs text-secondary-foreground">No datasets loaded</div>
                }
              >
                <div class="flex flex-col gap-1">
                  <For each={datasets()}>
                    {(dataset) => (
                      <div class="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-muted">
                        <svg class="size-3.5 shrink-0 text-secondary-foreground" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" />
                        </svg>
                        <span class="truncate">{dataset.name}</span>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </div>
        </div>
      </Show>

      {/* Toggle sidebar button when closed */}
      <Show when={!sidebarOpen()}>
        <button
          onClick={() => setSidebarOpen(true)}
          class="absolute left-2 top-2 z-10 rounded p-1 text-secondary-foreground hover:bg-muted"
          title="Show sidebar"
        >
          <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
        </button>
      </Show>

      {/* Main Content */}
      <div class="flex flex-1 flex-col overflow-hidden">{props.children}</div>
    </div>
  )
}
