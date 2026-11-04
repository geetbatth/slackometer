// One bench process at a time (a scheduled run must never overlap a calibration).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"

export const RUN_LOCK = join(homedir(), ".slackometer", "state", "running.json")

export function isAlive(pid: number | undefined): boolean {
  if (!pid) return false
  try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM" }
}

/** Take the run lock or throw. Returns a release function. A lock whose process has died is taken over. */
export function acquireRunLock(command: string, path = RUN_LOCK): () => void {
  if (existsSync(path)) {
    try {
      const held = JSON.parse(readFileSync(path, "utf8")) as { pid: number; command: string; since: string }
      if (isAlive(held.pid)) throw new Error(`a bench is already running (pid ${held.pid}, "${held.command}" since ${held.since}); not starting "${command}"`)
    } catch (e) { if ((e as Error).message.startsWith("a bench is already running")) throw e }
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({ pid: process.pid, command, since: new Date().toISOString() }))
  let released = false
  return () => { if (!released) { released = true; rmSync(path, { force: true }) } }
}
