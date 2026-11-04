import { join } from "node:path"
import { loadConfig, paths } from "./config.ts"
import { readUsage, guard, currentRate } from "./usage.ts"

export async function main(): Promise<number> {
  const cfg = loadConfig()
  const u = await readUsage()
  const g = guard(u, cfg)
  const rate = currentRate(paths(cfg).rate)
  console.log(`5-hour:  ${u.five_hour}%\nweekly:  ${u.seven_day}% (resets ${u.seven_day_resets_at})\nextra usage (paid overflow): ${u.extra_usage_enabled ? "ON" : "off"}\nguard:   ${g.ok ? "ok to run" : "would NOT run"} (${g.reason})\nrate:    ${rate == null ? "not calibrated yet" : `${rate}% of weekly per API-$  (=> ${(cfg.budget.percent_of_weekly_per_run / rate).toFixed(2)} $ per run day)`}`)
  return 0
}
