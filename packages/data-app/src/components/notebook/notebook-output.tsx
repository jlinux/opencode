import { For, Match, Switch } from "solid-js"
import type { CellOutput } from "~/context/notebook"

export function NotebookOutput(props: { outputs: CellOutput[] }) {
  return (
    <div class="flex flex-col gap-1.5">
      <For each={props.outputs}>
        {(output) => (
          <Switch>
            <Match when={output.outputType === "stream"}>
              <pre class="max-h-48 overflow-auto whitespace-pre-wrap text-xs text-foreground">{output.text}</pre>
            </Match>

            <Match when={output.outputType === "execute_result"}>
              <div class="max-h-48 overflow-auto">
                {output.data?.["text/html"] ? (
                  <div class="text-xs" innerHTML={output.data["text/html"]} />
                ) : output.data?.["image/png"] ? (
                  <img
                    src={`data:image/png;base64,${output.data["image/png"]}`}
                    class="max-w-full rounded"
                    alt="Output"
                  />
                ) : (
                  <pre class="whitespace-pre-wrap text-xs text-foreground">{output.data?.["text/plain"] ?? ""}</pre>
                )}
              </div>
            </Match>

            <Match when={output.outputType === "display_data"}>
              <div class="max-h-48 overflow-auto">
                {output.data?.["image/png"] ? (
                  <img
                    src={`data:image/png;base64,${output.data["image/png"]}`}
                    class="max-w-full rounded"
                    alt="Display"
                  />
                ) : output.data?.["text/html"] ? (
                  <div class="text-xs" innerHTML={output.data["text/html"]} />
                ) : (
                  <pre class="whitespace-pre-wrap text-xs text-foreground">{output.data?.["text/plain"] ?? ""}</pre>
                )}
              </div>
            </Match>

            <Match when={output.outputType === "error"}>
              <div class="rounded bg-red-50 p-2 dark:bg-red-950">
                <div class="text-xs font-medium text-red-700 dark:text-red-300">
                  {output.ename}: {output.evalue}
                </div>
                {output.traceback && (
                  <pre class="mt-1 max-h-32 overflow-auto text-[10px] text-red-600 dark:text-red-400">
                    {output.traceback.join("\n")}
                  </pre>
                )}
              </div>
            </Match>
          </Switch>
        )}
      </For>
    </div>
  )
}
