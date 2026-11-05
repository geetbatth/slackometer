// Calibration: run every task x level once, learn costs and the usage rate, then lock a suite that fits the budget.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { contenderId, paths } from "./config.ts"
import { loadTasks, missingTools } from "./tasks.ts"
import { runOne as realRunOne } from "./run-one.ts"
import { readUsage as realReadUsage, addSample, currentRate, guard, sameWeek } from "./usage.ts"
import type { Contender, Effort, LocalConfig, RunResult, SuiteLock, TaskDef, Usage } from "./types.ts"

const DIFF_ORDER = { easy: 0, medium: 1, hard: 2 } as const
const GUARD_WAIT = 20 * 60_000
export const DEFAULT_RUN_COST: Record<Effort, number> = { low: 0.25, medium: 0.4, high: 0.7, xhigh: 1.2, max: 2 }

/**
 * Deterministic, language-balanced pick that fits planTo x allowance (all levels of a task count together).
 * Within a language, tasks that told the effort levels apart at calibration come first (`signal`), then harder ones:
 * a task every level aces measures nothing.
 */
export function selectSuite(costs: Map<string, { task: TaskDef; usd: Record<Effort, number>; signal?: number }>, allowanceUsd: number, planTo: number): string[] {
  const cap = allowanceUsd * planTo
  const total = (id: string) => Object.values(costs.get(id)!.usd).reduce((a, b) => a + b, 0)
  const buckets = new Map<string, string[]>()
  for (const [id, { task }] of costs) buckets.set(task.language, [...(buckets.get(task.language) ?? []), id])
  for (const [lang, ids] of buckets) {
    const sig = (id: string) => costs.get(id)!.signal ?? 0
    const diff = (id: string) => DIFF_ORDER[costs.get(id)!.task.difficulty]
    buckets.set(lang, [...ids].sort((a, b) => sig(b) - sig(a) || diff(b) - diff(a) || total(a) - total(b) || a.localeCompare(b)))
  }
  const picked: string[] = []
  const count = new Map<string, number>()
  const done = new Set<string>()
  let spent = 0
  while (done.size < buckets.size) {
    const lang = [...buckets.keys()].filter((l) => !done.has(l)).sort((a, b) => (count.get(a) ?? 0) - (count.get(b) ?? 0) || a.localeCompare(b))[0]
    // best remaining task of this language that still fits; a language is done when none does
    const q = buckets.get(lang)!
    const i = q.findIndex((id) => spent + total(id) <= cap + 1e-9)
    if (i < 0) { done.add(lang); continue }
    const next = q.splice(i, 1)[0]
    picked.push(next); spent += total(next); count.set(lang, (count.get(lang) ?? 0) + 1)
  }
  return picked
}

/** How much a task told the effort levels apart: spread of scores plus how far the weakest level fell short. */
export function signalOf(runs: Pick<RunResult, "score">[]): number {
  if (runs.length < 2) return 0
  const sc = runs.map((r) => r.score)
  return Math.round(((Math.max(...sc) - Math.min(...sc)) + (1 - Math.min(...sc))) * 1000) / 1000
}

export const suitesDir = (cfg: LocalConfig) => paths(cfg).locks // full locks (with rate and $ allowance) stay local
export const publicSuitesDir = (cfg: LocalConfig) => join(paths(cfg).machineResults, "suites")
export const slug = (c: Contender) => c.model.replace(/[^a-z0-9.-]/gi, "_")

export function latestLock(cfg: LocalConfig, c: Contender): SuiteLock | null {
  const dir = suitesDir(cfg)
  if (!existsSync(dir)) return null
  const prefix = slug(c) + ".v"
  const versions = readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(".json")).map((f) => Number(f.slice(prefix.length, -5))).filter(Number.isFinite)
  if (!versions.length) return null
  return JSON.parse(readFileSync(join(dir, `${prefix}${Math.max(...versions)}.json`), "utf8"))
}

/** The same task version, already run at this level by an earlier calibration of this contender. */
function earlierRun(cfg: LocalConfig, c: Contender, version: number, t: TaskDef, e: Effort): RunResult | null {
  for (let v = version - 1; v >= 1; v--) {
    const f = join(paths(cfg).machineResults, `calibration-v${v}`, `${t.id}__${e}.json`)
    if (!existsSync(f)) continue
    const r = JSON.parse(readFileSync(f, "utf8")) as RunResult
    if (r.contender === contenderId(c) && r.task_version === t.version && r.end !== "limited") return r
  }
  return null
}

export interface CalDeps {
  runOne: (t: TaskDef, e: Effort, ctx: { cfg: LocalConfig; date: string; suiteVersion: number; contender: Contender }) => Promise<RunResult>
  readUsage: () => Promise<Usage>
  withQuiet: (cfg: LocalConfig, fn: () => Promise<void>) => Promise<void>
  today: () => string
  log: (s: string) => void
  sleep: (ms: number) => Promise<void>
}

export async function calibrate(cfg: LocalConfig, contender: Contender, opts: { yes: boolean; parallel?: number; deps?: Partial<CalDeps> }): Promise<SuiteLock | null> {
  const d: CalDeps = {
    runOne: realRunOne,
    readUsage: () => realReadUsage(),
    today: () => new Date().toISOString().slice(0, 10),
    log: (s) => console.log(s),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    withQuiet: async (c, fn) => (await import("./quiet.ts")).withQuiet(c, fn, { readUsage: () => realReadUsage() }),
    ...opts.deps,
  }
  const tasks = loadTasks(cfg).filter((t) => {
    const m = missingTools(t)
    if (m.length) d.log(`skip ${t.id}: missing ${m.join(", ")}`)
    return !m.length
  })
  const efforts = contender.efforts
  const estUsd = tasks.length * efforts.reduce((a, e) => a + DEFAULT_RUN_COST[e], 0)
  const rateFile = paths(cfg).rate
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
  const calDir = join(paths(cfg).machineResults, `calibration-v${version}`)
  const stateFile = join(paths(cfg).state, `calibration-${cfg.machine}-v${version}.json`)
  const results: RunResult[] = []
  let reused = 0
  const usage: { before: Usage | null; after: Usage | null } = { before: null, after: null }
  await d.withQuiet(cfg, async () => {
    // an unfinished calibration of this version is resumed, measuring from its original start
    usage.before = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")).usage_before : await d.readUsage()
    mkdirSync(calDir, { recursive: true }); mkdirSync(paths(cfg).state, { recursive: true })
    writeFileSync(stateFile, JSON.stringify({ started: date, usage_before: usage.before }, null, 2))
    const todo: [TaskDef, Effort][] = []
    for (const t of tasks) for (const e of efforts) {
      const done = join(calDir, `${t.id}__${e}.json`)
      if (existsSync(done)) {
        const r = JSON.parse(readFileSync(done, "utf8")) as RunResult
        if (r.end !== "limited") { results.push(r); continue }
      }
      // an earlier calibration already measured this exact task version at this level: reuse it, don't pay again
      const old = earlierRun(cfg, contender, version, t, e)
      if (old) { const r = { ...old, reused_from: old.date }; writeFileSync(done, JSON.stringify(r, null, 2)); results.push(r); reused++; continue }
      todo.push([t, e])
    }
    if (reused) d.log(`  reusing ${reused} runs from earlier calibrations; ${todo.length} to run`)
    // several runs at once only changes wall-clock minutes (builds share the CPU); tokens, cost and scores are per run
    const worker = async () => {
      for (let next = todo.shift(); next; next = todo.shift()) {
        const [t, e] = next
        // wait out the usage guard (up to 12 h) instead of throwing the night away
        for (let waited = 0; ; waited += GUARD_WAIT) {
          const u = await d.readUsage().catch(() => null)
          const g = u ? guard(u, cfg) : { ok: false, reason: "usage unreadable" }
          if (g.ok) break
          if (waited >= 12 * 3_600_000) throw new Error(`stopping calibration: ${g.reason}. Finished runs are kept; run calibrate --yes again to continue.`)
          d.log(`  waiting: ${g.reason}`); await d.sleep(GUARD_WAIT)
        }
        d.log(`  ${t.id} @ ${e}`)
        results.push(await d.runOne(t, e, { cfg, date: `calibration-v${version}`, suiteVersion: version, contender }))
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, opts.parallel ?? 1) }, worker))
    // topping up with a known rate doesn't need the final reading (the rate is kept), so a busy endpoint can't sink it
    usage.after = await d.readUsage().catch((e) => { if (known != null && results.some((r) => (r as RunResult & { reused_from?: string }).reused_from)) return usage.before; throw e })
  })
  const fresh = results.filter((r) => !(r as RunResult & { reused_from?: string }).reused_from)
  const usd = fresh.reduce((a, r) => a + r.cost_usd, 0)
  const before = usage.before!, after = usage.after!
  const dPct = after.seven_day - before.seven_day
  if (known != null && results.some((r) => (r as RunResult & { reused_from?: string }).reused_from)) {
    // topping up an existing calibration: keep the rate already learned (run days keep refining it)
    d.log(`Kept the existing usage rate; weekly usage moved ${dPct} points over $${usd.toFixed(2)} of new runs.`)
  } else {
    if (!sameWeek(before.seven_day_resets_at, after.seven_day_resets_at))
      throw new Error("your weekly usage window reset during calibration, so the rate can't be measured. Run calibrate --yes again (finished runs are reused).")
    if (dPct <= 0) throw new Error(`weekly usage didn't move (${dPct} points) over $${usd.toFixed(2)} of runs, so the rate can't be measured. Run calibrate --yes again later (finished runs are reused).`)
    if (dPct < 5) d.log(`Note: weekly usage moved only ${dPct} points; the rate is rough until more run days refine it.`)
    addSample(rateFile, { date, d_pct: dPct, usd, clean: dPct >= 5 || known == null })
  }
  const rate = currentRate(rateFile)
  if (!rate) throw new Error("could not derive a usage rate (no cost recorded?)")
  return writeLock(cfg, contender, tasks, efforts, results, version, date, rate, d.log)
}

/** Pick the suite from calibration results at the current budget and write the lock (local) and its summary (public). */
function writeLock(cfg: LocalConfig, contender: Contender, tasks: TaskDef[], efforts: Effort[], results: RunResult[], version: number, date: string, rate: number, log: (s: string) => void): SuiteLock {
  const allowance = cfg.budget.percent_of_weekly_per_run / rate

  const costs = new Map<string, { task: TaskDef; usd: Record<Effort, number> }>()
  for (const t of tasks) {
    const usdBy = Object.fromEntries(efforts.map((e) => {
      const r = results.find((x) => x.task === t.id && x.effort === e)
      return [e, r && r.end !== "limited" ? r.cost_usd : DEFAULT_RUN_COST[e]]
    })) as Record<Effort, number>
    costs.set(t.id, { task: t, usd: usdBy, signal: signalOf(results.filter((x) => x.task === t.id && x.end !== "limited")) })
  }
  const ids = selectSuite(costs, allowance, cfg.budget.plan_to)
  if (!ids.length) throw new Error(`no task fits a $${allowance.toFixed(2)} run-day allowance at every level. Raise budget.percent_of_weekly_per_run or run fewer effort levels, then calibrate again (finished runs are reused).`)
  const lock: SuiteLock = {
    contender: contenderId(contender), machine: cfg.machine, version, calibrated_at: date, efforts,
    tasks: ids.map((id) => ({ id, version: costs.get(id)!.task.version, cost_usd: costs.get(id)!.usd })),
    allowance_usd: Math.round(allowance * 100) / 100, rate_pct_per_usd: rate,
  }
  mkdirSync(suitesDir(cfg), { recursive: true })
  writeFileSync(join(suitesDir(cfg), `${slug(contender)}.v${version}.json`), JSON.stringify(lock, null, 2))
  // what the site needs to know about the suite, without any usage or money numbers
  mkdirSync(publicSuitesDir(cfg), { recursive: true })
  writeFileSync(join(publicSuitesDir(cfg), `${slug(contender)}.v${version}.json`), JSON.stringify({ contender: lock.contender, machine: lock.machine, version, calibrated_at: date, efforts, tasks: lock.tasks.map((t) => ({ id: t.id, version: t.version })) }, null, 2))
  const planned = ids.reduce((a, id) => a + Object.values(costs.get(id)!.usd).reduce((x, y) => x + y, 0), 0)
  log(`Locked suite v${version}: ${ids.length} tasks x ${efforts.length} levels, planned ~$${planned.toFixed(2)} of a $${allowance.toFixed(2)} run-day allowance.`)
  return lock
}

/**
 * Re-pick the suite of the latest calibration at the current budget, without running anything.
 * Only before the first run day of that suite: changing a suite under existing results would break its trend.
 */
export function relock(cfg: LocalConfig, contender: Contender, log: (s: string) => void = console.log): SuiteLock {
  const prev = latestLock(cfg, contender)
  if (!prev) throw new Error("nothing to relock: calibrate first")
  const root = paths(cfg).machineResults
  const used = existsSync(root) && readdirSync(root).some((day) => /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    readdirSync(join(root, day)).some((f) => { try { const r = JSON.parse(readFileSync(join(root, day, f), "utf8")); return r.contender === prev.contender && r.suite_version === prev.version } catch { return false } }))
  if (used) throw new Error(`suite v${prev.version} already has run days; calibrate again to make a new suite instead`)
  const calDir = join(root, `calibration-v${prev.version}`)
  const results = readdirSync(calDir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(calDir, f), "utf8")) as RunResult)
  const rate = currentRate(paths(cfg).rate)
  if (!rate) throw new Error("no usage rate on this machine yet: calibrate first")
  const tasks = loadTasks(cfg).filter((t) => !missingTools(t).length)
  return writeLock(cfg, contender, tasks, prev.efforts, results, prev.version, prev.calibrated_at, rate, log)
}
