import { cp } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { applyReference, injectGrader, makeRunDir, removeRunDir } from "./workspace.ts"
import { runGrader } from "./grade.ts"
import { missingTools } from "./tasks.ts"
import type { GradeResult, TaskDef } from "./types.ts"

export interface Validation { ok: boolean; untouched: GradeResult; reference: GradeResult; naive: GradeResult | null; problems: string[] }

/** <task>/naive/: what a hasty engineer would do (laid out like workspace/). Hard tasks ship one to prove they punish it. */
const naiveDir = (t: TaskDef) => join(t.dir, "naive")

async function gradeOnce(t: TaskDef, overlay: "none" | "reference" | "naive"): Promise<GradeResult> {
  const dir = await makeRunDir(t)
  try {
    if (overlay === "reference") await applyReference(t, dir)
    if (overlay === "naive") await cp(naiveDir(t), dir, { recursive: true, force: true })
    await injectGrader(t, dir)
    return await runGrader(t, dir, 300_000, { SLACKOMETER_NO_JUDGE: "1" }) // validation never spends usage
  } finally { await removeRunDir(dir) }
}

/** A task is valid when the untouched workspace does NOT pass everything and the reference DOES. */
export async function validateTask(t: TaskDef): Promise<Validation> {
  const problems: string[] = []
  const miss = missingTools(t)
  if (miss.length) problems.push(`missing toolchains on this machine: ${miss.join(", ")}`)
  const untouched = await gradeOnce(t, "none")
  const reference = await gradeOnce(t, "reference")
  const naive = existsSync(naiveDir(t)) ? await gradeOnce(t, "naive") : null
  if (untouched.error) problems.push(`untouched workspace: grader crashed or printed no result (${untouched.error}); graders must print JSON even for broken code`)
  else if (untouched.passed === untouched.total) problems.push(`untouched workspace already passes ${untouched.passed}/${untouched.total}`)
  if (reference.error) problems.push(`reference: ${reference.error}`)
  else if (reference.passed !== reference.total) problems.push(`reference passes only ${reference.passed}/${reference.total}: ${reference.details.slice(0, 300)}`)
  if (naive && !naive.error && naive.passed === naive.total) problems.push(`the naive fix passes ${naive.passed}/${naive.total}: the task doesn't punish a shortcut`)
  return { ok: problems.length === 0, untouched, reference, naive, problems }
}
