import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defaults } from "./config.ts"
import { pause, resume, withQuiet, type QuietExec } from "./quiet.ts"

const cfg = () => ({ ...defaults(), machine: "t", person: "t", quiet: { scheduled_tasks: ["T3 Code keep open", "Gone task"], close_apps: ["Claude"], manual: ["T3 Code scheduled tasks"] } })
function fakeExec(log: string[], statePath: string, opts: { stubborn?: boolean } = {}): QuietExec {
  let running = true
  return {
    taskEnabled: async (n) => { log.push(`check:${n}:${existsSync(statePath)}`); return n !== "Gone task" },
    setTask: async (n, on) => { log.push(`${on ? "enable" : "disable"}:${n}:${existsSync(statePath)}`) },
    findProcesses: async (names) => (running ? names.map((n, i) => ({ pid: 100 + i, name: n, path: `C:/Apps/${n}.exe` })) : []),
    close: async (pid) => { log.push(`close:${pid}:${existsSync(statePath)}`); if (!opts.stubborn) running = false },
    kill: async (pid) => { log.push(`kill:${pid}`); running = false },
    launch: async (path) => { log.push(`launch:${path}`) },
  }
}
const statePath = () => join(mkdtempSync(join(tmpdir(), "slk-q-")), "paused.json")

test("manifest written before any action, and only enabled tasks are disabled", async () => {
  const log: string[] = [], sp = statePath()
  const m = await pause(cfg(), { exec: fakeExec(log, sp), statePath: sp, confirm: async () => true, waitMs: 0 })
  const actions = log.filter((l) => /^(disable|close)/.test(l))
  assert.ok(actions.length >= 2)
  assert.ok(actions.every((l) => l.endsWith(":true")), log.join(" | "))
  assert.deepEqual(m.tasks, ["T3 Code keep open"])
  assert.equal(m.apps[0].path, "C:/Apps/Claude.exe")
  assert.ok(existsSync(sp))
})

test("an app that won't close: declining to force aborts and resumes", async () => {
  const log: string[] = [], sp = statePath()
  await assert.rejects(pause(cfg(), { exec: fakeExec(log, sp, { stubborn: true }), statePath: sp, confirm: async () => false, waitMs: 0 }), /did not close/)
  assert.ok(log.includes("enable:T3 Code keep open:true"))
  assert.ok(!existsSync(sp))
})

test("resume is idempotent", async () => {
  const log: string[] = [], sp = statePath()
  const ex = fakeExec(log, sp)
  await pause(cfg(), { exec: ex, statePath: sp, confirm: async () => true, waitMs: 0 })
  await resume({ exec: ex, statePath: sp })
  await resume({ exec: ex, statePath: sp })
  assert.equal(log.filter((l) => l.startsWith("enable:")).length, 1)
  assert.equal(log.filter((l) => l.startsWith("launch:")).length, 1)
  assert.ok(!existsSync(sp))
})

test("withQuiet resumes on throw", async () => {
  const log: string[] = [], sp = statePath()
  await assert.rejects(withQuiet(cfg(), async () => { throw new Error("calibration blew up") }, { exec: fakeExec(log, sp), statePath: sp, confirm: async () => true, waitMs: 0, settleMs: 0 }), /blew up/)
  assert.ok(log.some((l) => l.startsWith("enable:")))
  assert.ok(!existsSync(sp))
})

test("manifest records manual reminders", async () => {
  const log: string[] = [], sp = statePath()
  await pause(cfg(), { exec: fakeExec(log, sp), statePath: sp, confirm: async () => true, waitMs: 0 })
  assert.deepEqual(JSON.parse(readFileSync(sp, "utf8")).manual, ["T3 Code scheduled tasks"])
})
