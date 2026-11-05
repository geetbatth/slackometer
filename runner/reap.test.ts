import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { descendants, run } from "./proc.ts"
import { readUsage } from "./usage.ts"

test("descendants follow parent links even through exited parents, and skip older processes", () => {
  const t = 1_000_000
  const procs = [
    { pid: 10, ppid: 1, created: t },        // root (already exited in real life; its pid stays in children's ppid)
    { pid: 11, ppid: 10, created: t + 5 },   // npm test
    { pid: 12, ppid: 11, created: t + 6 },   // node --test
    { pid: 13, ppid: 10, created: t - 60_000 }, // pid reuse: an older, unrelated process
    { pid: 14, ppid: 99, created: t + 7 },   // unrelated
  ]
  assert.deepEqual(descendants(procs, 10, t).sort(), [11, 12])
})

test("a background process left behind by a run is killed when the run ends", { skip: process.platform !== "win32" && "Windows path; POSIX uses process groups" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "slk-reap-"))
  const pidFile = join(dir, "pid")
  // the child starts a long-lived grandchild that is NOT waited for, then exits (like a model starting `npm test &`)
  const script = `const { spawn } = require("child_process"); const g = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 120000)"], { detached: true, stdio: "ignore" }); require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(g.pid)); g.unref()`
  await run(process.execPath, ["-e", script], { shell: false, timeoutMs: 30_000, reap: true })
  assert.ok(existsSync(pidFile))
  const pid = Number(readFileSync(pidFile, "utf8"))
  let alive = true
  try { process.kill(pid, 0) } catch { alive = false }
  if (alive) { try { process.kill(pid) } catch { /* cleanup */ } }
  assert.equal(alive, false, `grandchild ${pid} survived the run`)
})

test("readUsage retries a rate-limited usage endpoint before failing closed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "slk-u429-"))
  const cred = join(dir, "c.json")
  const { writeFileSync } = await import("node:fs")
  writeFileSync(cred, JSON.stringify({ claudeAiOauth: { accessToken: "x", expiresAt: Date.now() + 3_600_000 } }))
  let calls = 0
  const body = { five_hour: { utilization: 5 }, seven_day: { utilization: 40, resets_at: "2026-11-10T16:00:00Z" } }
  const fetchImpl = (async () => { calls++; return calls < 3 ? new Response("slow down", { status: 429 }) : Response.json(body) }) as typeof fetch
  const u = await readUsage({ fetchImpl, credPath: cred, wait: async () => {} })
  assert.equal(u.seven_day, 40); assert.equal(calls, 3)
})
