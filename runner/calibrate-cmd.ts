import { loadConfig } from "./config.ts"
import { calibrate } from "./calibrate.ts"

export async function main(args: string[]): Promise<number> {
  const cfg = loadConfig()
  const yes = args.includes("--yes")
  const parallel = args.includes("--parallel") ? Math.max(1, Math.min(6, Number(args[args.indexOf("--parallel") + 1]) || 1)) : 1
  const only = args.includes("--model") ? args[args.indexOf("--model") + 1] : null
  for (const c of cfg.contenders.filter((x) => !only || x.model === only)) {
    const lock = await calibrate(cfg, c, { yes, parallel })
    if (!lock && yes) return 1
  }
  return 0
}
