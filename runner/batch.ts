// A run day: the locked suite, task-major, with resume, the usage guard, the hard ceiling and the cut-off.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { contenderId, paths } from "./config.ts"
import { latestLock } from "./calibrate.ts"
import { loadTasks } from "./tasks.ts"
import { runOne as realRunOne, resultPath } from "./run-one.ts"
import { readUsage as realReadUsage, safeGuard as realSafeGuard, addSample, currentRate } from "./usage.ts"
import type { Contender, DayRecord, Effort, LocalConfig, RunResult, TaskDef, Usage } from "./types.ts"

const GUARD_WAIT = 20 * 60_000
const LIMIT_WAIT = 30 * 60_000
const LIMIT_RETRIES = 3

export interface DayDeps {
  date: string
  now: () => Date
  runOne: (t: TaskDef, e: Effort, ctx: { cfg: LocalConfig; date: string; suiteVersion: number; contender: Contender }) => Promise<RunResult>
  safeGuard: (cfg: LocalConfig) => Promise<{ ok: boolean; reason: string; usage: Usage | null }>
  readUsage: () => Promise<Usage>
  sleep: (ms: number) => Promise<void>
  buildIndex: (cfg: LocalConfig) => Promise<{ runs: number; days: number }>
  publish: (cfg: LocalConfig, message: string) => Promise<void>
  log: (s: string) => void
}

const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

export async function runDay(cfg: LocalConfig, opts: Partial<DayDeps> = {}): Promise<DayRecord[]> {
  const now = opts.now ?? (() => new Date())
  const d: DayDeps = {
    date: localDate(now()), now,
    runOne: realRunOne, safeGuard: (c) => realSafeGuard(c), readUsage: () => realReadUsage(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    buildIndex: async (c) => (await import("./index.ts")).buildIndex(c),
    publish: async (c, m) => (await import("./publish.ts")).publish(c, m),
    log: (s) => console.log(`[${new Date().toISOString()}] ${s}`),
    ...opts,
  }
  const cutoff = new Date(`${d.date}T${cfg.cutoff}:00`)
  const pastCutoff = (extraMs = 0) => d.now().getTime() + extraMs > cutoff.getTime()
  const tasks = new Map(loadTasks(cfg).map((t) => [t.id, t]))
  const days: DayRecord[] = []

  for (const contender of cfg.contenders) {
    const lock = latestLock(cfg, contender)
    if (!lock) { d.log(`${contenderId(contender)}: no locked suite yet. Run calibrate first (see CALIBRATE.md).`); continue }
    const rate = lock.rate_pct_per_usd || currentRate(join(paths(cfg).machineResults, "rate.json")) || 0
    const ceiling = cfg.budget.ceiling_percent_of_weekly_per_run
    const before = await d.readUsage().catch(() => null)
    let spentUsd = 0, ccVersion = "", reason: string | null = null
    const add = (r: RunResult) => { spentUsd += r.cost_usd; if (r.cc_version) ccVersion = r.cc_version }

    outer: for (const entry of lock.tasks) {
      const t = tasks.get(entry.id)
      if (!t) { d.log(`skip ${entry.id}: no longer in the task pool (re-calibrate to drop it)`); continue }
      for (const effort of lock.efforts) {
        const file = resultPath(cfg, d.date, t.id, effort)
        if (existsSync(file)) {
          const prev = JSON.parse(readFileSync(file, "utf8")) as RunResult
          if (prev.end !== "limited") { add(prev); continue }
        }
        for (let attempt = 0; ; attempt++) {
          if (pastCutoff()) { reason = `cut-off ${cfg.cutoff} reached`; break outer }
          const g = await d.safeGuard(cfg)
          if (!g.ok) {
            if (pastCutoff(GUARD_WAIT)) { reason = `usage guard until cut-off: ${g.reason}`; break outer }
            d.log(`waiting: ${g.reason}`); await d.sleep(GUARD_WAIT); attempt--; continue
          }
          d.log(`${t.id} @ ${effort}`)
          const r = await d.runOne(t, effort, { cfg, date: d.date, suiteVersion: lock.version, contender })
          if (r.end === "limited" && attempt < LIMIT_RETRIES) { d.log(`limited; retrying in 30 min`); await d.sleep(LIMIT_WAIT); continue }
          add(r)
          break
        }
        if (spentUsd * rate >= ceiling) { reason = `over ceiling (${(spentUsd * rate).toFixed(2)}% >= ${ceiling}%)`; break outer }
      }
    }

    const after = await d.readUsage().catch(() => null)
    const pct = Math.round(spentUsd * rate * 1000) / 1000
    const day: DayRecord = {
      date: d.date, machine: cfg.machine, contender: contenderId(contender), suite_version: lock.version, cc_version: ccVersion,
      status: reason ? "incomplete" : "complete", incomplete_reason: reason, cost_usd: Math.round(spentUsd * 100) / 100,
      usage_pct_of_weekly: pct, budget_pct: cfg.budget.percent_of_weekly_per_run, ceiling_pct: ceiling,
      usage_before: before?.seven_day ?? null, usage_after: after?.seven_day ?? null,
    }
    const dir = join(paths(cfg).machineResults, d.date)
    mkdirSync(dir, { recursive: true })
    const dayFile = join(dir, days.length ? `day.${contender.model}.json` : "day.json")
    writeFileSync(dayFile, JSON.stringify(day, null, 2))
    // refine the rate: clean only when weekly usage moved about as much as the bench explains
    if (before && after && spentUsd > 0) {
      const moved = after.seven_day - before.seven_day
      addSample(join(paths(cfg).machineResults, "rate.json"), { date: d.date, d_pct: moved, usd: spentUsd, clean: !reason && moved >= 0 && moved <= pct * 2 + 1 })
    }
    d.log(`${contenderId(contender)}: ${day.status}${reason ? ` (${reason})` : ""}, $${day.cost_usd} ≈ ${pct}% of the weekly limit`)
    days.push(day)
  }
  if (days.length) {
    await d.buildIndex(cfg)
    await d.publish(cfg, `results: ${cfg.machine} ${d.date}`)
  }
  return days
}
