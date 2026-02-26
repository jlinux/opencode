import { defineConfig } from "vite"
import dataAppPlugin from "./vite"

export default defineConfig({
  plugins: [dataAppPlugin] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3001,
  },
  build: {
    target: "esnext",
  },
})
