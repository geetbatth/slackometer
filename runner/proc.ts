import { spawn, spawnSync, type SpawnOptions } from "node:child_process"

/** Kill a process and its children. */
export function killTree(pid: number | undefined): void {
  if (!pid) return
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], { stdio: "ignore" })
    else process.kill(-pid, "SIGKILL")
  } catch { /* already gone */ }
}

interface Proc { pid: number; ppid: number; created: number }

/** All processes with parent and start time (Windows). */
async function snapshot(): Promise<Proc[]> {
  const ps = "Get-CimInstance Win32_Process | ForEach-Object { '{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, $_.CreationDate.ToUniversalTime().Ticks }"
  const r = await run("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { shell: false, timeoutMs: 60_000 })
  return r.stdout.split(/\r?\n/).map((l) => l.trim().split(" ").map(Number)).filter((a) => a.length === 3 && a.every(Number.isFinite))
    .map(([pid, ppid, ticks]) => ({ pid, ppid, created: (ticks - 621355968000000000) / 10_000 }))
}

/** Everything descended from `root` that started after `since`, even if its parent has already exited. */
export function descendants(procs: Proc[], root: number, since: number): number[] {
  const kids = new Map<number, Proc[]>()
  for (const p of procs) if (p.created >= since - 2000) kids.set(p.ppid, [...(kids.get(p.ppid) ?? []), p])
  const out: number[] = [], todo = [root], seen = new Set<number>([root])
  while (todo.length) for (const k of kids.get(todo.pop()!) ?? []) if (!seen.has(k.pid)) { seen.add(k.pid); out.push(k.pid); todo.push(k.pid) }
  return out
}

/**
 * Kill whatever a finished process left running (a model may start `npm test` or a server in the background,
 * which outlives it, holds the run folder open and burns CPU for hours).
 */
export async function reap(pid: number | undefined, startedAt: number): Promise<number> {
  if (!pid) return 0
  if (process.platform !== "win32") { try { process.kill(-pid, "SIGKILL") } catch { /* group already gone */ } return 0 }
  const left = descendants(await snapshot().catch(() => []), pid, startedAt)
  for (const p of left) spawnSync("taskkill", ["/F", "/PID", String(p)], { stdio: "ignore" })
  return left.length
}

export interface Ran { code: number | null; stdout: string; stderr: string; timedOut: boolean; spawnError?: string }

/** Run a command with a hard timeout; never throws. */
export function run(cmd: string, args: string[], opts: SpawnOptions & { timeoutMs: number; input?: string; onStdout?: (chunk: string) => void; reap?: boolean }): Promise<Ran> {
  return new Promise((resolve) => {
    let stdout = "", stderr = "", timedOut = false, done = false
    const stdio = opts.stdio ?? [opts.input === undefined ? "ignore" : "pipe", "pipe", "pipe"]
    const startedAt = Date.now()
    const child = spawn(cmd, args, { ...opts, stdio, detached: process.platform !== "win32", windowsHide: true })
    const timer = setTimeout(() => { timedOut = true; killTree(child.pid) }, opts.timeoutMs)
    child.stdout?.setEncoding("utf8").on("data", (d: string) => { stdout += d; opts.onStdout?.(d) })
    child.stderr?.setEncoding("utf8").on("data", (d: string) => { stderr += d })
    if (opts.input !== undefined) child.stdin?.end(opts.input)
    const finish = (code: number | null, spawnError?: string) => {
      if (done) return; done = true; clearTimeout(timer)
      const result = { code, stdout, stderr, timedOut, spawnError }
      if (opts.reap) reap(child.pid, startedAt).then(() => resolve(result), () => resolve(result)); else resolve(result)
    }
    child.on("error", (e) => finish(null, e.message))
    child.on("close", (code) => finish(code))
    // a grandchild (e.g. a build server) can hold stdout open after the process exits; don't wait for it forever
    child.on("exit", (code) => setTimeout(() => finish(code), 3000))
  })
}
