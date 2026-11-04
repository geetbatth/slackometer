// Data model + all the maths behind the page (normal ranges, verdicts, aggregates).
// Reads window.SLACKOMETER_DATA, which public/data/runs.js sets (written by the
// runner's index step, or tools/make-sample-data.mjs for sample data).

export type Effort = "low" | "medium" | "high" | "xhigh" | "max"
export interface Task { id: string; bench: string; title: string; language: string; kind: string; difficulty: "easy" | "medium" | "hard"; version: number; ui: boolean; added_by: string }
export interface Contender { id: string; tool: string; model: string; label: string; efforts: Effort[]; retired: boolean }
export interface Machine { id: string; person: string; os: string }
export interface Suite { contender: string; machine: string; version: number; calibrated_at: string; tasks: string[] }
export interface Bench { id: string; name: string; owner: string; description: string }
export interface RunDay { date: string; machine: string; contender: string; suite_version: number; cc_version: string; status: "complete" | "incomplete"; incomplete_reason: string | null; cost_usd: number }
export interface Run {
  date: string; machine: string; contender: string; effort: Effort; task: string; bench: string; task_version: number; suite_version: number; cc_version: string
  end: string; pass: boolean; score: number; tests_passed: number; tests_total: number
  ui_checks: { builds: boolean; renders: boolean; console_errors: number; states_present: number } | null
  output_tokens: number; input_tokens: number; cache_read_tokens: number; cache_write_tokens: number; cost_usd: number
  tool_calls: number; files_read: number; ran_tests: boolean; verified_after_last_edit: boolean; minutes: number
  claimed_done: boolean; claim_text: string; digest: string
}
interface Raw {
  sample?: boolean; generated_at: string; benches: Bench[]; tasks: Task[]; contenders: Contender[]; machines: Machine[]; suites: Suite[]
  events: { date: string; type: string; label: string }[]; run_days: RunDay[]; runs?: Run[]
  runs_compact?: { cols: string[]; intern: string[]; strings: string[]; rows: unknown[][] }
  paused: { since: string; items: string[] } | null
}

declare global { interface Window { SLACKOMETER_DATA?: Raw } }

const BOOL = new Set(["pass", "ran_tests", "verified_after_last_edit", "claimed_done"])
function expand(c: NonNullable<Raw["runs_compact"]>): Run[] {
  const intern = new Set(c.intern)
  return c.rows.map((row) => {
    const o: Record<string, unknown> = {}
    c.cols.forEach((col, i) => {
      let v = row[i]
      if (intern.has(col)) v = c.strings[v as number]
      else if (BOOL.has(col)) v = !!v
      else if (col === "ui_checks") { const a = v as number[] | null; v = a ? { builds: !!a[0], renders: !!a[1], console_errors: a[2], states_present: a[3] } : null }
      o[col] = v
    })
    return o as unknown as Run
  })
}

export const RAW: Raw | undefined = window.SLACKOMETER_DATA
export const D = RAW!
export const RUNS: Run[] = RAW ? RAW.runs ?? expand(RAW.runs_compact!) : []
export const TASK: Record<string, Task> = Object.fromEntries((RAW?.tasks ?? []).map((t) => [t.id, t]))
export const CONT: Record<string, Contender> = Object.fromEntries((RAW?.contenders ?? []).map((c) => [c.id, c]))
const dayKey = (m: string, d: string, c: string) => `${m}|${d}|${c}`
const DAY: Record<string, RunDay> = Object.fromEntries((RAW?.run_days ?? []).map((d) => [dayKey(d.machine, d.date, d.contender), d]))
export const LEVELS: Effort[] = ["low", "medium", "high", "xhigh", "max"]

// ------------------------------------------------------------------ utils --
export const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN)
export const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)
export const median = (a: number[]) => { if (!a.length) return NaN; const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2 }
export const uniq = <T,>(a: T[]) => [...new Set(a)]
export function groupBy<T>(a: T[], f: (x: T) => string) { const m: Record<string, T[]> = {}; for (const x of a) (m[f(x)] ??= []).push(x); return m }
export const fmtDate = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric" })
export const fmtDay = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
export const F = {
  pct: (x: number) => (isFinite(x) ? Math.round(x * 100) + "%" : "–"),
  k: (x: number) => (!isFinite(x) ? "–" : x >= 1000 ? (x / 1000).toFixed(x >= 10000 ? 0 : 1) + "k" : Math.round(x).toString()),
  n1: (x: number) => (isFinite(x) ? x.toFixed(1) : "–"),
  usd: (x: number) => (isFinite(x) ? "$" + x.toFixed(2) : "–"),
  idx: (x: number) => (isFinite(x) ? Math.round(x).toString() : "–"),
  j: (x: number) => (isFinite(x) ? x.toFixed(1) + " / 5" : "–"),
}

// --------------------------------------------------------------- metrics --
export type MetricKey = "passRate" | "falseDone" | "effort" | "outTok" | "tools" | "files" | "ranTests" | "verified" | "minutes" | "cost" | "costPerPass" | "judge"
export const M: Record<MetricKey, { label: string; fmt: (x: number) => string; good: "up" | "down" | null; kind: "rate" | "rel" | "abs"; effort?: boolean; hint?: string }> = {
  passRate: { label: "Pass rate", fmt: F.pct, good: "up", kind: "rate" },
  falseDone: { label: "False-done rate", fmt: F.pct, good: "down", kind: "rate", hint: "Said “done!”, grader said “no”" },
  effort: { label: "Effort index", fmt: F.idx, good: null, kind: "rel", hint: "100 = this suite's first weeks" },
  outTok: { label: "Output tokens / task", fmt: F.k, good: null, kind: "rel", effort: true },
  tools: { label: "Tool calls / task", fmt: F.n1, good: null, kind: "rel", effort: true },
  files: { label: "Files read / task", fmt: F.n1, good: null, kind: "rel", effort: true },
  ranTests: { label: "Ran the tests", fmt: F.pct, good: "up", kind: "rate", effort: true },
  verified: { label: "Re-ran tests after last edit", fmt: F.pct, good: "up", kind: "rate", effort: true },
  minutes: { label: "Minutes / task", fmt: F.n1, good: null, kind: "rel" },
  cost: { label: "Cost / task", fmt: F.usd, good: "down", kind: "rel", hint: "API-equivalent $" },
  costPerPass: { label: "Cost / correct answer", fmt: F.usd, good: "down", kind: "rel" },
  judge: { label: "UI judge score", fmt: F.j, good: "up", kind: "abs", hint: "Secondary signal" },
}

export interface Agg { n: number; passes: number; passRate: number; falseDone: number; outTok: number; tools: number; files: number; ranTests: number; ranTestsN: number; verified: number; minutes: number; cost: number; costPerPass: number; tokPerPass: number; judge: number; effort: number }
export function agg(runs: Run[]): Agg {
  const n = runs.length, passes = runs.filter((r) => r.pass).length
  const ui = runs.filter((r) => TASK[r.task]?.ui)
  return {
    n, passes, passRate: passes / n,
    falseDone: runs.filter((r) => r.claimed_done && !r.pass).length / n,
    outTok: mean(runs.map((r) => r.output_tokens)), tools: mean(runs.map((r) => r.tool_calls)), files: mean(runs.map((r) => r.files_read)),
    ranTests: runs.filter((r) => r.ran_tests).length / n, ranTestsN: runs.filter((r) => r.ran_tests).length,
    verified: runs.filter((r) => r.verified_after_last_edit).length / n,
    minutes: mean(runs.map((r) => r.minutes)), cost: mean(runs.map((r) => r.cost_usd)),
    costPerPass: passes ? sum(runs.map((r) => r.cost_usd)) / passes : NaN,
    tokPerPass: passes ? sum(runs.map((r) => r.output_tokens)) / passes : NaN,
    judge: ui.length ? mean(ui.map((r) => r.score)) : NaN, effort: NaN,
  }
}

// ---------------------------------------------------------------- filters --
export interface Filters { bench: string; contender: string; machine: string; range: number }
const isComplete = (r: Run) => { const d = DAY[dayKey(r.machine, r.date, r.contender)]; return !d || d.status === "complete" }
export function filterRuns(f: Filters, o: { contender?: string; effort?: Effort; tasks?: Set<string>; anyMachine?: boolean } = {}) {
  return RUNS.filter((r) =>
    (o.anyMachine || f.machine === "everyone" || r.machine === f.machine) &&
    (!o.contender || r.contender === o.contender) &&
    (!o.effort || r.effort === o.effort) &&
    (f.bench === "all" || r.bench === f.bench) &&
    (!o.tasks || o.tasks.has(r.task)) && isComplete(r))
}

export type DayRow = Agg & { date: string; runs: Run[] }
export function daily(f: Filters, contender: string, effort: Effort, tasks?: Set<string>): DayRow[] {
  let runs = filterRuns(f, { contender, effort, tasks })
  if (f.machine !== "everyone" && runs.length) { const v = Math.max(...runs.map((r) => r.suite_version)); runs = runs.filter((r) => r.suite_version === v) }
  const by = groupBy(runs, (r) => r.date)
  const rows: DayRow[] = Object.keys(by).sort().map((d) => ({ date: d, ...agg(by[d]), runs: by[d] }))
  const base = rows.slice(0, 8)
  const b = { outTok: median(base.map((x) => x.outTok)), tools: median(base.map((x) => x.tools)), files: median(base.map((x) => x.files)), ranTests: median(base.map((x) => x.ranTests)) }
  rows.forEach((x) => { x.effort = 100 * mean([x.outTok / b.outTok, x.tools / b.tools, x.files / b.files, x.ranTests / b.ranTests]) })
  return rows
}

export interface Normal { baseline: boolean; med: number; lo: number; hi: number; dir: -1 | 0 | 1; out: boolean; rel: number }
export function normal(x: number, prior: DayRow[], key: MetricKey): Normal {
  const vals = prior.map((p) => p[key]).filter(isFinite)
  const med = median(vals)
  if (vals.length < 4 || !isFinite(x)) return { baseline: true, med, lo: NaN, hi: NaN, dir: 0, out: false, rel: NaN }
  const mad = median(vals.map((v) => Math.abs(v - med)))
  const kind = M[key].kind
  const floor = kind === "rate" ? 0.15 : kind === "abs" ? 0.4 : 0.15 * Math.abs(med)
  const thr = Math.max(3 * 1.4826 * mad, floor)
  const dir = x < med - thr ? -1 : x > med + thr ? 1 : 0
  const cl = kind === "rate" ? [0, 1] : kind === "abs" ? [1, 5] : [0, Infinity]
  return { baseline: false, med, lo: Math.max(cl[0], med - thr), hi: Math.min(cl[1], med + thr), dir, out: dir !== 0, rel: med ? x / med - 1 : NaN }
}

export type Status = "slacking" | "unusual" | "leaner" | "normal" | "baseline"
export interface Verdict { effort: Effort; latest: DayRow; prior: DayRow[]; N: Record<MetricKey, Normal>; rows: DayRow[]; status: Status }
const KEYS: MetricKey[] = ["passRate", "falseDone", "effort", "outTok", "tools", "files", "ranTests", "verified", "minutes", "cost", "costPerPass", "judge"]
export function verdictFor(f: Filters, contender: string, effort: Effort): Verdict | null {
  const rows = daily(f, contender, effort)
  if (!rows.length) return null
  const latest = rows[rows.length - 1], prior = rows.slice(-9, -1)
  const N = Object.fromEntries(KEYS.map((k) => [k, normal(latest[k], prior, k)])) as Record<MetricKey, Normal>
  let status: Status = "normal"
  if (prior.length < 4) status = "baseline"
  else {
    const effortDown = (["outTok", "tools", "ranTests", "verified", "effort"] as MetricKey[]).some((k) => N[k].dir < 0)
    const qualityDown = N.passRate.dir < 0 || N.falseDone.dir > 0
    const skipped = N.ranTests.dir < 0 || N.verified.dir < 0
    if (effortDown && (qualityDown || skipped)) status = "slacking"
    else if ((N.outTok.dir < 0 || N.cost.dir < 0) && !qualityDown) status = "leaner"
    else if (KEYS.some((k) => k !== "judge" && N[k].out)) status = "unusual"
  }
  return { effort, latest, prior, N, rows, status }
}

export const effortsOf = (cid: string): Effort[] => CONT[cid]?.efforts ?? []
export const contendersWithData = (f: Filters) => uniq(filterRuns(f).map((r) => r.contender)).sort((a, b) => Number(CONT[a].retired) - Number(CONT[b].retired))
export function sharedTasks(f: Filters, cids: string[]) {
  const sets = cids.map((c) => new Set(filterRuns(f, { contender: c }).map((r) => r.task)))
  return new Set([...(sets[0] ?? [])].filter((t) => sets.every((x) => x.has(t))))
}
export function runDaysFor(f: Filters) {
  return (RAW?.run_days ?? []).filter((d) => (f.machine === "everyone" || d.machine === f.machine) && (f.contender === "compare" || d.contender === f.contender)).sort((a, b) => a.date.localeCompare(b.date))
}
export const rangeDates = (dates: string[], range: number) => (range ? dates.slice(-range) : dates)
