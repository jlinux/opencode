import { $ } from "bun"

const RUST_TARGET = Bun.env.TAURI_ENV_TARGET_TRIPLE

const SIDECAR_BINARIES: Array<{ rustTarget: string; ocBinary: string }> = [
  { rustTarget: "aarch64-apple-darwin", ocBinary: "opencode-darwin-arm64" },
  { rustTarget: "x86_64-apple-darwin", ocBinary: "opencode-darwin-x64-baseline" },
  { rustTarget: "x86_64-pc-windows-msvc", ocBinary: "opencode-windows-x64-baseline" },
  { rustTarget: "x86_64-unknown-linux-gnu", ocBinary: "opencode-linux-x64-baseline" },
  { rustTarget: "aarch64-unknown-linux-gnu", ocBinary: "opencode-linux-arm64" },
]

const binaryConfig = SIDECAR_BINARIES.find((b) => b.rustTarget === RUST_TARGET)
if (!binaryConfig && RUST_TARGET) throw new Error(`Sidecar configuration not available for target '${RUST_TARGET}'`)

const ocBinary = binaryConfig?.ocBinary ?? "opencode-darwin-arm64"
const binaryPath = `../opencode/dist/${ocBinary}/bin/opencode${process.platform === "win32" ? ".exe" : ""}`

// Build the opencode CLI
await (ocBinary.includes("-baseline")
  ? $`cd ../opencode && bun run build --single --baseline`
  : $`cd ../opencode && bun run build --single`)

// Copy to sidecar folder
await $`mkdir -p src-tauri/sidecars`
const dest = `src-tauri/sidecars/opencode-cli-${RUST_TARGET ?? "unknown"}${process.platform === "win32" ? ".exe" : ""}`
await $`cp ${binaryPath} ${dest}`

console.log(`Copied ${binaryPath} to ${dest}`)
