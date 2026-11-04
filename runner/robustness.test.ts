import { test } from "node:test"
import assert from "node:assert/strict"
import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run } from "./proc.ts"
import { loadTasks } from "./tasks.ts"
import { FIXTURE_TASKS, fixtureCfg } from "./test-helpers.ts"
import { makeRunDir, removeRunDir } from "./workspace.ts"
import { validateTask } from "./validate.ts"

test("a command that reads stdin does not hang when there is no input", async () => {
  const r = await run(process.execPath, ["-e", "process.stdin.resume(); process.stdin.on('end', () => console.log('eof'))"], { timeoutMs: 5000 })
  assert.equal(r.timedOut, false); assert.match(r.stdout, /eof/)
})

test("validate fails a task whose grader crashes on the untouched workspace", async () => {
  const root = mkdtempSync(join(tmpdir(), "slk-v-"))
  cpSync(join(FIXTURE_TASKS, "benches"), join(root, "benches"), { recursive: true })
  // grader crashes unless the reference file is present
  writeFileSync(join(root, "benches/demo/tasks/ok-task/grader/grade.mjs"), `import { existsSync } from "node:fs"\nif (!existsSync("ref-marker")) process.exit(4)\nconsole.log(JSON.stringify({ passed: 1, total: 1 }))\n`)
  writeFileSync(join(root, "benches/demo/tasks/ok-task/grader/reference/ref-marker"), "x")
  const t = loadTasks({ ...fixtureCfg(), tasks_dir: root }).find((x) => x.id === "ok-task")!
  const v = await validateTask(t)
  assert.equal(v.ok, false); assert.ok(v.problems.some((p) => /untouched.*(crash|no result|exit)/i.test(p)), v.problems.join("; "))
})

test("invalid task.json names the file", () => {
  const root = mkdtempSync(join(tmpdir(), "slk-j-"))
  cpSync(join(FIXTURE_TASKS, "benches"), join(root, "benches"), { recursive: true })
  writeFileSync(join(root, "benches/demo/tasks/ok-task/task.json"), "{ not json")
  assert.throws(() => loadTasks({ ...fixtureCfg(), tasks_dir: root }), /ok-task[\\/]task\.json/)
})

test("build output and caches in a workspace are not copied to the run folder", async () => {
  const root = mkdtempSync(join(tmpdir(), "slk-b-"))
  cpSync(join(FIXTURE_TASKS, "benches"), join(root, "benches"), { recursive: true })
  for (const d of ["bin", "obj", "node_modules", "__pycache__"]) { mkdirSync(join(root, "benches/demo/tasks/ok-task/workspace", d)); writeFileSync(join(root, "benches/demo/tasks/ok-task/workspace", d, "x"), "x") }
  const t = loadTasks({ ...fixtureCfg(), tasks_dir: root }).find((x) => x.id === "ok-task")!
  const dir = await makeRunDir(t)
  for (const d of ["bin", "obj", "node_modules", "__pycache__"]) assert.ok(!existsSync(join(dir, d)), d)
  assert.ok(existsSync(join(dir, "add.mjs")))
  await removeRunDir(dir)
})
