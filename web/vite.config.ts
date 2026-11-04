import path from "node:path"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"
import { viteSingleFile } from "vite-plugin-singlefile"

// Builds to ../site as ONE self-contained index.html (works on GitHub Pages
// and when opened straight from disk). Data is a separate plain script,
// site/data/runs.js, copied from public/ and replaced by the runner.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  build: { outDir: "../site", emptyOutDir: true },
})

