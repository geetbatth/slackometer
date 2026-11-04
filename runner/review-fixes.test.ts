// Regression tests for the final-review findings (C1, I1-I5, I7, I8).
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { defaults, paths } from "./config.ts"
import { fixtureCfg } from "./test-helpers.ts"
import { buildIndex } from "./index.ts"
import { runDay } from "./batch.ts"
import { resultPath } from "./run-one.ts"
import { calibrate } from "./calibrate.ts"
import { publish } from "./publish.ts"
import { acquireRunLock } from "./lock.ts"
import { parseTranscript } from "./transcript.ts"
import { currentRate } from "./usage.ts"
import type { Effort, LocalConfig, RunResult, SuiteLock, TaskDef } from "./types.ts"

const put = (p: string, o: unknown) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, typeof o === "string" ? o : JSON.stringify(o)) }
const DATE = "2026-11-09"

// ---------- C1: limited runs never reach the site's aggregates
test("C1 index excludes limited runs from runs_compact", async () => {
  const repo = mkdtempSync(join(tmpdir(), "slk-c1-"))
  const base = { schema: 1, date: DATE, machine: "m1", person: "p", contender: "claude-code/claude-opus-5-5", task: "a", bench: "core", task_version: 1, suite_version: 1, task_meta: { title: "A", language: "TS", kind: "bug fix", difficulty: "easy", ui: false }, ui_checks: null, cc_version: "2.1.316", pass: true, end: "finished" }
  put(join(repo, "results/m1", DATE, "a__high.json"), { ...base, effort: "high" })
  put(join(repo, "results/m1", DATE, "a__medium.json"), { ...base, effort: "medium", pass: false, end: "limited" })
  const r = await buildIndex({ ...defaults(), machine: "m1", person: "p", repo_dir: repo, tasks_dir: repo })
  assert.equal(r.runs, 1)
})

// ---------- batch helpers
function dayRepo(rate = 0.1) {
  const repo = mkdtempSync(join(tmpdir(), "slk-rf-"))
  const cfg: LocalConfig = { ...fixtureCfg(), repo_dir: repo, exclude_tasks: ["crash-task", "sleep-task"] }
  const lock: SuiteLock = { contender: "claude-code/claude-opus-5-5", machine: "t", version: 1, calibrated_at: "2026-11-05", efforts: ["medium", "high", "xhigh"], tasks: [{ id: "ok-task", version: 1, cost_usd: { medium: 5, high: 5, xhigh: 5 } }], allowance_usd: 20, rate_pct_per_usd: rate }
  put(join(paths(cfg).locks, "claude-opus-5-5.v1.json"), lock)
  return cfg
}
const write = (cfg: LocalConfig, t: TaskDef, e: Effort, over: Partial<RunResult> = {}): RunResult => {
  const r = { date: DATE, task: t.id, effort: e, end: "finished", cost_usd: 1, cc_version: "x", pass: true, ...over } as RunResult
  put(resultPath(cfg, DATE, t.id, e), r); return r
}
const deps = () => ({ date: DATE, now: () => new Date(`${DATE}T03:00:00`), readUsage: async () => ({ five_hour: 10, seven_day: 20, seven_day_resets_at: "r", extra_usage_enabled: false }),
  safeGuard: async () => ({ ok: true, reason: "", usage: null }), sleep: async () => {}, publish: async () => {}, buildIndex: async () => ({ runs: 0, days: 0 }), log: () => {} })

// ---------- I1: a run that dies without a cost still counts toward the ceiling
test("I1 timeout with $0 is charged the calibrated cost, so the ceiling still stops spending", async () => {
  const cfg = dayRepo(0.2) // calibrated $5/run -> 1% each; ceiling 3%
  let calls = 0
  const [day] = await runDay(cfg, { ...deps(), runOne: async (t, e) => { calls++; return write(cfg, t, e, { end: "timeout", cost_usd: 0, pass: false }) } })
  assert.equal(day.status, "complete") // 3 x 1% = 3% only reached after the last run
  assert.ok(day.usage_pct_of_weekly >= 2.99, String(day.usage_pct_of_weekly))
  const cfg2 = dayRepo(0.3) // 1.5% each -> stops after 2
  let c2 = 0
  const [d2] = await runDay(cfg2, { ...deps(), runOne: async (t, e) => { c2++; return write(cfg2, t, e, { end: "timeout", cost_usd: 0, pass: false }) } })
  assert.equal(c2, 2); assert.equal(d2.status, "incomplete")
  assert.equal(calls, 3)
})

// ---------- I2: one bench process at a time
test("I2 run lock: a second holder is refused while the first is alive; a stale lock is taken over", async () => {
  const sp = join(mkdtempSync(join(tmpdir(), "slk-lock-")), "running.json")
  const release = acquireRunLock("run", sp)
  assert.throws(() => acquireRunLock("calibrate", sp), /already running/)
  release()
  // stale: a pid that has exited
  const child = spawn(process.execPath, ["-e", "0"]); await new Promise((r) => child.on("exit", r))
  put(sp, { pid: child.pid, command: "run", since: "x" })
  const r2 = acquireRunLock("run", sp); r2()
  assert.ok(!existsSync(sp))
})

// ---------- I3: calibration waits on the guard and resumes an unfinished calibration
test("I3 calibration waits when the guard trips instead of aborting, and resumes finished runs", async () => {
  const repo = mkdtempSync(join(tmpdir(), "slk-i3-"))
  const base = fixtureCfg()
  const cfg = { ...base, repo_dir: repo, exclude_tasks: ["crash-task", "sleep-task"], budget: { ...base.budget, percent_of_weekly_per_run: 20, ceiling_percent_of_weekly_per_run: 30 } }
  // an unfinished calibration v1: medium already done
  put(join(repo, "results/t/calibration-v1/ok-task__medium.json"), { task: "ok-task", effort: "medium", end: "finished", cost_usd: 2 })
  let week = 20, reads = 0, sleeps = 0
  const ran: string[] = []
  const lock = await calibrate(cfg, cfg.contenders[0], { yes: true, deps: {
    runOne: async (t, e) => { ran.push(e); week += 2; return { task: t.id, effort: e, cost_usd: 2, end: "finished" } as never },
    readUsage: async () => { reads++; return { five_hour: reads === 3 ? 95 : 10, seven_day: week, seven_day_resets_at: "r", extra_usage_enabled: false } },
    withQuiet: async (_c, fn) => fn(), today: () => "2026-11-05", log: () => {}, sleep: async () => { sleeps++ },
  } as never })
  assert.deepEqual(ran, ["high", "xhigh"]); assert.ok(sleeps >= 1); assert.equal(lock!.version, 1)
})

// ---------- I4: two machines regenerate runs.js and still both publish
test("I4 publish rebuilds the index after pulling, so a runs.js race doesn't block the push", async () => {
  const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  const remote = mkdtempSync(join(tmpdir(), "slk-r-")); git(remote, "init", "-q", "--bare", "-b", "main")
  const mk = (n: string) => { const d = join(mkdtempSync(join(tmpdir(), "slk-c-")), n); git(tmpdir(), "clone", "-q", remote, d); git(d, "config", "user.email", "t@e.x"); git(d, "config", "user.name", "t"); return d }
  const a = mk("a"); put(join(a, "site/data/runs.js"), "v0"); git(a, "add", "."); git(a, "commit", "-qm", "init"); git(a, "push", "-q", "origin", "main")
  const b = mk("b")
  put(join(b, "results/mb/x.json"), "{}"); put(join(b, "site/data/runs.js"), "built by b"); git(b, "add", "."); git(b, "commit", "-qm", "b"); git(b, "push", "-q", "origin", "main")
  put(join(a, "results/ma/y.json"), "{}")
  let rebuilds = 0
  await publish({ ...defaults(), machine: "ma", person: "t", repo_dir: a }, "ma results", async () => { rebuilds++; put(join(a, "site/data/runs.js"), `built by a after ${rebuilds} rebuild(s); sees b: ${existsSync(join(a, "results/mb/x.json"))}`) })
  const remoteRuns = git(remote, "show", "main:site/data/runs.js")
  assert.match(remoteRuns, /sees b: true/)
  assert.match(git(remote, "log", "--format=%s", "main"), /ma results/)
})

// ---------- I5: a crash inside one run doesn't lose the day
test("I5 a run that throws is recorded as errored and the batch continues; day.json exists while running", async () => {
  const cfg = dayRepo()
  let sawInProgress = false
  const [day] = await runDay(cfg, { ...deps(), runOne: async (t, e) => {
    sawInProgress ||= existsSync(join(cfg.repo_dir, "results/t", DATE, "day.json")) && JSON.parse(readFileSync(join(cfg.repo_dir, "results/t", DATE, "day.json"), "utf8")).status === "incomplete"
    if (e === "high") throw new Error("disk full")
    return write(cfg, t, e)
  } })
  assert.ok(sawInProgress)
  assert.equal(JSON.parse(readFileSync(resultPath(cfg, DATE, "ok-task", "high"), "utf8")).end, "errored")
  assert.ok(existsSync(resultPath(cfg, DATE, "ok-task", "xhigh")))
  assert.equal(day.status, "complete")
})

// ---------- I7: bad rate samples
test("I7 calibration never stores a non-positive delta as clean and refuses a zero-task lock", async () => {
  const repo = mkdtempSync(join(tmpdir(), "slk-i7-"))
  const cfg = { ...fixtureCfg(), repo_dir: repo, exclude_tasks: ["crash-task", "sleep-task"] }
  let n = 0
  await assert.rejects(calibrate(cfg, cfg.contenders[0], { yes: true, deps: {
    runOne: async (t, e) => ({ task: t.id, effort: e, cost_usd: 2, end: "finished" }) as never,
    readUsage: async () => ({ five_hour: 10, seven_day: n++ === 0 ? 80 : 3, seven_day_resets_at: n > 1 ? "reset2" : "reset1", extra_usage_enabled: false }),
    withQuiet: async (_c, fn) => fn(), today: () => "2026-11-05", log: () => {}, sleep: async () => {},
  } as never }), /rate|reset/i)
  assert.equal(currentRate(paths(cfg).rate), null)
  assert.ok(!existsSync(join(paths(cfg).locks, "claude-opus-5-5.v1.json")))
})

test("I7 a resumed run day's rate sample is not clean", async () => {
  const cfg = dayRepo()
  write(cfg, { id: "ok-task" } as TaskDef, "medium")
  await runDay(cfg, { ...deps(), readUsage: (() => { let k = 0; return async () => ({ five_hour: 10, seven_day: 20 + k++, seven_day_resets_at: "r", extra_usage_enabled: false }) })(),
    runOne: async (t, e) => write(cfg, t, e) })
  const rate = JSON.parse(readFileSync(paths(cfg).rate, "utf8"))
  assert.equal(rate.samples.at(-1).clean, false)
})

// ---------- I8: limits reported on stderr / via usage
test("I8 a limit reported only on stderr is limited", () => {
  const m = parseTranscript([], { test_command_hints: [] }, 1000, false, "Error: Claude AI usage limit reached")
  assert.equal(m.end, "limited")
})
test("I8 an errored $0 run while the guard is tripped is treated as limited and retried", async () => {
  const cfg = dayRepo(); let n = 0, g = 0
  await runDay(cfg, { ...deps(),
    safeGuard: async () => (g++ === 1 ? { ok: false, reason: "5-hour usage at 100%", usage: null } : { ok: true, reason: "", usage: null }),
    runOne: async (t, e) => (e === "medium" && n++ === 0 ? write(cfg, t, e, { end: "errored", cost_usd: 0, pass: false }) : write(cfg, t, e)) })
  assert.equal(JSON.parse(readFileSync(resultPath(cfg, DATE, "ok-task", "medium"), "utf8")).end, "finished")
})
