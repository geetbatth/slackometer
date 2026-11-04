import { test } from "node:test"
import assert from "node:assert/strict"
import { cpSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadTasks, missingTools } from "./tasks.ts"

import { FIXTURE_TASKS, fixtureCfg } from "./test-helpers.ts"

test("loads fixture tasks with dir set", () => {
  const ts = loadTasks(fixtureCfg())
  assert.deepEqual(ts.map((t) => t.id).sort(), ["crash-task", "ok-task", "sleep-task"])
  assert.ok(ts.every((t) => t.bench === "demo" && t.dir.endsWith(t.id)))
})

test("exclude_tasks skips tasks", () => {
  assert.equal(loadTasks({ ...fixtureCfg(), exclude_tasks: ["sleep-task"] }).length, 2)
})

test("duplicate id throws", () => {
  const root = mkdtempSync(join(tmpdir(), "slk-dup-"))
  cpSync(join(FIXTURE_TASKS, "benches"), join(root, "benches"), { recursive: true })
  cpSync(join(root, "benches/demo/tasks/ok-task"), join(root, "benches/demo/tasks/ok-task-copy"), { recursive: true })
  assert.throws(() => loadTasks({ ...fixtureCfg(), tasks_dir: root }), /duplicate task id "ok-task"/)
})

test("missing field throws naming it", () => {
  const root = mkdtempSync(join(tmpdir(), "slk-bad-"))
  cpSync(join(FIXTURE_TASKS, "benches"), join(root, "benches"), { recursive: true })
  writeFileSync(join(root, "benches/demo/tasks/ok-task/task.json"), JSON.stringify({ id: "ok-task" }))
  assert.throws(() => loadTasks({ ...fixtureCfg(), tasks_dir: root }), /ok-task.*title/s)
})

test("missingTools reports unknown tools", () => {
  const t = loadTasks(fixtureCfg())[0]
  assert.deepEqual(missingTools({ ...t, required_tools: ["node"] }), [])
  assert.deepEqual(missingTools({ ...t, required_tools: ["definitely-not-a-tool-xyz"] }), ["definitely-not-a-tool-xyz"])
})
