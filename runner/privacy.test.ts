// Usage and budget numbers describe the person's subscription: they stay on their machine, never in results/ or the site data.
import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fixtureCfg } from "./test-helpers.ts"
import { paths } from "./config.ts"
import { runDay } from "./batch.ts"
import { calibrate } from "./calibrate.ts"
import { buildIndex } from "./index.ts"
import { resultPath } from "./run-one.ts"
import type { Effort, LocalConfig, RunResult, TaskDef } from "./types.ts"

const PRIVATE = /usage_before|usage_after|usage_pct_of_weekly|budget_pct|ceiling_pct|rate_pct_per_usd|allowance_usd|pct_per_usd|usage_rate/
const put = (p: string, o: unknown) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(o)) }
const walk = (d: string): string[] => (existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)])) : [])
const DATE = "2026-11-09"

function calibrated() {
  const repo = mkdtempSync(join(tmpdir(), "slk-priv-"))
  const base = fixtureCfg()
  const cfg: LocalConfig = { ...base, repo_dir: repo, exclude_tasks: ["crash-task", "sleep-task"], budget: { ...base.budget, percent_of_weekly_per_run: 20, ceiling_percent_of_weekly_per_run: 30 } }
  return cfg
}
async function doCalibrate(cfg: LocalConfig) {
  let week = 20
  return calibrate(cfg, cfg.contenders[0], { yes: true, deps: {
    runOne: async (t, e) => { week += 2; return { task: t.id, effort: e, cost_usd: 2, end: "finished" } as never },
    readUsage: async () => ({ five_hour: 10, seven_day: week, seven_day_resets_at: "r", extra_usage_enabled: false }),
    withQuiet: async (_c, fn) => fn(), today: () => "2026-11-05", log: () => {}, sleep: async () => {},
  } as never })
}

test("calibration keeps the rate and dollar allowance local; results/ only gets a suite summary", async () => {
  const cfg = calibrated()
  const lock = await doCalibrate(cfg)
  assert.ok(lock && lock.rate_pct_per_usd > 0 && lock.allowance_usd > 0)
  const pub = walk(join(cfg.repo_dir, "results")).filter((f) => !/calibration-v/.test(f))
  assert.ok(pub.some((f) => /suites[\\/]claude-opus-5-5\.v1\.json$/.test(f)), pub.join(","))
  for (const f of pub) assert.doesNotMatch(readFileSync(f, "utf8"), PRIVATE, f)
  assert.ok(existsSync(paths(cfg).rate))
})

test("a run day's public day.json has no usage numbers; the local copy keeps them", async () => {
  const cfg = calibrated()
  await doCalibrate(cfg)
  const write = (t: TaskDef, e: Effort) => { const r = { date: DATE, task: t.id, effort: e, end: "finished", cost_usd: 1, cc_version: "x", pass: true } as RunResult; put(resultPath(cfg, DATE, t.id, e), r); return r }
  const [day] = await runDay(cfg, { date: DATE, now: () => new Date(`${DATE}T03:00:00`), readUsage: async () => ({ five_hour: 10, seven_day: 40, seven_day_resets_at: "r", extra_usage_enabled: false }),
    safeGuard: async () => ({ ok: true, reason: "", usage: null }), sleep: async () => {}, publish: async () => {}, buildIndex: async () => ({ runs: 0, days: 0 }), log: () => {}, runOne: async (t, e) => write(t, e) })
  assert.ok(day.usage_pct_of_weekly > 0) // the returned (local) record still has it
  const pubDay = readFileSync(join(cfg.repo_dir, "results", "t", DATE, "day.json"), "utf8")
  assert.doesNotMatch(pubDay, PRIVATE)
  assert.match(pubDay, /"status"/)
  assert.ok(readdirSync(paths(cfg).days).length >= 1)
  for (const f of walk(join(cfg.repo_dir, "results"))) assert.doesNotMatch(readFileSync(f, "utf8"), PRIVATE, f)
})

test("the site data carries no usage or budget numbers", async () => {
  const cfg = calibrated()
  await doCalibrate(cfg)
  put(join(cfg.repo_dir, "results/t", DATE, "day.json"), { date: DATE, machine: "t", contender: "claude-code/claude-opus-5-5", suite_version: 1, cc_version: "x", status: "complete", incomplete_reason: null, cost_usd: 3, usage_pct_of_weekly: 1.7, budget_pct: 2 })
  await buildIndex(cfg)
  assert.doesNotMatch(readFileSync(join(cfg.repo_dir, "site/data/runs.js"), "utf8"), PRIVATE)
})
