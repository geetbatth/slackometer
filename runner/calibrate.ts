// Calibration: run every task x level once, learn costs and the usage rate, then lock a suite that fits the budget.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { contenderId, paths } from "./config.ts"
import { loadTasks, missingTools } from "./tasks.ts"
import { runOne as realRunOne } from "./run-one.ts"
import { readUsage as realReadUsage, addSample, currentRate, guard } from "./usage.ts"
import type { Contender, Effort, LocalConfig, RunResult, SuiteLock, TaskDef, Usage } from "./types.ts"

const DIFF_ORDER = { easy: 0, medium: 1, hard: 2 } as const
export const DEFAULT_RUN_COST: Record<Effort, number> = { low: 0.25, medium: 0.4, high: 0.7, xhigh: 1.2, max: 2 }

/** Deterministic, language-balanced pick that fits planTo x allowance (all levels of a task count together). */
export function selectSuite(costs: Map<string, { task: TaskDef; usd: Record<Effort, number> }>, allowanceUsd: number, planTo: number): string[] {
  const cap = allowanceUsd * planTo
  const total = (id: string) => Object.values(costs.get(id)!.usd).reduce((a, b) => a + b, 0)
  const buckets = new Map<string, string[]>()
  for (const [id, { task }] of costs) buckets.set(task.language, [...(buckets.get(task.language) ?? []), id])
  for (const [lang, ids] of buckets) {
    // rotate difficulties easy -> medium -> hard, cheapest first within each difficulty
    const byDiff = [0, 1, 2].map((d) => ids.filter((id) => DIFF_ORDER[costs.get(id)!.task.difficulty] === d).sort((a, b) => total(a) - total(b) || a.localeCompare(b)))
    const order: string[] = []
    while (byDiff.some((q) => q.length)) for (const q of byDiff) if (q.length) order.push(q.shift()!)
    buckets.set(lang, order)
  }
  const picked: string[] = []
  const count = new Map<string, number>()
  const done = new Set<string>()
  let spent = 0
  while (done.size < buckets.size) {
    const lang = [...buckets.keys()].filter((l) => !done.has(l)).sort((a, b) => (count.get(a) ?? 0) - (count.get(b) ?? 0) || a.localeCompare(b))[0]
    const next = buckets.get(lang)!.shift()
    if (!next || spent + total(next) > cap + 1e-9) { done.add(lang); continue }
    picked.push(next); spent += total(next); count.set(lang, (count.get(lang) ?? 0) + 1)
  }
  return picked
}

export const suitesDir = (cfg: LocalConfig) => join(paths(cfg).machineResults, "suites")
export const slug = (c: Contender) => c.model.replace(/[^a-z0-9.-]/gi, "_")

export function latestLock(cfg: LocalConfig, c: Contender): SuiteLock | null {
  const dir = suitesDir(cfg)
  if (!existsSync(dir)) return null
  const prefix = slug(c) + ".v"
  const versions = readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(".json")).map((f) => Number(f.slice(prefix.length, -5))).filter(Number.isFinite)
  if (!versions.length) return null
  return JSON.parse(readFileSync(join(dir, `${prefix}${Math.max(...versions)}.json`), "utf8"))
}

export interface CalDeps {
  runOne: (t: TaskDef, e: Effort, ctx: { cfg: LocalConfig; date: string; suiteVersion: number; contender: Contender }) => Promise<RunResult>
  readUsage: () => Promise<Usage>
  withQuiet: (cfg: LocalConfig, fn: () => Promise<void>) => Promise<void>
  today: () => string
  log: (s: string) => void
}

export async function calibrate(cfg: LocalConfig, contender: Contender, opts: { yes: boolean; deps?: Partial<CalDeps> }): Promise<SuiteLock | null> {
  const d: CalDeps = {
    runOne: realRunOne,
    readUsage: () => realReadUsage(),
    today: () => new Date().toISOString().slice(0, 10),
    log: (s) => console.log(s),
    withQuiet: async (c, fn) => (await import("./quiet.ts")).withQuiet(c, fn),
    ...opts.deps,
  }
  const tasks = loadTasks(cfg).filter((t) => {
    const m = missingTools(t)
    if (m.length) d.log(`skip ${t.id}: missing ${m.join(", ")}`)
    return !m.length
  })
  const efforts = contender.efforts
  const estUsd = tasks.length * efforts.reduce((a, e) => a + DEFAULT_RUN_COST[e], 0)
  const rateFile = join(paths(cfg).machineResults, "rate.json")
  const known = currentRate(rateFile)
  d.log(`Calibration for ${contenderId(contender)} on ${cfg.machine}: ${tasks.length} tasks x ${efforts.length} levels = ${tasks.length * efforts.length} runs.`)
  d.log(`Rough estimate: ~$${estUsd.toFixed(0)} API-equivalent${known ? ` (~${(estUsd * known).toFixed(1)}% of your weekly limit)` : ", likely several % of your weekly limit"}. One-off; it can exceed the daily budget.`)
  if (!opts.yes) {
    d.log("Not started. Re-run with --yes when ready (overnight is best; see CALIBRATE.md).")
    return null
  }

  const prev = latestLock(cfg, contender)
  const version = (prev?.version ?? 0) + 1
  const date = d.today()
  const results: RunResult[] = []
  const usage: { before: Usage | null; after: Usage | null } = { before: null, after: null }
  await d.withQuiet(cfg, async () => {
    usage.before = await d.readUsage()
    for (const t of tasks) for (const e of efforts) {
      const u = await d.readUsage().catch(() => null)
      const g = u ? guard(u, cfg) : { ok: false, reason: "usage unreadable" }
      if (!g.ok) throw new Error(`stopping calibration: ${g.reason}. Finished runs are kept in results/${cfg.machine}/calibration-v${version}.`)
      d.log(`  ${t.id} @ ${e}`)
      results.push(await d.runOne(t, e, { cfg, date: `calibration-v${version}`, suiteVersion: version, contender }))
    }
    usage.after = await d.readUsage()
  })
  const usd = results.reduce((a, r) => a + r.cost_usd, 0)
  const dPct = usage.after!.seven_day - usage.before!.seven_day
  if (dPct < 5) d.log(`Note: weekly usage moved only ${dPct} points; the rate is rough until more run days refine it.`)
  addSample(rateFile, { date, d_pct: dPct, usd, clean: dPct >= 5 || known == null })
  const rate = currentRate(rateFile)
  if (!rate) throw new Error("could not derive a usage rate (no cost recorded?)")
  const allowance = cfg.budget.percent_of_weekly_per_run / rate

  const costs = new Map<string, { task: TaskDef; usd: Record<Effort, number> }>()
  for (const t of tasks) {
    const usdBy = Object.fromEntries(efforts.map((e) => {
      const r = results.find((x) => x.task === t.id && x.effort === e)
      return [e, r && r.end !== "limited" ? r.cost_usd : DEFAULT_RUN_COST[e]]
    })) as Record<Effort, number>
    costs.set(t.id, { task: t, usd: usdBy })
  }
  const ids = selectSuite(costs, allowance, cfg.budget.plan_to)
  if (!ids.length) d.log("WARNING: no task fits the budget at every level. Raise budget.percent_of_weekly_per_run or run fewer effort levels.")
  const lock: SuiteLock = {
    contender: contenderId(contender), machine: cfg.machine, version, calibrated_at: date, efforts,
    tasks: ids.map((id) => ({ id, version: costs.get(id)!.task.version, cost_usd: costs.get(id)!.usd })),
    allowance_usd: Math.round(allowance * 100) / 100, rate_pct_per_usd: rate,
  }
  mkdirSync(suitesDir(cfg), { recursive: true })
  writeFileSync(join(suitesDir(cfg), `${slug(contender)}.v${version}.json`), JSON.stringify(lock, null, 2))
  const planned = ids.reduce((a, id) => a + Object.values(costs.get(id)!.usd).reduce((x, y) => x + y, 0), 0)
  d.log(`Locked suite v${version}: ${ids.length} tasks x ${efforts.length} levels, planned ~$${planned.toFixed(2)} of a $${allowance.toFixed(2)} run-day allowance.`)
  return lock
}
