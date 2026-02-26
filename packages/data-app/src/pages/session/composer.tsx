import { createSignal } from "solid-js"

export function Composer(props: { sessionId?: string }) {
  const [input, setInput] = createSignal("")
  const [mode, setMode] = createSignal<"chat" | "python">("chat")

  const handleSubmit = (e: Event) => {
    e.preventDefault()
    const value = input().trim()
    if (!value) return
    // TODO: integrate with SDK to send message
    console.log(`[${mode()}] Submit:`, value)
    setInput("")
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  return (
    <div class="border-t border-border p-3">
      <form onSubmit={handleSubmit} class="flex flex-col gap-2">
        {/* Mode Toggle */}
        <div class="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMode("chat")}
            class="rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
            classList={{
              "bg-primary text-primary-foreground": mode() === "chat",
              "text-secondary-foreground hover:bg-muted": mode() !== "chat",
            }}
          >
            Chat
          </button>
          <button
            type="button"
            onClick={() => setMode("python")}
            class="rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
            classList={{
              "bg-primary text-primary-foreground": mode() === "python",
              "text-secondary-foreground hover:bg-muted": mode() !== "python",
            }}
          >
            Python
          </button>
        </div>

        {/* Input Area */}
        <div class="flex items-end gap-2">
          <textarea
            value={input()}
            onInput={(e) => setInput(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            placeholder={mode() === "chat" ? "Ask about your data..." : "Enter Python code..."}
            class="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-secondary-foreground/50 focus:border-primary focus:outline-none"
            classList={{
              "font-mono text-xs": mode() === "python",
            }}
            rows={mode() === "python" ? 3 : 1}
          />
          <button
            type="submit"
            disabled={!input().trim()}
            class="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  )
}
