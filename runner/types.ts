// Shared types for the Slackometer runner. Erasable TypeScript only (Node 24 runs it directly).
export type Effort = "low" | "medium" | "high" | "xhigh" | "max"
export interface Contender { tool: "claude-code"; model: string; efforts: Effort[] }
export interface LocalConfig {
  machine: string; person: string; tasks_dir: string; repo_dir: string
  benches: string[]; exclude_tasks: string[]; private_benches: string[]; private_results: "metrics-only" | "local-only"
  contenders: Contender[]
  schedule: { days: ("Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun")[]; time: string }
  budget: { percent_of_weekly_per_run: number; ceiling_percent_of_weekly_per_run: number; plan_to: number; guard_percent: number }
  cutoff: string; judge: { model: string; effort: Effort }
  quiet: { scheduled_tasks: string[]; close_apps: string[]; manual: string[] }
  home_dir?: string                  // local-only data (transcripts, usage, locks); default ~/.slackometer
  claude_isolation_args?: string[]   // extra flags; default --strict-mcp-config (isolation itself comes from isolate.ts)
}
export interface TaskDef {
  id: string; bench: string; title: string; language: string; kind: string
  difficulty: "easy" | "medium" | "hard"; version: number; ui: boolean
  time_limit_min: number; max_turns: number; required_tools: string[]
  test_command_hints: string[]
  grade: string
  added_by: string; dir: string
}
export interface GradeResult { passed: number; total: number; details: string; error?: string }
export interface RunMetrics {
  output_tokens: number; thinking_tokens: number; input_tokens: number; cache_read_tokens: number; cache_write_tokens: number
  cost_usd: number; tool_calls: number; turns: number; files_read: number; files_read_before_first_edit: number
  ran_tests: boolean; verified_after_last_edit: boolean; minutes: number
  claimed_done: boolean; claim_text: string; digest: string
  cc_version: string; model_id: string
  end: "finished" | "timeout" | "turn_limit" | "errored" | "limited"
}
export interface RunResult extends RunMetrics {
  schema: 1; date: string; machine: string; person: string; contender: string
  effort: Effort; task: string; bench: string; task_version: number; suite_version: number
  task_meta: { title: string; language: string; kind: string; difficulty: string; ui: boolean }
  pass: boolean; score: number; tests_passed: number; tests_total: number
  ui_checks: { builds: boolean; renders: boolean; console_errors: number; states_present: number } | null
  judge: { model: string; effort: Effort; score: number; reasons: string } | null
  started_at: string; finished_at: string
}
export interface SuiteLock { contender: string; machine: string; version: number; calibrated_at: string; efforts: Effort[]; tasks: { id: string; version: number; cost_usd: Record<string, number> }[]; allowance_usd: number; rate_pct_per_usd: number }
export interface DayRecord { date: string; machine: string; contender: string; suite_version: number; cc_version: string; status: "complete" | "incomplete"; incomplete_reason: string | null; cost_usd: number; usage_pct_of_weekly: number; budget_pct: number; ceiling_pct: number; usage_before: number | null; usage_after: number | null }
export interface Usage { five_hour: number; seven_day: number; seven_day_resets_at: string; extra_usage_enabled: boolean }
