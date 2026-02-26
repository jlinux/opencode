import { tool } from "@opencode-ai/plugin/tool"
import path from "path"
import fs from "fs/promises"
import os from "os"

export const python_exec = tool({
  description: [
    "Execute Python code in a subprocess and return stdout, stderr, and any generated files.",
    "Use this tool to run data analysis scripts, compute statistics, process DataFrames, or generate plots.",
    "The code runs with the user's system Python 3 installation, so libraries like pandas, numpy, and matplotlib must be pre-installed.",
    "Generated image files (PNG, SVG) in the working directory will be detected and reported.",
  ].join("\n"),
  args: {
    code: tool.schema.string().describe("Python code to execute"),
    timeout: tool.schema.number().optional().describe("Timeout in milliseconds (default: 30000)"),
  },
  async execute(args, ctx) {
    const timeout = args.timeout ?? 30000
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-python-"))
    const scriptPath = path.join(tmpDir, "script.py")

    const wrapper = [
      "import sys, os",
      `os.chdir(${JSON.stringify(ctx.directory)})`,
      "",
      args.code,
    ].join("\n")

    await fs.writeFile(scriptPath, wrapper, "utf-8")

    const imagesBefore = await listImages(ctx.directory)

    const proc = Bun.spawn(["python3", scriptPath], {
      cwd: ctx.directory,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        MPLBACKEND: "Agg",
      },
    })

    const timer = setTimeout(() => proc.kill(), timeout)

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const exitCode = await proc.exited
    clearTimeout(timer)

    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})

    const imagesAfter = await listImages(ctx.directory)
    const newImages = imagesAfter.filter((f) => !imagesBefore.includes(f))

    ctx.metadata({
      title: exitCode === 0 ? "Python executed successfully" : `Python exited with code ${exitCode}`,
      metadata: { exitCode, newImages },
    })

    const parts = []
    if (stdout.trim()) parts.push(`stdout:\n${stdout.trim()}`)
    if (stderr.trim()) parts.push(`stderr:\n${stderr.trim()}`)
    parts.push(`exit_code: ${exitCode}`)
    if (newImages.length > 0) parts.push(`generated_images:\n${newImages.join("\n")}`)

    return parts.join("\n\n")
  },
})

async function listImages(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir).catch(() => [])
  return entries.filter((f) => /\.(png|jpg|jpeg|svg|gif|webp)$/i.test(f)).sort()
}
