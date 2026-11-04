import { cp, mkdir, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"
import { randomBytes } from "node:crypto"
import type { TaskDef } from "./types.ts"

/** Fresh copy of ONLY the task's workspace/. Graders and references never come along. */
export async function makeRunDir(t: TaskDef): Promise<string> {
  const dir = join(tmpdir(), "slackometer", `${t.id}-${randomBytes(4).toString("hex")}`)
  await mkdir(dir, { recursive: true })
  if (existsSync(join(t.dir, "workspace"))) await cp(join(t.dir, "workspace"), dir, { recursive: true })
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
