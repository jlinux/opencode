import { createSignal, Match, Show, Switch } from "solid-js"
import { render } from "solid-js/web"
import { open as openDialog } from "@tauri-apps/plugin-dialog"
import { openUrl } from "@tauri-apps/plugin-opener"
import { sendNotification } from "@tauri-apps/plugin-notification"
import { relaunch } from "@tauri-apps/plugin-process"
import { Store } from "@tauri-apps/plugin-store"
import { fetch as tauriFetch } from "@tauri-apps/plugin-http"
import { invoke } from "@tauri-apps/api/core"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { type Platform, PlatformProvider } from "@opencode-ai/app"
import { DataAppBaseProviders, DataAppInterface } from "@opencode-ai/data-app"
import pkg from "../package.json"

const DEFAULT_SERVER_URL_KEY = "defaultServerUrl"

interface ServerReadyData {
  url: string
  username: string | null
  password: string | null
  is_sidecar: boolean
}

type InitStep = { phase: "server_waiting" } | { phase: "sqlite_waiting" } | { phase: "done" }

export default function App() {
  const [status, setStatus] = createSignal<"loading" | "ready" | "error">("loading")
  const [serverData, setServerData] = createSignal<ServerReadyData | null>(null)
  const [error, setError] = createSignal("")
  const [initPhase, setInitPhase] = createSignal("Connecting to server...")

  const initialize = async () => {
    try {
      const data = await invoke<ServerReadyData>("await_initialization", {
        events: {
          onEvent: (step: InitStep) => {
            switch (step.phase) {
              case "server_waiting":
                setInitPhase("Waiting for server...")
                break
              case "sqlite_waiting":
                setInitPhase("Setting up database...")
                break
              case "done":
                setInitPhase("Ready")
                break
            }
          },
        },
      })
      setServerData(data)
      setStatus("ready")

      // Show main window
      const window = getCurrentWebviewWindow()
      await window.show()
    } catch (e) {
      setError(String(e))
      setStatus("error")
    }
  }

  initialize()

  return (
    <Switch>
      <Match when={status() === "loading"}>
        <div class="flex h-screen w-screen items-center justify-center bg-black">
          <div class="flex flex-col items-center gap-4">
            <div class="size-12 animate-spin rounded-full border-4 border-gray-700 border-t-white" />
            <p class="text-sm text-gray-400">{initPhase()}</p>
          </div>
        </div>
      </Match>

      <Match when={status() === "error"}>
        <div class="flex h-screen w-screen items-center justify-center bg-black">
          <div class="flex flex-col items-center gap-4 px-8">
            <p class="text-sm text-red-400">Failed to connect to server</p>
            <p class="max-w-md text-center text-xs text-gray-500">{error()}</p>
            <button
              onClick={() => {
                setStatus("loading")
                initialize()
              }}
              class="rounded-lg bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20"
            >
              Retry
            </button>
          </div>
        </div>
      </Match>

      <Match when={status() === "ready" && serverData()}>
        <DataDesktopApp serverData={serverData()!} />
      </Match>
    </Switch>
  )
}

function DataDesktopApp(props: { serverData: ServerReadyData }) {
  const storePromise = Store.load("data-desktop-settings.json")

  const platform: Platform = {
    platform: "desktop",
    version: pkg.version,

    openLink: (url) => {
      openUrl(url)
    },

    back: () => {
      window.history.back()
    },

    forward: () => {
      window.history.forward()
    },

    restart: async () => {
      await relaunch()
    },

    notify: async (title, description) => {
      sendNotification({ title, body: description ?? "" })
    },

    openDirectoryPickerDialog: async (opts) => {
      const result = await openDialog({
        directory: true,
        multiple: opts?.multiple ?? false,
        title: opts?.title,
      })
      return result
    },

    openFilePickerDialog: async (opts) => {
      const result = await openDialog({
        directory: false,
        multiple: opts?.multiple ?? false,
        title: opts?.title,
        filters: [
          { name: "Data Files", extensions: ["csv", "tsv", "parquet", "xlsx", "xls", "json"] },
          { name: "All Files", extensions: ["*"] },
        ],
      })
      return result
    },

    saveFilePickerDialog: async (opts) => {
      const result = await openDialog({
        directory: false,
        title: opts?.title,
        defaultPath: opts?.defaultPath,
      })
      if (Array.isArray(result)) return result[0] ?? null
      return result
    },

    getDefaultServerUrl: async () => {
      const store = await storePromise
      return (await store.get<string>(DEFAULT_SERVER_URL_KEY)) ?? null
    },

    setDefaultServerUrl: async (url) => {
      const store = await storePromise
      if (url) {
        await store.set(DEFAULT_SERVER_URL_KEY, url)
      } else {
        await store.delete(DEFAULT_SERVER_URL_KEY)
      }
      await store.save()
    },

    fetch: tauriFetch,
  }

  return (
    <PlatformProvider value={platform}>
      <DataAppBaseProviders>
        <DataAppInterface />
      </DataAppBaseProviders>
    </PlatformProvider>
  )
}
