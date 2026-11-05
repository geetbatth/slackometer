import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { loadTasks } from "./tasks.ts"
import { fixtureCfg } from "./test-helpers.ts"
import { makeRunDir, injectGrader, applyReference, removeRunDir } from "./workspace.ts"

const ok = () => loadTasks(fixtureCfg()).find((t) => t.id === "ok-task")!
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))

test("grader not present before inject", async () => {
  const dir = await makeRunDir(ok())
  assert.ok(existsSync(join(dir, "add.mjs")))
  assert.ok(!existsSync(join(dir, ".grader")))
  assert.ok(!walk(dir).some((f) => /reference|grade/.test(f)))
  await removeRunDir(dir)
})

test("inject excludes reference", async () => {
  const dir = await makeRunDir(ok())
  await injectGrader(ok(), dir)
  assert.ok(existsSync(join(dir, ".grader", "grade.mjs")))
  assert.ok(!existsSync(join(dir, ".grader", "reference")))
  await removeRunDir(dir)
})

test("applyReference overwrites workspace files", async () => {
  const dir = await makeRunDir(ok())
  await applyReference(ok(), dir)
  const { readFileSync } = await import("node:fs")
  assert.match(readFileSync(join(dir, "add.mjs"), "utf8"), /a \+ b/)
  await removeRunDir(dir)
})

test("each run gets its own parent folder; sibling folders the model makes are removed with it", async () => {
  const { existsSync, mkdirSync } = await import("node:fs")
  const { dirname, join } = await import("node:path")
  const dir = await makeRunDir(ok())
  const sibling = join(dirname(dir), "_baseline")
  mkdirSync(sibling)
  await removeRunDir(dir)
  assert.equal(existsSync(sibling), false)
  assert.equal(existsSync(dirname(dir)), false)
})
