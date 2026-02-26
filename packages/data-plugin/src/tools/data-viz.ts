import { tool } from "@opencode-ai/plugin/tool"
import path from "path"
import fs from "fs/promises"
import os from "os"

export const data_viz = tool({
  description: [
    "Generate data visualization charts from a data file using matplotlib/seaborn.",
    "Creates publication-quality charts and saves them as image files.",
    "Supports common chart types: line, bar, scatter, histogram, box, heatmap, pie.",
    "The data file must be readable by pandas (CSV, TSV, Parquet, Excel).",
  ].join("\n"),
  args: {
    chart_type: tool.schema
      .enum(["line", "bar", "scatter", "histogram", "box", "heatmap", "pie", "area", "violin"])
      .describe("Type of chart to generate"),
    data_source: tool.schema.string().describe("Path to the data file"),
    x_column: tool.schema.string().optional().describe("Column name for x-axis"),
    y_column: tool.schema.string().optional().describe("Column name for y-axis"),
    title: tool.schema.string().optional().describe("Chart title"),
    output_path: tool.schema.string().optional().describe("Output image path (default: chart.png in working dir)"),
    hue: tool.schema.string().optional().describe("Column for color grouping"),
    figsize: tool.schema
      .array(tool.schema.number())
      .optional()
      .describe("Figure size as [width, height] in inches (default: [10, 6])"),
    style: tool.schema
      .enum(["default", "seaborn-v0_8", "ggplot", "dark_background", "bmh", "fivethirtyeight"])
      .optional()
      .describe("Matplotlib style"),
  },
  async execute(args, ctx) {
    const dataPath = args.data_source.startsWith("/")
      ? args.data_source
      : path.resolve(ctx.directory, args.data_source)
    const outputPath = args.output_path
      ? path.resolve(ctx.directory, args.output_path)
      : path.resolve(ctx.directory, "chart.png")
    const figsize = args.figsize ?? [10, 6]
    const style = args.style ?? "seaborn-v0_8"
    const title = args.title ?? `${args.chart_type} chart`

    const code = buildChartCode({
      chartType: args.chart_type,
      dataPath,
      outputPath,
      xColumn: args.x_column,
      yColumn: args.y_column,
      title,
      hue: args.hue,
      figsize,
      style,
    })

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-viz-"))
    const scriptPath = path.join(tmpDir, "chart.py")
    await fs.writeFile(scriptPath, code)

    const proc = Bun.spawn(["python3", scriptPath], {
      cwd: ctx.directory,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, MPLBACKEND: "Agg", PYTHONUNBUFFERED: "1" },
    })

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const exitCode = await proc.exited

    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})

    ctx.metadata({
      title: exitCode === 0 ? `Generated ${args.chart_type} chart` : "Chart generation failed",
      metadata: { exitCode, outputPath: exitCode === 0 ? outputPath : undefined, chartType: args.chart_type },
    })

    if (exitCode !== 0) return `Chart generation failed:\n${stderr.trim()}`

    const parts = [`Chart saved to: ${outputPath}`]
    if (stdout.trim()) parts.push(stdout.trim())
    return parts.join("\n")
  },
})

function buildChartCode(opts: {
  chartType: string
  dataPath: string
  outputPath: string
  xColumn?: string
  yColumn?: string
  title: string
  hue?: string
  figsize: number[]
  style: string
}): string {
  const lines = [
    "import pandas as pd",
    "import matplotlib",
    "matplotlib.use('Agg')",
    "import matplotlib.pyplot as plt",
    "import seaborn as sns",
    "",
    `plt.style.use(${JSON.stringify(opts.style)})`,
    "",
  ]

  const dp = JSON.stringify(opts.dataPath)
  if (opts.dataPath.endsWith(".parquet")) {
    lines.push(`df = pd.read_parquet(${dp})`)
  } else if (opts.dataPath.endsWith(".tsv")) {
    lines.push(`df = pd.read_csv(${dp}, sep='\\t')`)
  } else if (opts.dataPath.match(/\.xlsx?$/)) {
    lines.push(`df = pd.read_excel(${dp})`)
  } else {
    lines.push(`df = pd.read_csv(${dp})`)
  }

  lines.push("")
  lines.push(`fig, ax = plt.subplots(figsize=(${opts.figsize[0]}, ${opts.figsize[1]}))`)

  const x = opts.xColumn ? JSON.stringify(opts.xColumn) : "None"
  const y = opts.yColumn ? JSON.stringify(opts.yColumn) : "None"
  const hue = opts.hue ? `, hue=${JSON.stringify(opts.hue)}` : ""

  switch (opts.chartType) {
    case "line":
      lines.push(`sns.lineplot(data=df, x=${x}, y=${y}${hue}, ax=ax)`)
      break
    case "bar":
      lines.push(`sns.barplot(data=df, x=${x}, y=${y}${hue}, ax=ax)`)
      break
    case "scatter":
      lines.push(`sns.scatterplot(data=df, x=${x}, y=${y}${hue}, ax=ax)`)
      break
    case "histogram":
      lines.push(opts.xColumn ? `sns.histplot(data=df, x=${x}${hue}, ax=ax)` : `df.hist(ax=ax)`)
      break
    case "box":
      lines.push(`sns.boxplot(data=df, x=${x}, y=${y}${hue}, ax=ax)`)
      break
    case "heatmap":
      lines.push("numeric_df = df.select_dtypes(include='number')")
      lines.push("sns.heatmap(numeric_df.corr(), annot=True, fmt='.2f', ax=ax)")
      break
    case "pie":
      if (opts.xColumn && opts.yColumn) {
        lines.push(`pie_data = df.groupby(${x})[${y}].sum()`)
      } else if (opts.xColumn) {
        lines.push(`pie_data = df[${x}].value_counts()`)
      } else {
        lines.push("pie_data = df.iloc[:, 0].value_counts()")
      }
      lines.push("pie_data.plot.pie(ax=ax, autopct='%1.1f%%')")
      break
    case "area":
      lines.push(`df.plot.area(x=${x}, y=${y}, ax=ax)`)
      break
    case "violin":
      lines.push(`sns.violinplot(data=df, x=${x}, y=${y}${hue}, ax=ax)`)
      break
  }

  lines.push("")
  lines.push(`ax.set_title(${JSON.stringify(opts.title)})`)
  lines.push("plt.tight_layout()")
  lines.push(`plt.savefig(${JSON.stringify(opts.outputPath)}, dpi=150, bbox_inches='tight')`)
  lines.push("plt.close()")
  lines.push(`print(f"Chart saved: ${opts.outputPath}")`)

  return lines.join("\n")
}
