import { join } from "node:path"
import { REPO_DIR } from "./config.ts"
import { run } from "./proc.ts"
import type { GradeResult, TaskDef } from "./types.ts"

export const CLI_PATH = join(REPO_DIR, "runner", "cli.ts")

/** Substitute {cli} and {python} in a task's grade command. */
export function expandGrade(cmd: string): string {
  return cmd.replaceAll("{cli}", `"${CLI_PATH}"`).replaceAll("{python}", process.platform === "win32" ? "python" : "python3")
}

/** Parse the last stdout line that is JSON with numeric passed/total. */
export function parseGradeOutput(stdout: string): GradeResult | null {
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const o = JSON.parse(lines[i])
      if (o && typeof o.passed === "number" && typeof o.total === "number") return { passed: o.passed, total: o.total, details: String(o.details ?? "") }
    } catch { /* not json */ }
  }
  return null
}

/** Run a task's grader in the run folder. Never throws: any failure is a graded fail with a reason. */
export async function runGrader(t: TaskDef, dir: string, timeoutMs = 300_000, env: Record<string, string> = {}): Promise<GradeResult> {
  const r = await run(expandGrade(t.grade), [], { cwd: dir, shell: true, timeoutMs, env: { ...process.env, SLACKOMETER_CLI: CLI_PATH, ...env } })
  const tail = (r.stderr || r.stdout).slice(-2000)
  if (r.timedOut) return { passed: 0, total: 1, details: tail, error: `grader timeout after ${timeoutMs} ms` }
  if (r.spawnError) return { passed: 0, total: 1, details: tail, error: `grader could not start: ${r.spawnError}` }
  const parsed = parseGradeOutput(r.stdout)
  if (!parsed) return { passed: 0, total: 1, details: tail, error: `grader printed no result JSON (exit ${r.code})` }
  if (parsed.total < 1) return { ...parsed, total: 1, passed: 0, error: "grader reported 0 tests" }
  return parsed
}
