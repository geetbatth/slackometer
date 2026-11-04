import { loadConfig } from "./config.ts"
import { calibrate } from "./calibrate.ts"

export async function main(args: string[]): Promise<number> {
  const cfg = loadConfig()
  const yes = args.includes("--yes")
  const only = args.includes("--model") ? args[args.indexOf("--model") + 1] : null
  for (const c of cfg.contenders.filter((x) => !only || x.model === only)) {
    const lock = await calibrate(cfg, c, { yes })
    if (!lock && yes) return 1
  }
  return 0
}
