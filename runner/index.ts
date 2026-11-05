// Build site/data/runs.js (the format web/src/lib/data.ts reads) from every machine's committed results.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { paths } from "./config.ts"
import { loadTasks } from "./tasks.ts"
import type { DayRecord, LocalConfig, RunResult, SuiteLock } from "./types.ts"

const DATE_DIR = /^\d{4}-\d{2}-\d{2}$/
const COLS = ["date", "machine", "contender", "effort", "task", "bench", "task_version", "suite_version", "cc_version", "end", "pass", "score", "tests_passed", "tests_total", "ui_checks",
  "output_tokens", "thinking_tokens", "input_tokens", "cache_read_tokens", "cache_write_tokens", "cost_usd", "tool_calls", "files_read", "ran_tests", "verified_after_last_edit", "minutes", "claimed_done", "claim_text", "digest"] as const
const INTERN = new Set(["date", "machine", "contender", "effort", "task", "bench", "cc_version", "end", "claim_text", "digest"])
const BOOL = new Set(["pass", "ran_tests", "verified_after_last_edit", "claimed_done"])

export function modelLabel(model: string): string {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(model)
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : model
}
const readJson = <T,>(f: string): T | null => { try { return JSON.parse(readFileSync(f, "utf8")) as T } catch { return null } }
const ls = (d: string) => (existsSync(d) ? readdirSync(d, { withFileTypes: true }) : [])

export async function buildIndex(cfg: LocalConfig, opts: { now?: () => Date } = {}): Promise<{ runs: number; days: number }> {
  const now = (opts.now ?? (() => new Date()))()
  const root = paths(cfg).results
  const runs: RunResult[] = [], days: DayRecord[] = [], suites: SuiteLock[] = []
  const people = new Map<string, string>()
  for (const m of ls(root).filter((e) => e.isDirectory())) {
    const mdir = join(root, m.name)
    for (const e of ls(mdir).filter((x) => x.isDirectory())) {
      const d = join(mdir, e.name)
      if (e.name === "suites") { for (const f of ls(d)) if (f.name.endsWith(".json")) { const s = readJson<SuiteLock>(join(d, f.name)); if (s) suites.push(s) } continue }
      if (!DATE_DIR.test(e.name)) continue // calibration-vN and anything else is not a run day
      for (const f of ls(d).filter((x) => x.name.endsWith(".json"))) {
        const j = readJson<any>(join(d, f.name)); if (!j) continue
        if (f.name.startsWith("day")) days.push(j)
        else if (j.schema === 1 && j.end !== "limited") { runs.push(j); people.set(j.machine, j.person) } // limited runs are excluded from every score
      }
    }
  }
  runs.sort((a, b) => a.date.localeCompare(b.date) || a.machine.localeCompare(b.machine) || a.task.localeCompare(b.task) || a.effort.localeCompare(b.effort))

  // private (metrics-only) benches: hide titles
  let privateIds = new Set<string>()
  try { if (cfg.private_benches.length) privateIds = new Set(loadTasks({ ...cfg, benches: [] }).map((t) => t.id)) } catch { /* private bench folder missing on this machine */ }

  const tasks = new Map<string, object>()
  for (const r of runs) tasks.set(r.task, { id: r.task, bench: r.bench, version: r.task_version, added_by: "", ...r.task_meta, title: privateIds.has(r.task) ? "(private task)" : r.task_meta.title })
  const benches = [...new Set(runs.map((r) => r.bench))].map((id) => ({ id, name: id === "core" ? "Core" : id.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), owner: "", description: "" }))
  const cutoff = now.getTime() - 30 * 864e5
  const contenders = [...new Set(runs.map((r) => r.contender))].map((id) => {
    const model = id.split("/").pop()!
    const mine = runs.filter((r) => r.contender === id)
    const order = ["low", "medium", "high", "xhigh", "max"]
    const efforts = [...new Set(mine.map((r) => r.effort))].sort((a, b) => order.indexOf(a) - order.indexOf(b))
    return { id, tool: "claude-code", model, label: modelLabel(model), efforts, retired: !mine.some((r) => new Date(r.date + "T12:00:00Z").getTime() >= cutoff) }
  })
  const machines = [...people].map(([id, person]) => ({ id, person, os: "" }))
  const events: { date: string; type: string; label: string }[] = []
  let lastCc = ""
  for (const r of runs) { if (r.cc_version && r.cc_version !== lastCc) { if (lastCc) events.push({ date: r.date, type: "cc_version", label: `Claude Code ${r.cc_version}` }); lastCc = r.cc_version } }
  for (const s of suites) events.push({ date: s.calibrated_at, type: "model", label: `${modelLabel(s.contender.split("/").pop()!)} calibrated (suite v${s.version}, ${s.machine})` })
  events.sort((a, b) => a.date.localeCompare(b.date))

  const strings: string[] = []; const idx = new Map<string, number>()
  const intern = (s: string) => { let i = idx.get(s); if (i === undefined) { i = strings.length; strings.push(s); idx.set(s, i) } return i }
  const rows = runs.map((r) => COLS.map((c) => {
    const v = (r as any)[c]
    if (INTERN.has(c)) return intern(String(v ?? ""))
    if (BOOL.has(c)) return v ? 1 : 0
    if (c === "ui_checks") return v ? [v.builds ? 1 : 0, v.renders ? 1 : 0, v.console_errors, v.states_present] : null
    return v
  }))
  const pausedFile = join(paths(cfg).state, "paused.json")
  const paused = existsSync(pausedFile) ? { since: readJson<any>(pausedFile)?.since ?? "", items: [] } : null
  const data = {
    sample: false, generated_at: now.toISOString(), benches, tasks: [...tasks.values()], contenders, machines,
    suites: suites.map((s) => ({ contender: s.contender, machine: s.machine, version: s.version, calibrated_at: s.calibrated_at, tasks: s.tasks.map((t) => t.id) })),
    // usage/budget fields are stripped even from older day files: they describe the person's subscription
    events, run_days: days.map(({ usage_pct_of_weekly, budget_pct, ceiling_pct, usage_before, usage_after, ...pub }: any) => (void [usage_pct_of_weekly, budget_pct, ceiling_pct, usage_before, usage_after], pub)),
    runs_compact: { cols: COLS, intern: [...INTERN], strings, rows }, paused,
  }
  const out = join(cfg.repo_dir, "site", "data", "runs.js")
  mkdirSync(join(out, ".."), { recursive: true })
  writeFileSync(out, "// Generated by runner/index.ts from results/. Do not edit.\nwindow.SLACKOMETER_DATA = " + JSON.stringify(data) + ";\n")
  return { runs: runs.length, days: days.length }
}
