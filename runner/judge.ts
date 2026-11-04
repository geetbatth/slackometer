// UI judge: a pinned Claude model looks at the screenshots and scores them against the rubric.
// Secondary signal only: it never changes pass/fail.
import { run } from "./proc.ts"
import { DEFAULT_ISOLATION } from "./claude.ts"
import type { Effort } from "./types.ts"

export interface JudgeOpts { model: string; effort: Effort; isolation?: string[] }

export async function judgeUi(dir: string, screens: string[], brief: string, rubric: string, o: JudgeOpts): Promise<{ score: number; reasons: string }> {
  const prompt = [
    "You are grading a UI built from a brief. Use the Read tool to look at these screenshots:",
    ...screens.map((s) => "- " + s),
    "", "Brief:", brief, "", "Rubric (score each point, then give one overall score 1-5):", rubric, "",
    'Reply with exactly ONE line of JSON and nothing else: {"score": <number 1-5>, "reasons": "<under 40 words>"}',
  ].join("\n")
  const r = await run("claude", ["-p", prompt, "--model", o.model, "--effort", o.effort, "--max-turns", "6", "--output-format", "json", "--allowedTools", "Read", ...(o.isolation ?? DEFAULT_ISOLATION)], { cwd: dir, shell: false, timeoutMs: 300_000 })
  try {
    const text = String(JSON.parse(r.stdout).result ?? "")
    const line = text.split(/\r?\n/).reverse().find((l) => l.trim().startsWith("{"))
    const j = JSON.parse(line ?? "{}")
    const score = Number(j.score)
    return { score: score >= 1 && score <= 5 ? score : NaN, reasons: String(j.reasons ?? "") }
  } catch { return { score: NaN, reasons: "judge reply was not JSON" } }
}
