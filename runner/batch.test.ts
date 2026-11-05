import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fixtureCfg } from "./test-helpers.ts"
import { runDay } from "./batch.ts"
import { paths } from "./config.ts"
import { resultPath } from "./run-one.ts"
import type { Effort, LocalConfig, RunResult, SuiteLock, TaskDef } from "./types.ts"

const DATE = "2026-11-09"
function setup(rate = 0.1) {
  const repo = mkdtempSync(join(tmpdir(), "slk-day-"))
  const cfg: LocalConfig = { ...fixtureCfg(), repo_dir: repo, exclude_tasks: ["crash-task", "sleep-task"] }
  const lock: SuiteLock = { contender: "claude-code/claude-opus-5-5", machine: "t", version: 2, calibrated_at: "2026-11-05", efforts: ["medium", "high", "xhigh"], tasks: [{ id: "ok-task", version: 1, cost_usd: { medium: 1, high: 1, xhigh: 1 } }], allowance_usd: 20, rate_pct_per_usd: rate }
  const lp = join(paths(cfg).locks, "claude-opus-5-5.v2.json")
  mkdirSync(dirname(lp), { recursive: true }); writeFileSync(lp, JSON.stringify(lock))
  return cfg
}
const fakeResult = (cfg: LocalConfig, t: TaskDef, effort: Effort, end: RunResult["end"] = "finished", cost = 1): RunResult => {
  const r = { date: DATE, task: t.id, effort, end, cost_usd: cost, cc_version: "2.1.316", pass: end === "finished" } as RunResult
  mkdirSync(dirname(resultPath(cfg, DATE, t.id, effort)), { recursive: true })
  writeFileSync(resultPath(cfg, DATE, t.id, effort), JSON.stringify(r))
  return r
}
const usage = (seven_day = 20) => async () => ({ five_hour: 10, seven_day, seven_day_resets_at: "", extra_usage_enabled: false })
const okGuard = async () => ({ ok: true, reason: "", usage: null })
const early = () => new Date(`${DATE}T03:00:00`)
const base = (cfg: LocalConfig) => ({ date: DATE, now: early, readUsage: usage(), safeGuard: okGuard, sleep: async () => {}, publish: async () => {}, buildIndex: async () => ({ runs: 0, days: 0 }), log: () => {} })

test("runs every task x level and writes day.json", async () => {
  const cfg = setup(); const calls: string[] = []
  const [day] = await runDay(cfg, { ...base(cfg), runOne: async (t, e) => { calls.push(`${t.id}/${e}`); return fakeResult(cfg, t, e) } })
  assert.deepEqual(calls, ["ok-task/medium", "ok-task/high", "ok-task/xhigh"])
  assert.equal(day.status, "complete"); assert.equal(day.suite_version, 2); assert.equal(day.cost_usd, 3)
  assert.ok(Math.abs(day.usage_pct_of_weekly - 0.3) < 1e-9)
  const saved = JSON.parse(readFileSync(join(cfg.repo_dir, "results", "t", DATE, "day.json"), "utf8"))
  assert.equal(saved.status, "complete")
})

test("resume skips finished runs", async () => {
  const cfg = setup(); const calls: string[] = []
  const t = { id: "ok-task" } as TaskDef
  fakeResult(cfg, t, "medium"); fakeResult(cfg, t, "high")
  await runDay(cfg, { ...base(cfg), runOne: async (tt, e) => { calls.push(e); return fakeResult(cfg, tt, e) } })
  assert.deepEqual(calls, ["xhigh"])
})

test("limited run is retried, not failed", async () => {
  const cfg = setup(); let n = 0; const sleeps: number[] = []
  const [day] = await runDay(cfg, { ...base(cfg), sleep: async (ms) => { sleeps.push(ms) },
    runOne: async (t, e) => fakeResult(cfg, t, e, e === "high" && n++ === 0 ? "limited" : "finished") })
  assert.equal(n, 2); assert.ok(sleeps.includes(30 * 60_000))
  assert.equal(JSON.parse(readFileSync(resultPath(cfg, DATE, "ok-task", "high"), "utf8")).end, "finished")
  assert.equal(day.status, "complete")
})

test("stops at ceiling and marks incomplete", async () => {
  const cfg = setup(2) // $1 -> 2% each run; ceiling 3%
  const calls: string[] = []
  const [day] = await runDay(cfg, { ...base(cfg), runOne: async (t, e) => { calls.push(e); return fakeResult(cfg, t, e) } })
  assert.equal(calls.length, 2); assert.equal(day.status, "incomplete"); assert.match(day.incomplete_reason ?? "", /ceiling/)
})

test("cut-off marks incomplete", async () => {
  const cfg = setup(); let calls = 0
  const [day] = await runDay(cfg, { ...base(cfg), now: () => new Date(`${DATE}T23:59:30`), runOne: async (t, e) => { calls++; return fakeResult(cfg, t, e) } })
  assert.equal(calls, 0); assert.equal(day.status, "incomplete"); assert.match(day.incomplete_reason ?? "", /cut-off/)
})

test("guard failure waits instead of running", async () => {
  const cfg = setup(); let g = 0; const sleeps: number[] = []
  const [day] = await runDay(cfg, { ...base(cfg), sleep: async (ms) => { sleeps.push(ms) },
    safeGuard: async () => (g++ === 0 ? { ok: false, reason: "5-hour usage at 95%", usage: null } : { ok: true, reason: "", usage: null }),
    runOne: async (t, e) => fakeResult(cfg, t, e) })
  assert.ok(sleeps.includes(20 * 60_000)); assert.equal(day.status, "complete")
})

test("no lock means nothing runs", async () => {
  const cfg = { ...setup(), contenders: [{ tool: "claude-code" as const, model: "other-model", efforts: ["high" as Effort] }] }
  let calls = 0
  const days = await runDay(cfg, { ...base(cfg), runOne: async (t, e) => { calls++; return fakeResult(cfg, t, e) } })
  assert.equal(calls, 0); assert.equal(days.length, 0)
})

test("runs several at once (cfg.parallel) and still finishes the whole suite", async () => {
  const cfg = { ...setup(), parallel: 3 }; let live = 0, peak = 0
  const [day] = await runDay(cfg, { ...base(cfg), runOne: async (t, e) => {
    live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 20)); live--
    return fakeResult(cfg, t, e)
  } })
  assert.equal(peak, 3); assert.equal(day.status, "complete"); assert.equal(day.cost_usd, 3)
})

test("one at a time when parallel is 1", async () => {
  const cfg = { ...setup(), parallel: 1 }; let live = 0, peak = 0
  await runDay(cfg, { ...base(cfg), runOne: async (t, e) => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 5)); live--; return fakeResult(cfg, t, e) } })
  assert.equal(peak, 1)
})
