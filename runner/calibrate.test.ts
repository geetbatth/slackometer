import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { selectSuite, calibrate } from "./calibrate.ts"
import { fixtureCfg } from "./test-helpers.ts"
import { paths } from "./config.ts"
import type { Effort, TaskDef } from "./types.ts"

const T = (id: string, language: string, difficulty: TaskDef["difficulty"]) => ({ id, language, difficulty } as TaskDef)
const cost = (n: number) => ({ medium: n, high: n, xhigh: n } as Record<Effort, number>)
function pool() {
  const m = new Map<string, { task: TaskDef; usd: Record<Effort, number> }>()
  const add = (id: string, lang: string, d: TaskDef["difficulty"], c: number) => m.set(id, { task: T(id, lang, d), usd: cost(c) })
  add("ts-1", "TypeScript", "easy", 0.5); add("ts-2", "TypeScript", "medium", 0.6); add("ts-3", "TypeScript", "hard", 1.0)
  add("py-1", "Python", "easy", 0.4); add("py-2", "Python", "hard", 1.2)
  add("cs-1", "C#", "medium", 0.7); add("ui-1", "UI", "easy", 0.9)
  return m
}
const sum = (ids: string[]) => ids.reduce((a, id) => a + pool().get(id)!.usd.medium * 3, 0)

test("selectSuite respects planTo x allowance", () => {
  const ids = selectSuite(pool(), 10, 0.75)
  assert.ok(sum(ids) <= 7.5 + 1e-9, `sum ${sum(ids)}`)
  assert.ok(ids.length >= 3)
})
test("selectSuite spreads across languages before doubling up", () => {
  const ids = selectSuite(pool(), 10, 0.75)
  const langs = new Set(ids.map((id) => pool().get(id)!.task.language))
  assert.equal(langs.size, 4, ids.join(","))
})
test("selectSuite is deterministic and prefers easy first within a language", () => {
  assert.deepEqual(selectSuite(pool(), 10, 0.75), selectSuite(pool(), 10, 0.75))
  assert.ok(selectSuite(pool(), 10, 0.75).includes("py-1"))
})
test("selectSuite with a huge allowance takes everything", () => {
  assert.equal(selectSuite(pool(), 1000, 0.75).length, 7)
})

test("calibrate refuses without --yes and runs nothing", async () => {
  const repo = mkdtempSync(join(tmpdir(), "slk-cal-"))
  const cfg = { ...fixtureCfg(), repo_dir: repo, exclude_tasks: ["crash-task", "sleep-task"] }
  let runs = 0
  const lock = await calibrate(cfg, cfg.contenders[0], { yes: false, deps: { runOne: async () => { runs++; throw new Error("should not run") } } as never })
  assert.equal(lock, null); assert.equal(runs, 0)
  assert.ok(!existsSync(join(repo, "results")) || readdirSync(join(repo, "results")).length === 0)
})

test("calibrate with --yes runs every task x level, derives the rate and writes a lock", async () => {
  const repo = mkdtempSync(join(tmpdir(), "slk-cal-"))
  const base = fixtureCfg()
  const cfg = { ...base, repo_dir: repo, exclude_tasks: ["crash-task", "sleep-task"], budget: { ...base.budget, percent_of_weekly_per_run: 20, ceiling_percent_of_weekly_per_run: 30 } }
  const seen: string[] = []
  let week = 20
  const lock = await calibrate(cfg, cfg.contenders[0], { yes: true, deps: {
    runOne: async (t, effort) => { seen.push(`${t.id}/${effort}`); week += 2; return { cost_usd: 2, end: "finished" } as never },
    readUsage: async () => ({ five_hour: 10, seven_day: week, seven_day_resets_at: "", extra_usage_enabled: false }),
    withQuiet: async (_c, fn) => fn(),
    today: () => "2026-11-05",
  } })
  assert.deepEqual(seen.sort(), ["ok-task/high", "ok-task/medium", "ok-task/xhigh"])
  assert.ok(lock)
  assert.equal(lock!.rate_pct_per_usd, 1)          // 6 points over $6
  assert.equal(lock!.allowance_usd, 20)             // 20% / 1 %-per-$ (task fits: $6 <= 0.75 x $20)
  assert.deepEqual(lock!.tasks.map((t) => t.id), ["ok-task"])
  assert.equal(lock!.version, 1)
  assert.ok(existsSync(join(paths(cfg).locks, "claude-opus-5-5.v1.json")))
  assert.ok(existsSync(join(repo, "results", "t", "suites", "claude-opus-5-5.v1.json"))) // public summary
})

test("calibrate --parallel runs each task x level once, never more than N at a time", async () => {
  const repo = mkdtempSync(join(tmpdir(), "slk-calp-"))
  const base = fixtureCfg()
  const cfg = { ...base, repo_dir: repo, exclude_tasks: ["crash-task", "sleep-task"], budget: { ...base.budget, percent_of_weekly_per_run: 20, ceiling_percent_of_weekly_per_run: 30 } }
  const seen: string[] = []
  let week = 20, live = 0, peak = 0
  const lock = await calibrate(cfg, cfg.contenders[0], { yes: true, parallel: 2, deps: {
    runOne: async (t, effort) => {
      live++; peak = Math.max(peak, live)
      await new Promise((r) => setTimeout(r, 20))
      live--; seen.push(`${t.id}/${effort}`); week += 2
      return { task: t.id, effort, cost_usd: 2, end: "finished" } as never
    },
    readUsage: async () => ({ five_hour: 10, seven_day: week, seven_day_resets_at: "", extra_usage_enabled: false }),
    withQuiet: async (_c, fn) => fn(),
    today: () => "2026-11-05",
  } })
  assert.deepEqual(seen.sort(), ["ok-task/high", "ok-task/medium", "ok-task/xhigh"])
  assert.equal(peak, 2)
  assert.equal(lock!.rate_pct_per_usd, 1)
})

test("relock re-picks the suite at a new budget without running anything, until the suite has run days", async () => {
  const { relock } = await import("./calibrate.ts")
  const { mkdirSync, writeFileSync, readFileSync } = await import("node:fs")
  const repo = mkdtempSync(join(tmpdir(), "slk-rel-"))
  const base = fixtureCfg()
  const cfg = { ...base, repo_dir: repo, exclude_tasks: ["crash-task", "sleep-task"], budget: { ...base.budget, percent_of_weekly_per_run: 20, ceiling_percent_of_weekly_per_run: 30 } }
  let week = 20
  await calibrate(cfg, cfg.contenders[0], { yes: true, deps: {
    runOne: async (t, effort) => { week += 2; const r = { schema: 1, task: t.id, effort, cost_usd: 2, end: "finished" }; mkdirSync(join(paths(cfg).machineResults, "calibration-v1"), { recursive: true }); writeFileSync(join(paths(cfg).machineResults, "calibration-v1", `${t.id}__${effort}.json`), JSON.stringify(r)); return r as never },
    readUsage: async () => ({ five_hour: 10, seven_day: week, seven_day_resets_at: "", extra_usage_enabled: false }),
    withQuiet: async (_c, fn) => fn(), today: () => "2026-11-05",
  } })
  const tight = { ...cfg, budget: { ...cfg.budget, percent_of_weekly_per_run: 1 } }
  assert.throws(() => relock(tight, cfg.contenders[0], () => {}), /no task fits/)
  const lock = relock({ ...cfg, budget: { ...cfg.budget, percent_of_weekly_per_run: 40 } }, cfg.contenders[0], () => {})
  assert.equal(lock.version, 1); assert.equal(lock.allowance_usd, 40)
  assert.equal(JSON.parse(readFileSync(join(paths(cfg).locks, "claude-opus-5-5.v1.json"), "utf8")).allowance_usd, 40)
  // once a run day used suite v1, relocking it is refused
  mkdirSync(join(paths(cfg).machineResults, "2026-11-09"), { recursive: true })
  writeFileSync(join(paths(cfg).machineResults, "2026-11-09", "ok-task__high.json"), JSON.stringify({ contender: lock.contender, suite_version: 1 }))
  assert.throws(() => relock(cfg, cfg.contenders[0], () => {}), /already has run days/)
})
