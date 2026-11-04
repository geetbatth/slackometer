import { test } from "node:test"
import assert from "node:assert/strict"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findChrome } from "./ui-check.ts"
import { uiGrade } from "./ui-grade.ts"

const skip = !findChrome() ? "no Chrome/Edge" : false
function runDir(page: string) {
  const d = mkdtempSync(join(tmpdir(), "slk-uig-")); mkdirSync(join(d, ".grader"))
  copyFileSync(join(import.meta.dirname, "fixtures/ui", page), join(d, "index.html"))
  writeFileSync(join(d, ".grader/checks.json"), JSON.stringify({ page: "index.html", selectors: ["#settings", "#name"], states: ["[data-state=empty]"], mobile: true, brief: "settings screen", rubric: "rubric.md" }))
  writeFileSync(join(d, ".grader/rubric.md"), "layout, spacing")
  return d
}

test("ui-grade: good page passes every hard check and writes ui-result.json (no judge)", { skip }, async () => {
  const d = runDir("good.html")
  const g = await uiGrade(join(d, ".grader/checks.json"), { cwd: d, judge: false })
  assert.equal(g.passed, g.total); assert.equal(g.total, 6) // renders, no errors, 2 selectors, 1 state, mobile
  const side = JSON.parse(readFileSync(join(d, ".grader/ui-result.json"), "utf8"))
  assert.equal(side.ui_checks.renders, true); assert.equal(side.judge, null)
})

test("ui-grade: broken page fails hard checks; a missing page is a fail not a crash", { skip }, async () => {
  const d = runDir("broken.html")
  const g = await uiGrade(join(d, ".grader/checks.json"), { cwd: d, judge: false })
  assert.ok(g.passed < g.total)
  const e = mkdtempSync(join(tmpdir(), "slk-uig-")); mkdirSync(join(e, ".grader"))
  writeFileSync(join(e, ".grader/checks.json"), JSON.stringify({ page: "nope.html", selectors: [], states: [] }))
  const g2 = await uiGrade(join(e, ".grader/checks.json"), { cwd: e, judge: false })
  assert.equal(g2.passed, 0); assert.ok(existsSync(join(e, ".grader/ui-result.json")))
})
