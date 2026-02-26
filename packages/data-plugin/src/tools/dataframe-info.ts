import { tool } from "@opencode-ai/plugin/tool"

export const dataframe_info = tool({
  description: [
    "Quick inspection of a tabular data file (CSV, TSV, Parquet, Excel).",
    "Runs pandas operations like df.info(), df.describe(), df.head(), df.shape, df.dtypes, df.columns on the file.",
    "Use this to quickly understand the structure and summary statistics of a dataset before deeper analysis.",
  ].join("\n"),
  args: {
    file_path: tool.schema.string().describe("Path to the data file (CSV, TSV, Parquet, Excel)"),
    operations: tool.schema
      .array(tool.schema.enum(["info", "describe", "head", "tail", "shape", "dtypes", "columns", "nunique", "isnull"]))
      .optional()
      .describe('Operations to run (default: ["info", "describe", "head"])'),
  },
  async execute(args, ctx) {
    const operations = args.operations ?? ["info", "describe", "head"]
    const filePath = args.file_path.startsWith("/") ? args.file_path : `${ctx.directory}/${args.file_path}`

    const code = [
      "import pandas as pd",
      "import io",
      "",
      `file_path = ${JSON.stringify(filePath)}`,
      "",
      "if file_path.endswith('.parquet'):",
      "    df = pd.read_parquet(file_path)",
      "elif file_path.endswith(('.xls', '.xlsx')):",
      "    df = pd.read_excel(file_path)",
      "elif file_path.endswith('.tsv'):",
      "    df = pd.read_csv(file_path, sep='\\t')",
      "else:",
      "    df = pd.read_csv(file_path)",
      "",
    ]

    for (const op of operations) {
      code.push(`print("=== ${op.toUpperCase()} ===")`)
      if (op === "info") {
        code.push("buf = io.StringIO()")
        code.push("df.info(buf=buf)")
        code.push("print(buf.getvalue())")
      } else if (op === "describe") {
        code.push("print(df.describe(include='all').to_string())")
      } else if (op === "head") {
        code.push("print(df.head(10).to_string())")
      } else if (op === "tail") {
        code.push("print(df.tail(10).to_string())")
      } else if (op === "shape") {
        code.push("print(f'Rows: {df.shape[0]}, Columns: {df.shape[1]}')")
      } else if (op === "dtypes") {
        code.push("print(df.dtypes.to_string())")
      } else if (op === "columns") {
        code.push("print('\\n'.join(df.columns.tolist()))")
      } else if (op === "nunique") {
        code.push("print(df.nunique().to_string())")
      } else if (op === "isnull") {
        code.push("print(df.isnull().sum().to_string())")
      }
      code.push("print()")
    }

    const proc = Bun.spawn(["python3", "-c", code.join("\n")], {
      cwd: ctx.directory,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    })

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const exitCode = await proc.exited

    ctx.metadata({
      title: exitCode === 0 ? `Inspected ${args.file_path}` : `Failed to inspect ${args.file_path}`,
      metadata: { exitCode, operations },
    })

    if (exitCode !== 0) return `Error inspecting file:\n${stderr.trim()}`
    return stdout.trim()
  },
})
