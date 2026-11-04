import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { Contender, LocalConfig } from "./types.ts"

export class ConfigError extends Error {}

export const REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..")

export function defaults(): LocalConfig {
  return {
    machine: "", person: "", tasks_dir: "../slackometer-tasks", repo_dir: REPO_DIR,
    benches: ["core"], exclude_tasks: [], private_benches: [], private_results: "metrics-only",
    contenders: [{ tool: "claude-code", model: "claude-opus-5-5", efforts: ["medium", "high", "xhigh"] }],
    schedule: { days: ["Mon", "Wed"], time: "03:00" },
    budget: { percent_of_weekly_per_run: 2, ceiling_percent_of_weekly_per_run: 3, plan_to: 0.75, guard_percent: 90 },
    cutoff: "23:59", judge: { model: "claude-opus-5-5", effort: "high" },
    quiet: { scheduled_tasks: [], close_apps: [], manual: [] },
  }
}

const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"])
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

function merge<T>(base: T, over: unknown): T {
  if (!isObj(base) || !isObj(over)) return (over === undefined ? base : over) as T
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(over)) out[k] = k in out && isObj(out[k]) && isObj(v) ? merge(out[k], v) : v
  return out as T
}

export function validate(c: LocalConfig): string[] {
  const p: string[] = []
  if (!c.machine || !/^[a-z0-9][a-z0-9-]*$/i.test(c.machine)) p.push("machine: required, letters/digits/dashes")
  if (!c.person) p.push("person: required")
  if (!c.tasks_dir) p.push("tasks_dir: required")
  if (!Array.isArray(c.contenders) || !c.contenders.length) p.push("contenders: at least one")
  for (const [i, k] of (c.contenders ?? []).entries()) {
    if (k.tool !== "claude-code") p.push(`contenders[${i}].tool: only "claude-code" is supported`)
    if (!k.model) p.push(`contenders[${i}].model: required`)
    if (!k.efforts?.length || k.efforts.some((e) => !EFFORTS.has(e))) p.push(`contenders[${i}].efforts: one or more of low|medium|high|xhigh|max`)
  }
  const b = c.budget
  if (!(b.percent_of_weekly_per_run > 0)) p.push("budget.percent_of_weekly_per_run: > 0")
  if (!(b.ceiling_percent_of_weekly_per_run >= b.percent_of_weekly_per_run)) p.push("budget.ceiling_percent_of_weekly_per_run: >= percent_of_weekly_per_run")
  if (!(b.plan_to > 0 && b.plan_to <= 1)) p.push("budget.plan_to: between 0 and 1")
  if (!(b.guard_percent > 0 && b.guard_percent <= 100)) p.push("budget.guard_percent: 1-100")
  if (!/^\d\d:\d\d$/.test(c.schedule.time)) p.push("schedule.time: HH:MM")
  if (!/^\d\d:\d\d$/.test(c.cutoff)) p.push("cutoff: HH:MM")
  return p
}

export function loadConfig(path = join(REPO_DIR, "local.json")): LocalConfig {
  if (!existsSync(path)) throw new ConfigError(`No config at ${path}. Copy local.example.json to local.json (see SETUP.md).`)
  let raw: unknown
  try { raw = JSON.parse(readFileSync(path, "utf8")) } catch (e) { throw new ConfigError(`local.json is not valid JSON: ${(e as Error).message}`) }
  const c = merge(defaults(), raw)
  const problems = validate(c)
  if (problems.length) throw new ConfigError("local.json problems:\n  - " + problems.join("\n  - "))
  c.repo_dir = resolve(c.repo_dir || REPO_DIR)
  c.tasks_dir = resolve(dirname(path), c.tasks_dir)
  return c
}

export const contenderId = (c: Contender) => "claude-code/" + c.model

export function paths(cfg: LocalConfig) {
  const home = join(homedir(), ".slackometer")
  const results = join(cfg.repo_dir, "results")
  return { results, machineResults: join(results, cfg.machine), transcripts: join(home, "transcripts"), state: join(home, "state") }
}
