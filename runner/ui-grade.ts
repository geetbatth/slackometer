// `ui-grade <checks.json>`: the standard grader for UI tasks. Hard checks decide pass/fail;
// the judge (skipped when SLACKOMETER_NO_JUDGE=1, e.g. during validate) is recorded beside them.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { uiCheck } from "./ui-check.ts"
import { judgeUi } from "./judge.ts"
import { defaults, loadConfig } from "./config.ts"
import type { GradeResult } from "./types.ts"

interface Checks { page: string; selectors: string[]; states: string[]; mobile?: boolean; brief?: string; rubric?: string }

export async function uiGrade(checksPath: string, o: { cwd: string; judge: boolean }): Promise<GradeResult> {
  const graderDir = dirname(resolve(o.cwd, checksPath))
  const c: Checks = { selectors: [], states: [], mobile: true, ...JSON.parse(readFileSync(resolve(o.cwd, checksPath), "utf8")) }
  const page = resolve(o.cwd, c.page)
  const total = 2 + c.selectors.length + c.states.length + (c.mobile ? 1 : 0)
  const write = (side: object) => writeFileSync(join(graderDir, "ui-result.json"), JSON.stringify(side, null, 2))
  if (!existsSync(page)) {
    write({ ui_checks: { builds: false, renders: false, console_errors: 0, states_present: 0 }, judge: null })
    return { passed: 0, total, details: `page not found: ${c.page}` }
  }
  const r = await uiCheck(page, { selectors: c.selectors, states: c.states }, graderDir)
  const checks: [string, boolean][] = [["renders", r.renders], ["no console errors", r.console_errors === 0],
    ...c.selectors.map((s): [string, boolean] => [`has ${s}`, !r.missing.includes(s)]),
    ...c.states.map((s): [string, boolean] => [`state ${s}`, !r.missing_states.includes(s)]),
    ...(c.mobile ? [["fits a 390px phone", !r.mobile_overflow] as [string, boolean]] : [])]
  const passed = checks.filter(([, ok]) => ok).length
  let judge = null
  if (o.judge) {
    let cfg; try { cfg = loadConfig() } catch { cfg = defaults() }
    const rubric = c.rubric && existsSync(join(graderDir, c.rubric)) ? readFileSync(join(graderDir, c.rubric), "utf8") : "layout, spacing, states, mobile, accessibility, faithfulness to the brief"
    const j = await judgeUi(graderDir, r.screenshots, c.brief ?? "", rubric, { model: cfg.judge.model, effort: cfg.judge.effort, isolation: cfg.claude_isolation_args })
    judge = { model: cfg.judge.model, effort: cfg.judge.effort, ...j }
  }
  write({ ui_checks: { builds: true, renders: r.renders, console_errors: r.console_errors, states_present: r.states_present }, judge, errors: r.errors })
  return { passed, total, details: checks.map(([n, ok]) => `${ok ? "✓" : "✗"} ${n}`).join("; ") }
}

export async function main(args: string[]): Promise<number> {
  if (!args[0]) { console.error("usage: ui-grade <checks.json>"); return 1 }
  const g = await uiGrade(args[0], { cwd: process.cwd(), judge: process.env.SLACKOMETER_NO_JUDGE !== "1" })
  console.log(JSON.stringify(g))
  return 0
}
