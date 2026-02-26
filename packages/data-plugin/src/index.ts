import type { Plugin } from "@opencode-ai/plugin"
import { python_exec } from "./tools/python-exec"
import { dataframe_info } from "./tools/dataframe-info"
import { jupyter_cell } from "./tools/jupyter-cell"
import { data_viz } from "./tools/data-viz"

const plugin: Plugin = async (_input) => {
  return {
    tool: {
      python_exec,
      dataframe_info,
      jupyter_cell,
      data_viz,
    },
  }
}

export default plugin
