import { lazy } from "solid-js"
import { render } from "solid-js/web"

const isLoading = window.location.pathname === "/loading"
const Component = isLoading ? lazy(() => import("./loading")) : lazy(() => import("./index"))

render(() => <Component />, document.getElementById("root")!)
