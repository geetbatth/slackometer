// A run day: the locked suite, task-major, with resume, the usage guard, the hard ceiling and the cut-off.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { contenderId, paths } from "./config.ts"
import { latestLock } from "./calibrate.ts"
import { loadTasks } from "./tasks.ts"
import { runOne as realRunOne, resultPath } from "./run-one.ts"
import { readUsage as realReadUsage, safeGuard as realSafeGuard, addSample, currentRate, sameWeek } from "./usage.ts"
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
  publish: (cfg: LocalConfig, message: string, rebuild: () => Promise<unknown>) => Promise<void>
  log: (s: string) => void
}

export const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

/** A run that threw inside the runner (not the model's fault) is recorded as errored so the day can continue. */
function erroredResult(cfg: LocalConfig, t: TaskDef, effort: Effort, date: string, suiteVersion: number, contender: Contender, err: unknown): RunResult {
  const r = {
    schema: 1, date, machine: cfg.machine, person: cfg.person, contender: contenderId(contender), effort, task: t.id, bench: t.bench,
    task_version: t.version, suite_version: suiteVersion, task_meta: { title: t.title, language: t.language, kind: t.kind, difficulty: t.difficulty, ui: t.ui },
    pass: false, score: 0, tests_passed: 0, tests_total: 0, ui_checks: null, judge: null,
    output_tokens: 0, input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0, tool_calls: 0, turns: 0, files_read: 0, files_read_before_first_edit: 0,
    ran_tests: false, verified_after_last_edit: false, minutes: 0, claimed_done: false, claim_text: "", digest: `Runner error: ${String((err as Error)?.message ?? err).slice(0, 200)}`,
    cc_version: "", model_id: contender.model, end: "errored", started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
  } as RunResult
  const f = resultPath(cfg, date, t.id, effort)
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(f, JSON.stringify(r, null, 2))
  return r
}

export async function runDay(cfg: LocalConfig, opts: Partial<DayDeps> = {}): Promise<DayRecord[]> {
  const now = opts.now ?? (() => new Date())
  const d: DayDeps = {
    date: localDate(now()), now,
    runOne: realRunOne, safeGuard: (c) => realSafeGuard(c), readUsage: () => realReadUsage(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    buildIndex: async (c) => (await import("./index.ts")).buildIndex(c),
    publish: async (c, m, rebuild) => (await import("./publish.ts")).publish(c, m, rebuild),
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
    const rate = lock.rate_pct_per_usd || currentRate(paths(cfg).rate) || 0
    const ceiling = cfg.budget.ceiling_percent_of_weekly_per_run
    const dir = join(paths(cfg).machineResults, d.date)
    const dayName = days.length ? `day.${contender.model}.json` : "day.json"
    const dayFile = join(dir, dayName)
    const localDayFile = join(paths(cfg).days, `${d.date}.${dayName}`)
    // usage before the day: kept from an earlier start of this same day, so a resumed day measures the whole day
    const earlier = existsSync(localDayFile) ? (JSON.parse(readFileSync(localDayFile, "utf8")) as DayRecord) : null
    const beforeNow = await d.readUsage().catch(() => null)
    const usageBefore = earlier?.usage_before ?? beforeNow?.seven_day ?? null
    const record = (patch: Partial<DayRecord>): DayRecord => {
      const day: DayRecord = {
        date: d.date, machine: cfg.machine, contender: contenderId(contender), suite_version: lock.version, cc_version: "",
        status: "incomplete", incomplete_reason: "in progress", cost_usd: 0, usage_pct_of_weekly: 0,
        budget_pct: cfg.budget.percent_of_weekly_per_run, ceiling_pct: ceiling, usage_before: usageBefore, usage_after: null, ...patch,
      }
      mkdirSync(paths(cfg).days, { recursive: true }); writeFileSync(localDayFile, JSON.stringify(day, null, 2))
      const { usage_pct_of_weekly, budget_pct, ceiling_pct, usage_before, usage_after, ...pub } = day // usage numbers stay local
      void usage_pct_of_weekly; void budget_pct; void ceiling_pct; void usage_before; void usage_after
      mkdirSync(dir, { recursive: true }); writeFileSync(dayFile, JSON.stringify(pub, null, 2)); return day
    }
    record({}) // an interrupted day must never look complete

    let spentUsd = 0, ccVersion = "", reason: string | null = null, resumed = false
    const charge = (r: RunResult, e: Effort, calibrated: number | undefined) => {
      // a run that dies before Claude reports a cost (timeout, crash) still used the subscription
      const est = (r.end === "timeout" || r.end === "errored") && !r.cost_usd ? calibrated ?? 0 : r.cost_usd
      if (est !== r.cost_usd) d.log(`  no cost reported for ${r.task}@${e}; counting the calibrated $${est}`)
      spentUsd += est
      if (r.cc_version) ccVersion = r.cc_version
    }

    outer: for (const entry of lock.tasks) {
      const t = tasks.get(entry.id)
      if (!t) { d.log(`skip ${entry.id}: no longer in the task pool (re-calibrate to drop it)`); continue }
      for (const effort of lock.efforts) {
        if (spentUsd * rate >= ceiling) { reason = `over ceiling (${(spentUsd * rate).toFixed(2)}% >= ${ceiling}%)`; break outer }
        const file = resultPath(cfg, d.date, t.id, effort)
        if (existsSync(file)) {
          const prev = JSON.parse(readFileSync(file, "utf8")) as RunResult
          if (prev.end !== "limited") { charge(prev, effort, entry.cost_usd[effort]); resumed = true; continue }
        }
        for (let attempt = 0; ; attempt++) {
          if (pastCutoff()) { reason = `cut-off ${cfg.cutoff} reached`; break outer }
          const g = await d.safeGuard(cfg)
          if (!g.ok) {
            if (pastCutoff(GUARD_WAIT)) { reason = `usage guard until cut-off: ${g.reason}`; break outer }
            d.log(`waiting: ${g.reason}`); await d.sleep(GUARD_WAIT); attempt--; continue
          }
          d.log(`${t.id} @ ${effort}`)
          let r: RunResult
          try { r = await d.runOne(t, effort, { cfg, date: d.date, suiteVersion: lock.version, contender }) }
          catch (e) { d.log(`  runner error: ${(e as Error).message}`); r = erroredResult(cfg, t, effort, d.date, lock.version, contender, e) }
          // a limit Claude Code didn't report in the transcript: an errored, cost-less run while the guard is now tripped
          if (r.end === "errored" && !r.cost_usd && !(await d.safeGuard(cfg)).ok) r = { ...r, end: "limited" }
          if (r.end === "limited" && attempt < LIMIT_RETRIES) { d.log("  limited; retrying in 30 min"); await d.sleep(LIMIT_WAIT); continue }
          charge(r, effort, entry.cost_usd[effort])
          break
        }
      }
    }
    if (!reason && spentUsd * rate > ceiling) reason = `over ceiling (${(spentUsd * rate).toFixed(2)}% > ${ceiling}%)`

    const after = await d.readUsage().catch(() => null)
    const pct = Math.round(spentUsd * rate * 1000) / 1000
    const day = record({ cc_version: ccVersion, status: reason ? "incomplete" : "complete", incomplete_reason: reason, cost_usd: Math.round(spentUsd * 100) / 100, usage_pct_of_weekly: pct, usage_after: after?.seven_day ?? null })
    // refine the rate: clean only for an uninterrupted day whose weekly usage moved about as much as the bench explains
    if (usageBefore != null && after && spentUsd > 0) {
      const moved = after.seven_day - usageBefore
      const sameWindow = !beforeNow || sameWeek(beforeNow.seven_day_resets_at, after.seven_day_resets_at)
      addSample(paths(cfg).rate, { date: d.date, d_pct: moved, usd: spentUsd, clean: !reason && !resumed && sameWindow && moved > 0 && moved <= pct * 2 + 1 })
    }
    d.log(`${contenderId(contender)}: ${day.status}${reason ? ` (${reason})` : ""}, $${day.cost_usd} ≈ ${pct}% of the weekly limit`)
    days.push(day)
  }
  if (days.length) await d.publish(cfg, `results: ${cfg.machine} ${d.date}`, () => d.buildIndex(cfg))
  return days
}
