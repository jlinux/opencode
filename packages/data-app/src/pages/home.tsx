import { useNavigate } from "@solidjs/router"
import { createSignal, For } from "solid-js"

interface RecentSession {
  id: string
  title: string
  updatedAt: string
  dataFiles: string[]
}

export default function Home() {
  const navigate = useNavigate()
  const [sessions] = createSignal<RecentSession[]>([])

  const startNewAnalysis = () => {
    navigate("/session")
  }

  return (
    <div class="flex size-full items-center justify-center">
      <div class="flex max-w-2xl flex-col items-center gap-8 px-6">
        <div class="flex flex-col items-center gap-3">
          <h1 class="text-3xl font-bold text-foreground">Data Analysis</h1>
          <p class="text-center text-sm text-secondary-foreground">
            Analyze datasets, create visualizations, and explore data with AI assistance.
            <br />
            Powered by Python, pandas, and matplotlib.
          </p>
        </div>

        <div class="flex gap-3">
          <button
            onClick={startNewAnalysis}
            class="rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            New Analysis
          </button>
        </div>

        <div class="w-full">
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FeatureCard
              title="Data Exploration"
              description="Load CSV, Parquet, or Excel files and explore with pandas"
              icon="table"
            />
            <FeatureCard
              title="Visualization"
              description="Create charts with matplotlib and seaborn"
              icon="chart"
            />
            <FeatureCard
              title="Python Execution"
              description="Run Python scripts with full library access"
              icon="code"
            />
            <FeatureCard
              title="Jupyter Notebooks"
              description="Execute and manage Jupyter notebook cells"
              icon="notebook"
            />
          </div>
        </div>

        {sessions().length > 0 && (
          <div class="w-full">
            <h2 class="mb-3 text-sm font-medium text-secondary-foreground">Recent Sessions</h2>
            <div class="flex flex-col gap-2">
              <For each={sessions()}>
                {(session) => (
                  <button
                    onClick={() => navigate(`/session/${session.id}`)}
                    class="flex items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted"
                  >
                    <div class="flex-1">
                      <div class="text-sm font-medium text-foreground">{session.title}</div>
                      <div class="text-xs text-secondary-foreground">{session.updatedAt}</div>
                    </div>
                    {session.dataFiles.length > 0 && (
                      <div class="text-xs text-secondary-foreground">
                        {session.dataFiles.length} file{session.dataFiles.length > 1 ? "s" : ""}
                      </div>
                    )}
                  </button>
                )}
              </For>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function FeatureCard(props: { title: string; description: string; icon: string }) {
  const icons: Record<string, string> = {
    table: "M3 3h18v18H3V3zm2 4v4h6V7H5zm8 0v4h6V7h-6zm-8 6v4h6v-4H5zm8 0v4h6v-4h-6z",
    chart: "M3 3v18h18V3H3zm2 16V7h2v12H5zm4 0V10h2v9H9zm4 0V5h2v14h-2zm4 0V8h2v11h-2z",
    code: "M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z",
    notebook:
      "M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zm0 2v12h16V6H4zm2 2h12v2H6V8zm0 4h12v2H6v-2zm0 4h8v2H6v-2z",
  }

  return (
    <div class="flex gap-3 rounded-lg border border-border p-4 transition-colors hover:bg-muted/50">
      <div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
        <svg class="size-5 text-foreground" viewBox="0 0 24 24" fill="currentColor">
          <path d={icons[props.icon] ?? icons.code} />
        </svg>
      </div>
      <div>
        <div class="text-sm font-medium text-foreground">{props.title}</div>
        <div class="text-xs text-secondary-foreground">{props.description}</div>
      </div>
    </div>
  )
}
