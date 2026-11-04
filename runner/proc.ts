import { spawn, spawnSync, type SpawnOptions } from "node:child_process"

/** Kill a process and its children. */
export function killTree(pid: number | undefined): void {
  if (!pid) return
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], { stdio: "ignore" })
    else process.kill(-pid, "SIGKILL")
  } catch { /* already gone */ }
}

export interface Ran { code: number | null; stdout: string; stderr: string; timedOut: boolean; spawnError?: string }

/** Run a command with a hard timeout; never throws. */
export function run(cmd: string, args: string[], opts: SpawnOptions & { timeoutMs: number; input?: string; onStdout?: (chunk: string) => void }): Promise<Ran> {
  return new Promise((resolve) => {
    let stdout = "", stderr = "", timedOut = false, done = false
    const stdio = opts.stdio ?? [opts.input === undefined ? "ignore" : "pipe", "pipe", "pipe"]
    const child = spawn(cmd, args, { ...opts, stdio, detached: process.platform !== "win32", windowsHide: true })
    const timer = setTimeout(() => { timedOut = true; killTree(child.pid) }, opts.timeoutMs)
    child.stdout?.setEncoding("utf8").on("data", (d: string) => { stdout += d; opts.onStdout?.(d) })
    child.stderr?.setEncoding("utf8").on("data", (d: string) => { stderr += d })
    if (opts.input !== undefined) child.stdin?.end(opts.input)
    const finish = (code: number | null, spawnError?: string) => { if (done) return; done = true; clearTimeout(timer); resolve({ code, stdout, stderr, timedOut, spawnError }) }
    child.on("error", (e) => finish(null, e.message))
    child.on("close", (code) => finish(code))
    // a grandchild (e.g. a build server) can hold stdout open after the process exits; don't wait for it forever
    child.on("exit", (code) => setTimeout(() => finish(code), 3000))
  })
}
