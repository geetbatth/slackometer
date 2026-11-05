// Recompute transcript-derived metrics for runs that already happened, from their saved transcripts.
// Use after improving transcript.ts. Tokens, cost, pass/fail and timings are not re-measured, only re-read.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { loadConfig, paths } from "./config.ts"
import { loadTasks } from "./tasks.ts"
import { parseTranscript } from "./transcript.ts"
import type { LocalConfig, RunResult } from "./types.ts"

export function reparseAll(cfg: LocalConfig): { updated: number; missing: number } {
  const p = paths(cfg)
  const hints = new Map(loadTasks(cfg).map((t) => [t.id, t.test_command_hints]))
  let updated = 0, missing = 0
  if (!existsSync(p.machineResults)) return { updated, missing }
  for (const day of readdirSync(p.machineResults, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== "suites")) {
    const dir = join(p.machineResults, day.name)
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json") && !x.startsWith("day"))) {
      const file = join(dir, f)
      const r = JSON.parse(readFileSync(file, "utf8")) as RunResult & Record<string, unknown>
      if (r.schema !== 1 || r.end === "limited") continue
      const tr = join(p.transcripts, day.name, f.replace(/\.json$/, ".jsonl"))
      if (!existsSync(tr)) { missing++; continue }
      const m = parseTranscript(readFileSync(tr, "utf8").split(/\r?\n/).filter(Boolean), { test_command_hints: hints.get(r.task) ?? [] }, r.minutes * 60_000, r.end === "timeout")
      const next = {
        ...r,
        thinking_tokens: m.thinking_tokens, files_read: m.files_read, files_read_before_first_edit: m.files_read_before_first_edit,
        ran_tests: m.ran_tests, verified_after_last_edit: m.verified_after_last_edit, digest: m.digest,
        claimed_done: m.claimed_done, claim_text: m.claim_text,
        // score is the share of hidden checks passed; the UI judge's 1-5 rating lives in `judge`
        score: r.tests_total ? Math.round((r.tests_passed / r.tests_total) * 1000) / 1000 : 0,
      }
      writeFileSync(file, JSON.stringify(next, null, 2))
      updated++
    }
  }
  return { updated, missing }
}

export async function main(): Promise<number> {
  const { updated, missing } = reparseAll(loadConfig())
  console.log(`re-read ${updated} runs from their transcripts${missing ? `; ${missing} had no transcript on this machine (left as they were)` : ""}`)
  return 0
}
