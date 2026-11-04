import { loadConfig } from "./config.ts"
import { loadTasks } from "./tasks.ts"
import { runOne } from "./run-one.ts"
import type { Effort } from "./types.ts"

export async function main(args: string[]): Promise<number> {
  const [taskId, effort] = args
  if (!taskId || !effort) { console.error("usage: run-one <task> <effort> [--model m]"); return 1 }
  const cfg = loadConfig()
  const t = loadTasks(cfg).find((x) => x.id === taskId)
  if (!t) { console.error(`no task ${taskId}`); return 1 }
  const contender = { ...cfg.contenders[0] }
  if (args.includes("--model")) contender.model = args[args.indexOf("--model") + 1]
  const date = new Date().toISOString().slice(0, 10)
  const r = await runOne(t, effort as Effort, { cfg, date, suiteVersion: 0, contender })
  console.log(JSON.stringify({ task: r.task, effort: r.effort, end: r.end, pass: r.pass, tests: `${r.tests_passed}/${r.tests_total}`, cost_usd: r.cost_usd, output_tokens: r.output_tokens, ran_tests: r.ran_tests, claimed_done: r.claimed_done }, null, 2))
  console.log("(suite_version 0 = manual test run; delete it from results/ if you don't want it on the site)")
  return 0
}
