import { test } from "node:test"
import assert from "node:assert/strict"
import { loadTasks } from "./tasks.ts"
import { fixtureCfg } from "./test-helpers.ts"
import { validateTask } from "./validate.ts"

const task = (id: string) => loadTasks(fixtureCfg()).find((t) => t.id === id)!

test("validate ok: untouched fails, reference passes all", async () => {
  const v = await validateTask(task("ok-task"))
  assert.equal(v.ok, true, v.problems.join("; "))
  assert.ok(v.untouched.passed < v.untouched.total)
  assert.equal(v.reference.passed, v.reference.total)
})

test("validate flags a grader that crashes", async () => {
  const v = await validateTask(task("crash-task"))
  assert.equal(v.ok, false)
  assert.ok(v.problems.some((p) => /reference/.test(p)))
})
