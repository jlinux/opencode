// @refresh reload

import { render } from "solid-js/web"
import { DataAppBaseProviders, DataAppInterface } from "~/app"
import { type Platform, PlatformProvider } from "@opencode-ai/app"
import pkg from "../package.json"

const DEFAULT_SERVER_URL_KEY = "opencode-data.settings:defaultServerUrl"

const getStorage = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const setStorage = (key: string, value: string | null) => {
  try {
    if (value !== null) {
      localStorage.setItem(key, value)
      return
    }
    localStorage.removeItem(key)
  } catch {
    return
  }
}

const notify: Platform["notify"] = async (title, description) => {
  if (!("Notification" in window)) return

  const permission =
    Notification.permission === "default"
      ? await Notification.requestPermission().catch(() => "denied")
      : Notification.permission

  if (permission !== "granted") return
  if (document.visibilityState === "visible" && document.hasFocus()) return

  new Notification(title, {
    body: description ?? "",
    icon: "https://opencode.ai/favicon-96x96-v3.png",
  })
}

const platform: Platform = {
  platform: "web",
  version: pkg.version,
  openLink: (url) => window.open(url, "_blank"),
  back: () => window.history.back(),
  forward: () => window.history.forward(),
  restart: async () => window.location.reload(),
  notify,
  getDefaultServerUrl: async () => getStorage(DEFAULT_SERVER_URL_KEY),
  setDefaultServerUrl: (url) => setStorage(DEFAULT_SERVER_URL_KEY, url),
}

const defaultUrl = (() => {
  const saved = getStorage(DEFAULT_SERVER_URL_KEY)
  if (saved) return saved
  if (import.meta.env.DEV)
    return `http://${import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "localhost"}:${import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`
  return location.origin
})()

const root = document.getElementById("root")

if (root instanceof HTMLElement) {
  render(
    () => (
      <PlatformProvider value={platform}>
        <DataAppBaseProviders>
          <DataAppInterface />
        </DataAppBaseProviders>
      </PlatformProvider>
    ),
    root,
  )
}
