import { test } from "node:test"
import assert from "node:assert/strict"
import { loadTasks } from "./tasks.ts"
import { fixtureCfg } from "./test-helpers.ts"
import { makeRunDir, injectGrader, applyReference, removeRunDir } from "./workspace.ts"
import { runGrader, expandGrade } from "./grade.ts"

const task = (id: string) => loadTasks(fixtureCfg()).find((t) => t.id === id)!
async function graded(id: string, opts: { reference?: boolean; timeoutMs?: number } = {}) {
  const t = task(id), dir = await makeRunDir(t)
  if (opts.reference) await applyReference(t, dir)
  await injectGrader(t, dir)
  try { return await runGrader(t, dir, opts.timeoutMs) } finally { await removeRunDir(dir) }
}

test("parses last JSON line", async () => {
  const r = await graded("ok-task")
  assert.equal(r.total, 3); assert.equal(r.passed, 1); assert.equal(r.error, undefined)
  const ref = await graded("ok-task", { reference: true })
  assert.equal(ref.passed, 3)
})

test("grader crash is a fail, not an exception", async () => {
  const r = await graded("crash-task")
  assert.equal(r.passed, 0); assert.ok(r.total >= 1)
  assert.match(r.error ?? "", /exit/); assert.match(r.details, /boom/)
})

test("grader timeout", async () => {
  const r = await graded("sleep-task", { timeoutMs: 800 })
  assert.match(r.error ?? "", /timeout/); assert.equal(r.passed, 0)
})

test("placeholders {cli} and {python} are substituted", () => {
  const s = expandGrade("{python} x.py && node {cli} ui-grade c.json")
  assert.ok(!s.includes("{")); assert.match(s, /cli\.ts/)
})
