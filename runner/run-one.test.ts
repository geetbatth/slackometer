import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadTasks } from "./tasks.ts"
import { fixtureCfg } from "./test-helpers.ts"
import { runOne } from "./run-one.ts"
import type { RunClaude } from "./claude.ts"

const transcript = (f: string) => readFileSync(join(import.meta.dirname, "fixtures/transcripts", f), "utf8").split("\n").filter(Boolean)
const setup = () => {
  const repo = mkdtempSync(join(tmpdir(), "slk-repo-"))
  const cfg = { ...fixtureCfg(), repo_dir: repo }
  const t = loadTasks(cfg).find((x) => x.id === "ok-task")!
  return { cfg, t, ctx: { cfg, date: "2026-11-09", suiteVersion: 1, contender: cfg.contenders[0] } }
}

test("grader is injected only after claude exits; a fixed workspace passes", async () => {
  const { t, ctx } = setup()
  let sawPrompt = ""
  const fake: RunClaude = async (o) => {
    assert.ok(!existsSync(join(o.cwd, ".grader")), "grader visible to the model")
    sawPrompt = o.prompt
    writeFileSync(join(o.cwd, "add.mjs"), "export const add = (a, b) => a + b\n")
    return { exitCode: 0, timedOut: false, lines: transcript("verified.jsonl"), wallMs: 60_000, stderr: "" }
  }
  const r = await runOne(t, "high", { ...ctx, runClaude: fake })
  assert.match(sawPrompt, /Fix the add function/)
  assert.equal(r.pass, true); assert.equal(r.tests_passed, 3); assert.equal(r.score, 1)
  assert.equal(r.end, "finished"); assert.equal(r.effort, "high"); assert.equal(r.contender, "claude-code/claude-opus-5-5")
})

test("limited run is not graded and does not pass", async () => {
  const { t, ctx } = setup()
  const fake: RunClaude = async () => ({ exitCode: 1, timedOut: false, lines: transcript("limited.jsonl"), wallMs: 5000, stderr: "" })
  const r = await runOne(t, "medium", { ...ctx, runClaude: fake })
  assert.equal(r.end, "limited"); assert.equal(r.pass, false); assert.equal(r.tests_total, 0)
})

test("result file written with task_meta and no prompt text", async () => {
  const { cfg, t, ctx } = setup()
  const fake: RunClaude = async () => ({ exitCode: 0, timedOut: false, lines: transcript("no-tests.jsonl"), wallMs: 30_000, stderr: "" })
  await runOne(t, "xhigh", { ...ctx, runClaude: fake })
  const file = join(cfg.repo_dir, "results", "t", "2026-11-09", "ok-task__xhigh.json")
  const raw = readFileSync(file, "utf8"); const j = JSON.parse(raw)
  assert.deepEqual(j.task_meta, { title: "ok-task title", language: "JavaScript", kind: "bug fix", difficulty: "easy", ui: false })
  assert.equal(j.schema, 1); assert.equal(j.pass, false); assert.equal(j.ran_tests, false)
  assert.ok(!raw.includes("Fix the add function"), "prompt leaked into the public result")
  assert.ok(!("grade_details" in j), "hidden-test details must stay local")
  assert.ok(existsSync(join(cfg.repo_dir, "..", "never")) === false)
})
