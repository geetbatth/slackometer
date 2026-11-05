import { loadConfig } from "./config.ts"
import { runDay } from "./batch.ts"

export async function main(args: string[]): Promise<number> {
  const cfg = loadConfig()
  if (args.includes("--parallel")) cfg.parallel = Math.max(1, Math.min(6, Number(args[args.indexOf("--parallel") + 1]) || 1))
  const date = args.includes("--date") ? args[args.indexOf("--date") + 1] : undefined
  const days = await runDay(cfg, date ? { date } : {})
  if (!days.length) return 1
  return days.every((d) => d.status === "complete") ? 0 : 3
}
