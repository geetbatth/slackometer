import { loadConfig } from "./config.ts"
import { runDay } from "./batch.ts"

export async function main(args: string[]): Promise<number> {
  const cfg = loadConfig()
  const date = args.includes("--date") ? args[args.indexOf("--date") + 1] : undefined
  const days = await runDay(cfg, date ? { date } : {})
  if (!days.length) return 1
  return days.every((d) => d.status === "complete") ? 0 : 3
}
