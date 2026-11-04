// One task at one effort level, end to end: fresh folder -> Claude Code -> (only then) grader -> result JSON.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { contenderId, paths } from "./config.ts"
import { runClaude as realRunClaude, type RunClaude } from "./claude.ts"
import { parseTranscript } from "./transcript.ts"
import { injectGrader, makeRunDir, removeRunDir } from "./workspace.ts"
import { runGrader } from "./grade.ts"
import type { Contender, Effort, LocalConfig, RunResult, TaskDef } from "./types.ts"

export interface RunCtx { cfg: LocalConfig; date: string; suiteVersion: number; contender: Contender; runClaude?: RunClaude; now?: () => Date }

export const resultPath = (cfg: LocalConfig, date: string, task: string, effort: Effort) => join(paths(cfg).machineResults, date, `${task}__${effort}.json`)

export async function runOne(t: TaskDef, effort: Effort, ctx: RunCtx): Promise<RunResult> {
  const now = ctx.now ?? (() => new Date())
  const started = now()
  const prompt = readFileSync(join(t.dir, "prompt.md"), "utf8")
  const dir = await makeRunDir(t)
  try {
    const transcriptPath = join(paths(ctx.cfg).transcripts, ctx.date, `${t.id}__${effort}.jsonl`)
    const c = await (ctx.runClaude ?? realRunClaude)({ cwd: dir, prompt, model: ctx.contender.model, effort, maxTurns: t.max_turns, timeoutMs: t.time_limit_min * 60_000, transcriptPath, isolation: ctx.cfg.claude_isolation_args })
    const m = parseTranscript(c.lines, t, c.wallMs, c.timedOut)
    // the model has exited: only now may the grader enter the folder
    let grade = { passed: 0, total: 0, details: "not graded (run was limited)", error: undefined as string | undefined }
    let ui: RunResult["ui_checks"] = null, judge: RunResult["judge"] = null
    if (m.end !== "limited") {
      await injectGrader(t, dir)
      grade = { error: undefined, ...(await runGrader(t, dir)) }
      const side = join(dir, ".grader", "ui-result.json")
      if (t.ui && existsSync(side)) { const s = JSON.parse(readFileSync(side, "utf8")); ui = s.ui_checks ?? null; judge = s.judge ?? null }
    }
    const pass = m.end !== "limited" && !grade.error && grade.total > 0 && grade.passed === grade.total
    const result: RunResult = {
      schema: 1, date: ctx.date, machine: ctx.cfg.machine, person: ctx.cfg.person, contender: contenderId(ctx.contender),
      effort, task: t.id, bench: t.bench, task_version: t.version, suite_version: ctx.suiteVersion,
      task_meta: { title: t.title, language: t.language, kind: t.kind, difficulty: t.difficulty, ui: t.ui },
      pass, score: t.ui && judge && Number.isFinite(judge.score) ? judge.score : grade.total ? Math.round((grade.passed / grade.total) * 1000) / 1000 : 0,
      tests_passed: grade.passed, tests_total: grade.total, ui_checks: ui, judge,
      ...m, model_id: m.model_id || ctx.contender.model,
      started_at: started.toISOString(), finished_at: now().toISOString(),
    }
    const out = resultPath(ctx.cfg, ctx.date, t.id, effort)
    mkdirSync(join(out, ".."), { recursive: true })
    writeFileSync(out, JSON.stringify({ ...result, grade_error: grade.error ? "grader error" : null }, null, 2))
    // grader details name hidden checks: they stay on this machine, next to the transcript
    mkdirSync(join(transcriptPath, ".."), { recursive: true })
    writeFileSync(transcriptPath.replace(/\.jsonl$/, ".grade.txt"), [`${grade.passed}/${grade.total}`, grade.error ?? "", grade.details].join("\n"))
    return result
  } finally { await removeRunDir(dir) }
}
