import { loadConfig } from "./config.ts"
import { buildIndex } from "./index.ts"

export async function main(): Promise<number> {
  const r = await buildIndex(loadConfig())
  console.log(`site/data/runs.js: ${r.runs} runs, ${r.days} run days`)
  return 0
}
