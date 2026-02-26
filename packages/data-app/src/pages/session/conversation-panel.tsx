import { createSignal, For, Show } from "solid-js"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  toolCalls?: ToolCall[]
  timestamp: number
}

interface ToolCall {
  id: string
  name: string
  status: "running" | "success" | "error"
  input: Record<string, unknown>
  output?: string
  metadata?: Record<string, unknown>
}

export function ConversationPanel(props: { sessionId?: string }) {
  const [messages] = createSignal<Message[]>([])

  return (
    <div class="flex flex-col gap-4 p-4">
      <Show
        when={messages().length > 0}
        fallback={
          <div class="flex flex-col items-center justify-center gap-3 py-16">
            <svg class="size-12 text-secondary-foreground/40" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z" />
            </svg>
            <p class="text-sm text-secondary-foreground">Start a conversation to analyze your data</p>
            <p class="text-xs text-secondary-foreground/60">
              Try: "Load sales.csv and show me the top 10 products by revenue"
            </p>
          </div>
        }
      >
        <For each={messages()}>
          {(message) => (
            <div
              class="flex gap-3"
              classList={{
                "justify-end": message.role === "user",
              }}
            >
              <div
                class="max-w-[80%] rounded-lg px-4 py-3"
                classList={{
                  "bg-primary text-primary-foreground": message.role === "user",
                  "bg-muted text-foreground": message.role === "assistant",
                }}
              >
                <div class="whitespace-pre-wrap text-sm">{message.content}</div>
                <Show when={message.toolCalls && message.toolCalls.length > 0}>
                  <div class="mt-2 flex flex-col gap-1.5">
                    <For each={message.toolCalls}>
                      {(tool) => (
                        <div class="rounded border border-border/50 bg-background/50 px-3 py-2">
                          <div class="flex items-center gap-2">
                            <span
                              class="size-2 rounded-full"
                              classList={{
                                "bg-yellow-500": tool.status === "running",
                                "bg-green-500": tool.status === "success",
                                "bg-red-500": tool.status === "error",
                              }}
                            />
                            <span class="text-xs font-medium text-foreground">{tool.name}</span>
                          </div>
                          <Show when={tool.output}>
                            <pre class="mt-1 max-h-32 overflow-auto text-xs text-secondary-foreground">
                              {tool.output}
                            </pre>
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </div>
          )}
        </For>
      </Show>
    </div>
  )
}
