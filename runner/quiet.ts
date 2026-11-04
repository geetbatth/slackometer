// Quiet mode for calibration: pause everything else that uses the person's Claude subscription, then always put it back.
// Only acts on what local.json lists (quiet.scheduled_tasks, quiet.close_apps); quiet.manual items are reminders.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import { createInterface } from "node:readline/promises"
import { run } from "./proc.ts"
import type { LocalConfig } from "./types.ts"

export interface QuietExec {
  taskEnabled(name: string): Promise<boolean | null>   // null = no such task
  setTask(name: string, enabled: boolean): Promise<void>
  findProcesses(names: string[]): Promise<{ pid: number; name: string; path: string }[]>
  close(pid: number): Promise<void>                      // graceful (no /F)
  kill(pid: number): Promise<void>
  launch(path: string): Promise<void>
}
export interface PauseManifest { owner_pid?: number; since: string; tasks: string[]; apps: { name: string; path: string }[]; manual: string[] }
interface Opts { exec?: QuietExec; statePath?: string; confirm?: (q: string) => Promise<boolean>; waitMs?: number; settleMs?: number; log?: (s: string) => void }

export const DEFAULT_STATE = join(homedir(), ".slackometer", "state", "paused.json")
const ps = async (script: string) => (await run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { shell: false, timeoutMs: 60_000 })).stdout.trim()
const q = (s: string) => `'${s.replace(/'/g, "''")}'`

export const windowsExec: QuietExec = {
  taskEnabled: async (n) => { const o = await ps(`$t = Get-ScheduledTask -TaskName ${q(n)} -ErrorAction SilentlyContinue; if ($t) { $t.State } else { 'MISSING' }`); return o === "MISSING" ? null : o !== "Disabled" },
  setTask: async (n, on) => { await ps(`${on ? "Enable" : "Disable"}-ScheduledTask -TaskName ${q(n)} | Out-Null`) },
  findProcesses: async (names) => {
    if (!names.length) return []
    const out = await ps(`Get-Process | Where-Object { ${names.map((n) => `$_.ProcessName -like ${q(n + "*")}`).join(" -or ")} } | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { "$($_.Id)|$($_.ProcessName)|$($_.Path)" }`)
    return out.split(/\r?\n/).filter(Boolean).map((l) => { const [pid, name, path] = l.split("|"); return { pid: Number(pid), name, path } }).filter((p) => p.pid !== process.pid && p.pid !== process.ppid)
  },
  close: async (pid) => { await run("taskkill", ["/PID", String(pid)], { shell: false, timeoutMs: 30_000 }) },
  kill: async (pid) => { await run("taskkill", ["/T", "/F", "/PID", String(pid)], { shell: false, timeoutMs: 30_000 }) },
  launch: async (path) => { await ps(`Start-Process -FilePath ${q(path)}`) },
}

async function askYesNo(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try { return /^y/i.test(await rl.question(question + " [y/N] ")) } finally { rl.close() }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function pause(cfg: LocalConfig, o: Opts = {}): Promise<PauseManifest> {
  const exec = o.exec ?? windowsExec, sp = o.statePath ?? DEFAULT_STATE, log = o.log ?? console.log
  const tasks: string[] = []
  for (const n of cfg.quiet.scheduled_tasks) if ((await exec.taskEnabled(n)) === true) tasks.push(n)
  const procs = await exec.findProcesses(cfg.quiet.close_apps)
  const manifest: PauseManifest = { owner_pid: process.pid, since: new Date().toISOString(), tasks, apps: procs.map((p) => ({ name: p.name, path: p.path })), manual: cfg.quiet.manual }
  // write the undo list BEFORE touching anything
  mkdirSync(dirname(sp), { recursive: true })
  writeFileSync(sp, JSON.stringify(manifest, null, 2))
  try {
    for (const n of tasks) { log(`pausing scheduled task: ${n}`); await exec.setTask(n, false) }
    for (const p of procs) { log(`closing ${p.name} (pid ${p.pid})`); await exec.close(p.pid) }
    const deadline = Date.now() + (o.waitMs ?? 60_000)
    let left = await exec.findProcesses(cfg.quiet.close_apps)
    while (left.length && Date.now() < deadline) { await sleep(2000); left = await exec.findProcesses(cfg.quiet.close_apps) }
    if (left.length) {
      const force = await (o.confirm ?? askYesNo)(`${left.map((p) => p.name).join(", ")} did not close (busy?). Force-close and continue?`)
      if (!force) throw new Error(`${left.map((p) => p.name).join(", ")} did not close; calibration cancelled`)
      for (const p of left) await exec.kill(p.pid)
    }
    for (const m of cfg.quiet.manual) log(`reminder: make sure this is paused: ${m}`)
    return manifest
  } catch (e) { await resume({ exec, statePath: sp, log }); throw e }
}

export async function resume(o: Opts = {}): Promise<void> {
  const exec = o.exec ?? windowsExec, sp = o.statePath ?? DEFAULT_STATE, log = o.log ?? console.log
  if (!existsSync(sp)) return
  const m = JSON.parse(readFileSync(sp, "utf8")) as PauseManifest
  for (const n of m.tasks) { log(`re-enabling scheduled task: ${n}`); await exec.setTask(n, true).catch((e) => log(`  could not re-enable ${n}: ${e}`)) }
  for (const a of m.apps) if (a.path) { log(`reopening ${a.name}`); await exec.launch(a.path).catch(() => log(`  could not reopen ${a.path}`)) }
  for (const x of m.manual) log(`reminder: un-pause: ${x}`)
  rmSync(sp, { force: true })
}

/** Called at the start of every command: a crashed calibration never leaves things paused. */
export async function resumeIfPaused(): Promise<void> {
  if (!existsSync(DEFAULT_STATE)) return
  const owner = (JSON.parse(readFileSync(DEFAULT_STATE, "utf8")) as PauseManifest).owner_pid
  const { isAlive } = await import("./lock.ts")
  if (owner && owner !== process.pid && isAlive(owner)) return // a calibration is running right now; leave its pause alone
  console.log("Found a paused calibration that is no longer running; restoring everything first.")
  await resume()
}

export async function withQuiet(cfg: LocalConfig, fn: () => Promise<void>, o: Opts & { readUsage?: () => Promise<{ seven_day: number; five_hour: number }> } = {}): Promise<void> {
  await pause(cfg, o)
  try {
    const settle = o.settleMs ?? 180_000
    if (settle > 0 && o.readUsage !== undefined) {
      const a = await o.readUsage(); await sleep(settle); const b = await o.readUsage()
      if (b.five_hour > a.five_hour) throw new Error("Claude usage is still moving with everything paused (another device?). Calibration cancelled.")
    }
    await fn()
  } finally { await resume(o) }
}
