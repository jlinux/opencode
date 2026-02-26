import "~/index.css"
import { Code } from "@opencode-ai/ui/code"
import { I18nProvider } from "@opencode-ai/ui/context"
import { CodeComponentProvider } from "@opencode-ai/ui/context/code"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { DiffComponentProvider } from "@opencode-ai/ui/context/diff"
import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import { Diff } from "@opencode-ai/ui/diff"
import { Font } from "@opencode-ai/ui/font"
import { ThemeProvider } from "@opencode-ai/ui/theme"
import { MetaProvider } from "@solidjs/meta"
import { Route, Router } from "@solidjs/router"
import { ErrorBoundary, type JSX, lazy, type ParentProps, Suspense } from "solid-js"
import { AnalysisProvider } from "~/context/analysis"
import { NotebookProvider } from "~/context/notebook"
import { VisualizationProvider } from "~/context/visualization"

// Re-export for desktop wrapper
export { PlatformProvider, type Platform } from "@opencode-ai/app"

const Home = lazy(() => import("~/pages/home"))
const Session = lazy(() => import("~/pages/session"))

const Loading = () => <div class="size-full" />

function UiI18nBridge(props: ParentProps) {
  return <I18nProvider value={{ locale: () => "en", t: (key: string) => key }}>{props.children}</I18nProvider>
}

export function DataAppBaseProviders(props: ParentProps) {
  return (
    <MetaProvider>
      <Font />
      <ThemeProvider>
        <UiI18nBridge>
          <ErrorBoundary fallback={(error) => <ErrorFallback error={error} />}>
            <DialogProvider>
              <MarkedProvider>
                <DiffComponentProvider component={Diff}>
                  <CodeComponentProvider component={Code}>{props.children}</CodeComponentProvider>
                </DiffComponentProvider>
              </MarkedProvider>
            </DialogProvider>
          </ErrorBoundary>
        </UiI18nBridge>
      </ThemeProvider>
    </MetaProvider>
  )
}

function ErrorFallback(props: { error: Error }) {
  return (
    <div class="flex size-full items-center justify-center">
      <div class="max-w-md rounded-lg border border-red-300 bg-red-50 p-6 dark:border-red-800 dark:bg-red-950">
        <h2 class="mb-2 text-lg font-semibold text-red-700 dark:text-red-300">Something went wrong</h2>
        <p class="text-sm text-red-600 dark:text-red-400">{props.error.message}</p>
      </div>
    </div>
  )
}

function DataAnalysisProviders(props: ParentProps) {
  return (
    <AnalysisProvider>
      <NotebookProvider>
        <VisualizationProvider>{props.children}</VisualizationProvider>
      </NotebookProvider>
    </AnalysisProvider>
  )
}

function SessionRoute() {
  return (
    <DataAnalysisProviders>
      <Suspense fallback={<Loading />}>
        <Session />
      </Suspense>
    </DataAnalysisProviders>
  )
}

function HomeRoute() {
  return (
    <Suspense fallback={<Loading />}>
      <Home />
    </Suspense>
  )
}

function AppLayout(props: ParentProps<{ appChildren?: JSX.Element }>) {
  return (
    <div class="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      {props.appChildren}
      {props.children}
    </div>
  )
}

export function DataAppInterface(props: { children?: JSX.Element }) {
  return (
    <Router root={(routerProps) => <AppLayout appChildren={props.children}>{routerProps.children}</AppLayout>}>
      <Route path="/" component={HomeRoute} />
      <Route path="/session/:id?" component={SessionRoute} />
    </Router>
  )
}
