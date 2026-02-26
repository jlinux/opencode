import { tool } from "@opencode-ai/plugin/tool"
import path from "path"
import fs from "fs/promises"
import os from "os"

export const jupyter_cell = tool({
  description: [
    "Execute a Jupyter notebook cell or run code within a notebook context.",
    "Can execute an existing notebook file, inject and run a new cell, or create a notebook from code.",
    "Uses papermill or nbconvert for execution. Requires jupyter/papermill to be installed.",
  ].join("\n"),
  args: {
    notebook_path: tool.schema.string().optional().describe("Path to existing .ipynb notebook file"),
    code: tool.schema.string().optional().describe("Python code to execute as a new cell"),
    cell_index: tool.schema.number().optional().describe("Cell index to execute (0-based). If omitted, executes all cells"),
    output_path: tool.schema.string().optional().describe("Path to save the executed notebook"),
  },
  async execute(args, ctx) {
    if (!args.notebook_path && !args.code) {
      return "Error: must provide either notebook_path or code"
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-jupyter-"))

    if (args.code && !args.notebook_path) {
      const notebook = {
        nbformat: 4,
        nbformat_minor: 5,
        metadata: {
          kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
          language_info: { name: "python", version: "3.10.0" },
        },
        cells: [
          {
            cell_type: "code",
            source: args.code,
            metadata: {},
            outputs: [],
            execution_count: null,
          },
        ],
      }
      const nbPath = path.join(tmpDir, "cell.ipynb")
      await fs.writeFile(nbPath, JSON.stringify(notebook, null, 2))
      const outPath = args.output_path
        ? path.resolve(ctx.directory, args.output_path)
        : path.join(tmpDir, "cell_output.ipynb")

      return await executeNotebook(nbPath, outPath, ctx, tmpDir)
    }

    const nbPath = path.resolve(ctx.directory, args.notebook_path!)
    const outPath = args.output_path
      ? path.resolve(ctx.directory, args.output_path)
      : path.join(tmpDir, "output.ipynb")

    if (args.code) {
      const content = JSON.parse(await fs.readFile(nbPath, "utf-8"))
      const newCell = {
        cell_type: "code",
        source: args.code,
        metadata: { tags: ["injected"] },
        outputs: [],
        execution_count: null,
      }
      const idx = args.cell_index ?? content.cells.length
      content.cells.splice(idx, 0, newCell)
      const modifiedPath = path.join(tmpDir, "modified.ipynb")
      await fs.writeFile(modifiedPath, JSON.stringify(content, null, 2))
      return await executeNotebook(modifiedPath, outPath, ctx, tmpDir)
    }

    return await executeNotebook(nbPath, outPath, ctx, tmpDir)
  },
})

async function executeNotebook(inputPath: string, outputPath: string, ctx: any, tmpDir: string): Promise<string> {
  const proc = Bun.spawn(
    ["jupyter", "nbconvert", "--to", "notebook", "--execute", "--output", outputPath, inputPath],
    {
      cwd: ctx.directory,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    },
  )

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const exitCode = await proc.exited

  let outputs = ""
  if (exitCode === 0) {
    const executed = JSON.parse(await fs.readFile(outputPath, "utf-8").catch(() => "{}"))
    if (executed.cells) {
      outputs = executed.cells
        .filter((c: any) => c.cell_type === "code" && c.outputs?.length > 0)
        .map((c: any, i: number) => {
          const cellOutputs = c.outputs
            .map((o: any) => {
              if (o.output_type === "stream") return o.text?.join?.("") ?? o.text ?? ""
              if (o.output_type === "execute_result") return o.data?.["text/plain"]?.join?.("") ?? ""
              if (o.output_type === "error") return `Error: ${o.ename}: ${o.evalue}`
              return ""
            })
            .filter(Boolean)
            .join("\n")
          return `Cell ${i}:\n${cellOutputs}`
        })
        .filter(Boolean)
        .join("\n\n")
    }
  }

  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})

  ctx.metadata({
    title: exitCode === 0 ? "Notebook executed" : "Notebook execution failed",
    metadata: { exitCode, outputPath: exitCode === 0 ? outputPath : undefined },
  })

  if (exitCode !== 0) return `Notebook execution failed:\n${stderr.trim()}`
  const parts = []
  if (outputs.trim()) parts.push(outputs.trim())
  if (stdout.trim()) parts.push(`jupyter output:\n${stdout.trim()}`)
  parts.push(`output_notebook: ${outputPath}`)
  return parts.join("\n\n")
}
