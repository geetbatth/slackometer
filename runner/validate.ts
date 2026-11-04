import { applyReference, injectGrader, makeRunDir, removeRunDir } from "./workspace.ts"
import { runGrader } from "./grade.ts"
import { missingTools } from "./tasks.ts"
import type { GradeResult, TaskDef } from "./types.ts"

export interface Validation { ok: boolean; untouched: GradeResult; reference: GradeResult; problems: string[] }

async function gradeOnce(t: TaskDef, reference: boolean): Promise<GradeResult> {
  const dir = await makeRunDir(t)
  try {
    if (reference) await applyReference(t, dir)
    await injectGrader(t, dir)
    return await runGrader(t, dir)
  } finally { await removeRunDir(dir) }
}

/** A task is valid when the untouched workspace does NOT pass everything and the reference DOES. */
export async function validateTask(t: TaskDef): Promise<Validation> {
  const problems: string[] = []
  const miss = missingTools(t)
  if (miss.length) problems.push(`missing toolchains on this machine: ${miss.join(", ")}`)
  const untouched = await gradeOnce(t, false)
  const reference = await gradeOnce(t, true)
  if (!untouched.error && untouched.passed === untouched.total) problems.push(`untouched workspace already passes ${untouched.passed}/${untouched.total}`)
  if (reference.error) problems.push(`reference: ${reference.error}`)
  else if (reference.passed !== reference.total) problems.push(`reference passes only ${reference.passed}/${reference.total}: ${reference.details.slice(0, 300)}`)
  return { ok: problems.length === 0, untouched, reference, problems }
}
