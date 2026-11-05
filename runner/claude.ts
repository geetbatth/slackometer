// Run Claude Code headless and capture its stream-json transcript.
import { appendFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { claudeEnv } from "./isolate.ts"
import { run } from "./proc.ts"
import type { Effort } from "./types.ts"

/** Extra flags on top of the clean config folder (see isolate.ts). --bare is unusable: it ignores subscription logins. */
export const DEFAULT_ISOLATION = ["--strict-mcp-config"]

export function buildArgs(prompt: string, model: string, effort: Effort, maxTurns: number, isolation: string[] = DEFAULT_ISOLATION): string[] {
  return ["-p", prompt, "--model", model, "--effort", effort, "--max-turns", String(maxTurns),
    "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions", ...isolation]
}

export interface ClaudeRun { exitCode: number | null; timedOut: boolean; lines: string[]; wallMs: number; stderr: string }
export type RunClaude = (o: { cwd: string; prompt: string; model: string; effort: Effort; maxTurns: number; timeoutMs: number; transcriptPath: string; isolation?: string[] }) => Promise<ClaudeRun>

export const runClaude: RunClaude = async (o) => {
  mkdirSync(dirname(o.transcriptPath), { recursive: true })
  const t0 = Date.now()
  const r = await run("claude", buildArgs(o.prompt, o.model, o.effort, o.maxTurns, o.isolation), {
    cwd: o.cwd, shell: false, timeoutMs: o.timeoutMs, stdio: ["ignore", "pipe", "pipe"], env: await claudeEnv(o.timeoutMs), reap: true,
    onStdout: (chunk) => appendFileSync(o.transcriptPath, chunk),
  })
  return { exitCode: r.code, timedOut: r.timedOut, lines: r.stdout.split(/\r?\n/).filter(Boolean), wallMs: Date.now() - t0, stderr: (r.spawnError ?? "") + r.stderr }
}
