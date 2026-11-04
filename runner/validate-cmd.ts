import { loadConfig } from "./config.ts"
import { loadTasks } from "./tasks.ts"
import { validateTask } from "./validate.ts"

export async function main(args: string[]): Promise<number> {
  const cfg = loadConfig()
  const which = args[0] ?? "all"
  const tasks = loadTasks(cfg).filter((t) => which === "all" || t.id === which)
  if (!tasks.length) { console.error(`no task "${which}"`); return 1 }
  let bad = 0
  for (const t of tasks) {
    const v = await validateTask(t)
    if (!v.ok) bad++
    console.log(`${v.ok ? "ok  " : "FAIL"} ${t.id.padEnd(28)} untouched ${v.untouched.passed}/${v.untouched.total}  reference ${v.reference.passed}/${v.reference.total}${v.ok ? "" : "\n       " + v.problems.join("\n       ")}`)
  }
  console.log(`\n${tasks.length - bad}/${tasks.length} tasks valid`)
  return bad ? 1 : 0
}
