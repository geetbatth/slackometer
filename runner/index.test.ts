import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { defaults } from "./config.ts"
import { buildIndex, modelLabel } from "./index.ts"

// same expansion the site does (web/src/lib/data.ts)
function expand(c: { cols: string[]; intern: string[]; strings: string[]; rows: unknown[][] }) {
  const BOOL = new Set(["pass", "ran_tests", "verified_after_last_edit", "claimed_done"]); const intern = new Set(c.intern)
  return c.rows.map((row) => Object.fromEntries(c.cols.map((col, i) => {
    let v = row[i] as any
    if (intern.has(col)) v = c.strings[v]; else if (BOOL.has(col)) v = !!v
    else if (col === "ui_checks") v = v ? { builds: !!v[0], renders: !!v[1], console_errors: v[2], states_present: v[3] } : null
    return [col, v]
  })))
}
const put = (p: string, o: unknown) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(o)) }
const run = (date: string, task: string, over: object = {}) => ({
  schema: 1, date, machine: "m1", person: "p1", contender: "claude-code/claude-opus-5-5", effort: "high", task, bench: "core", task_version: 1, suite_version: 1,
  task_meta: { title: task + " title", language: "TypeScript", kind: "bug fix", difficulty: "easy", ui: false },
  pass: true, score: 1, tests_passed: 3, tests_total: 3, ui_checks: null, judge: null,
  output_tokens: 1000, input_tokens: 10, cache_read_tokens: 5, cache_write_tokens: 2, cost_usd: 0.5, tool_calls: 7, turns: 3, files_read: 2, files_read_before_first_edit: 1,
  ran_tests: true, verified_after_last_edit: false, minutes: 2.5, claimed_done: true, claim_text: "Done.", digest: "Read 2 files.", cc_version: "2.1.300", model_id: "claude-opus-5-5", end: "finished",
  started_at: "", finished_at: "", ...over,
})
function repoWithResults() {
  const repo = mkdtempSync(join(tmpdir(), "slk-idx-"))
  const R = join(repo, "results", "m1")
  put(join(R, "2026-11-02", "ts-a__high.json"), run("2026-11-02", "ts-a"))
  put(join(R, "2026-11-04", "ts-a__high.json"), run("2026-11-04", "ts-a", { cc_version: "2.1.316", pass: false, ran_tests: false, claimed_done: true }))
  put(join(R, "2026-11-04", "ui-b__high.json"), run("2026-11-04", "ui-b", { task_meta: { title: "UI B", language: "UI", kind: "ui design", difficulty: "medium", ui: true }, ui_checks: { builds: true, renders: true, console_errors: 2, states_present: 1 } }))
  put(join(R, "2026-11-04", "day.json"), { date: "2026-11-04", machine: "m1", contender: "claude-code/claude-opus-5-5", suite_version: 1, cc_version: "2.1.316", status: "complete", incomplete_reason: null, cost_usd: 1, usage_pct_of_weekly: 1.2, budget_pct: 2, ceiling_pct: 3, usage_before: 10, usage_after: 11 })
  put(join(R, "calibration-v1", "ts-a__high.json"), run("calibration-v1", "ts-a"))
  put(join(R, "suites", "claude-opus-5-5.v1.json"), { contender: "claude-code/claude-opus-5-5", machine: "m1", version: 1, calibrated_at: "2026-11-01", efforts: ["high"], tasks: [{ id: "ts-a", version: 1, cost_usd: {} }], allowance_usd: 10, rate_pct_per_usd: 0.1 })
  put(join(R, "rate.json"), { pct_per_usd: 0.1, samples: [] })
  return repo
}
const load = (repo: string) => { const src = readFileSync(join(repo, "site", "data", "runs.js"), "utf8"); return JSON.parse(src.slice(src.indexOf("=") + 1).trim().replace(/;$/, "")) }
const cfgFor = (repo: string) => ({ ...defaults(), machine: "m1", person: "p1", repo_dir: repo, tasks_dir: repo })

test("round-trips into the site's expand(): booleans and ui_checks survive; calibration runs are skipped", async () => {
  const repo = repoWithResults()
  const r = await buildIndex(cfgFor(repo), { now: () => new Date("2026-11-05T00:00:00Z") })
  assert.equal(r.runs, 3); assert.equal(r.days, 1)
  const d = load(repo)
  assert.equal(d.sample, false)
  const runs = expand(d.runs_compact)
  const late = runs.find((x) => x.date === "2026-11-04" && x.task === "ts-a")!
  assert.equal(late.pass, false); assert.equal(late.ran_tests, false); assert.equal(late.claimed_done, true)
  assert.deepEqual(runs.find((x) => x.task === "ui-b")!.ui_checks, { builds: true, renders: true, console_errors: 2, states_present: 1 })
  assert.ok(d.tasks.some((t: any) => t.id === "ui-b" && t.ui === true && t.title === "UI B"))
  assert.deepEqual(d.suites[0].tasks, ["ts-a"])
  assert.equal(d.run_days.length, 1); assert.equal(d.usage_rate, undefined)
})

test("CC version change becomes an event; calibration is an event too", async () => {
  const repo = repoWithResults()
  await buildIndex(cfgFor(repo), { now: () => new Date("2026-11-05T00:00:00Z") })
  const ev = load(repo).events
  assert.ok(ev.some((e: any) => e.date === "2026-11-04" && /2\.1\.316/.test(e.label)))
  assert.ok(ev.some((e: any) => e.date === "2026-11-01" && /calibrated/i.test(e.label)))
})

test("retired after 30 days without runs", async () => {
  const repo = repoWithResults()
  await buildIndex(cfgFor(repo), { now: () => new Date("2026-12-20T00:00:00Z") })
  assert.equal(load(repo).contenders[0].retired, true)
  await buildIndex(cfgFor(repo), { now: () => new Date("2026-11-20T00:00:00Z") })
  assert.equal(load(repo).contenders[0].retired, false)
})

test("model labels", () => {
  assert.equal(modelLabel("claude-opus-5-5"), "Opus 5.5")
  assert.equal(modelLabel("claude-fable-5-1"), "Fable 5.1")
  assert.equal(modelLabel("some-other"), "some-other")
})

test("effort levels keep their natural order (medium, high, xhigh), not alphabetical", async () => {
  const repo = repoWithResults()
  const R = join(repo, "results", "m1")
  put(join(R, "2026-11-04", "ts-a__medium.json"), run("2026-11-04", "ts-a", { effort: "medium" }))
  put(join(R, "2026-11-04", "ts-a__xhigh.json"), run("2026-11-04", "ts-a", { effort: "xhigh" }))
  await buildIndex(cfgFor(repo), { now: () => new Date("2026-11-05T00:00:00Z") })
  assert.deepEqual(load(repo).contenders[0].efforts, ["medium", "high", "xhigh"])
})

test("the site data never names a machine or a person", async () => {
  const repo = repoWithResults()
  await buildIndex(cfgFor(repo), { now: () => new Date("2026-11-05T00:00:00Z") })
  const raw = readFileSync(join(repo, "site", "data", "runs.js"), "utf8")
  assert.ok(!/"m1"|\bp1\b|, m1\)/.test(raw), "machine or person id leaked into runs.js")
  const d = load(repo)
  assert.deepEqual(d.machines.map((m: any) => m.id), ["Rig 1"])
  assert.ok(expand(d.runs_compact).every((r) => r.machine === "Rig 1"))
  assert.equal(d.suites[0].machine, "Rig 1")
  assert.equal(d.run_days[0].machine, "Rig 1")
  assert.ok(d.events.some((e: any) => /Rig 1/.test(e.label)))
})
