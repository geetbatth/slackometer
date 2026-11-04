import { cp, mkdir, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import { runsRoot } from "./isolate.ts"
import { join, sep } from "node:path"
import { randomBytes } from "node:crypto"
import type { TaskDef } from "./types.ts"

/** Fresh copy of ONLY the task's workspace/. Graders and references never come along. */
export async function makeRunDir(t: TaskDef): Promise<string> {
  const dir = join(runsRoot(), `${t.id}-${randomBytes(4).toString("hex")}`)
  await mkdir(dir, { recursive: true })
  const SKIP = new Set(["bin", "obj", "node_modules", "__pycache__", ".pytest_cache"])
  const src = join(t.dir, "workspace")
  if (existsSync(src)) await cp(src, dir, { recursive: true, filter: (s) => !s.slice(src.length).split(/[\\/]/).some((part) => SKIP.has(part)) })
  return dir
}

/** Copy grader/ into <dir>/.grader/, excluding grader/reference/. Call only after the model has exited. */
export async function injectGrader(t: TaskDef, dir: string): Promise<void> {
  const src = join(t.dir, "grader")
  const ref = join(src, "reference")
  await cp(src, join(dir, ".grader"), { recursive: true, filter: (s) => s !== ref && !s.startsWith(ref + sep) })
}

/** Copy the reference solution over the run folder (validate only). */
export async function applyReference(t: TaskDef, dir: string): Promise<void> {
  const ref = join(t.dir, "grader", "reference")
  if (existsSync(ref)) await cp(ref, dir, { recursive: true, force: true })
}

export async function removeRunDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {})
}
