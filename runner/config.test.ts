import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defaults, loadConfig, ConfigError, contenderId } from "./config.ts"

const tmp = (obj: unknown) => { const d = mkdtempSync(join(tmpdir(), "slk-cfg-")); const p = join(d, "local.json"); writeFileSync(p, JSON.stringify(obj)); return p }

test("defaults: budget 2/3/0.75/90, Mon+Wed 03:00, medium/high/xhigh", () => {
  const d = defaults()
  assert.deepEqual(d.budget, { percent_of_weekly_per_run: 2, ceiling_percent_of_weekly_per_run: 3, plan_to: 0.75, guard_percent: 90 })
  assert.deepEqual(d.schedule, { days: ["Mon", "Wed"], time: "03:00" })
  assert.deepEqual(d.contenders[0].efforts, ["medium", "high", "xhigh"])
  assert.equal(d.contenders[0].model, "claude-opus-5-5")
})

test("loadConfig: missing machine throws ConfigError naming the field", () => {
  const p = tmp({ person: "x", tasks_dir: "../t" })
  assert.throws(() => loadConfig(p), (e: unknown) => e instanceof ConfigError && /machine/.test((e as Error).message))
})

test("loadConfig: partial file keeps defaults for omitted keys", () => {
  const c = loadConfig(tmp({ machine: "m1", person: "p", tasks_dir: "../t", budget: { percent_of_weekly_per_run: 1.5 } }))
  assert.equal(c.machine, "m1")
  assert.equal(c.budget.percent_of_weekly_per_run, 1.5)
  assert.equal(c.budget.ceiling_percent_of_weekly_per_run, 3)
  assert.equal(c.cutoff, "23:59")
})

test("contenderId", () => {
  assert.equal(contenderId({ tool: "claude-code", model: "claude-opus-5-5", efforts: [] }), "claude-code/claude-opus-5-5")
})
