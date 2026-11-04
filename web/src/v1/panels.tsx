import { useMemo } from "react"
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart"
import { Robot, type RobotName } from "@/components/robot"
import { Pick, type UIState } from "@/v1/App"
import { cn } from "@/lib/utils"
import {
  CONT, D, F, LEVELS, M, RUNS, TASK, agg, contendersWithData, daily, effortsOf, filterRuns, fmtDate, fmtDay, groupBy,
  rangeDates, runDaysFor, sharedTasks, uniq, type Effort, type MetricKey, type Run, type Verdict,
} from "@/lib/data"

export const LEVEL_VAR: Record<string, string> = { low: "var(--s1)", medium: "var(--s1)", high: "var(--s2)", xhigh: "var(--s3)", max: "var(--s3)" }
export const SLOT_VAR = ["var(--s1)", "var(--s2)", "var(--s3)"]
const EVENTS = () => D.events.map((e) => ({ date: e.date, label: e.label.replace("Claude Code ", "CC ") }))

export function Empty({ robot, title, body }: { robot: RobotName; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <Robot name={robot} className="h-32 w-40" />
      <div className="font-heading text-2xl">{title}</div>
      <p className="max-w-md text-muted-foreground">{body}</p>
    </div>
  )
}

function Panel({ title, note, robot, children, className }: { title: string; note?: string; robot?: RobotName; children: React.ReactNode; className?: string }) {
  return (
    <Card className={cn("doodle gap-3 py-4", className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-3 px-5">
        <div>
          <CardTitle className="font-heading text-2xl">{title}</CardTitle>
          {note && <CardDescription className="text-base">{note}</CardDescription>}
        </div>
        {robot && <Robot name={robot} className="h-16 w-16" decorative />}
      </CardHeader>
      <CardContent className="px-5">{children}</CardContent>
    </Card>
  )
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-base text-muted-foreground">
      {items.map((it) => <span key={it.label} className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 rounded" style={{ background: it.color }} />{it.label}</span>)}
    </div>
  )
}

type Series = { key: string; label: string; color: string }
function ChartTip({ active, payload, label, series, fmt, events }: { active?: boolean; payload?: { dataKey?: string | number; value?: number }[]; label?: string; series: Series[]; fmt: (v: number) => string; events?: { date: string; label: string }[] }) {
  if (!active || !payload?.length) return null
  return (
    <div className="doodle-sm min-w-40 bg-popover px-3 py-2 font-data text-xs">
      <div className="mb-1 text-muted-foreground">{label && /^\d{4}-/.test(label) ? fmtDay(label) : label}</div>
      {series.map((s) => {
        const p = payload.find((x) => x.dataKey === s.key)
        return (
          <div key={s.key} className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground"><span className="inline-block h-0.5 w-3 rounded" style={{ background: s.color }} />{s.label}</span>
            <b className="tabular-nums text-foreground">{p?.value != null && isFinite(p.value) ? fmt(p.value) : "–"}</b>
          </div>
        )
      })}
      {events?.filter((e) => e.date === label).map((e) => <div key={e.label} className="mt-1 border-t pt-1 text-muted-foreground">{e.label}</div>)}
    </div>
  )
}

function Lines({ data, series, fmt, domain, refs = [], height = 210 }: { data: Record<string, number | string>[]; series: Series[]; fmt: (v: number) => string; domain?: [number | "auto", number | "auto"]; refs?: { y: number; label: string }[]; height?: number }) {
  const config = Object.fromEntries(series.map((s) => [s.key, { label: s.label, color: s.color }])) satisfies ChartConfig
  const events = EVENTS().filter((e) => data.some((d) => d.date === e.date))
  return (
    <ChartContainer config={config} className="w-full" style={{ height }}>
      <LineChart data={data} margin={{ top: 18, right: 12, left: 0, bottom: 0 }} accessibilityLayer>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="date" tickFormatter={(d) => fmtDate(String(d))} tickLine={false} axisLine={false} minTickGap={28} />
        <YAxis tickFormatter={(v) => fmt(+v)} width={46} tickLine={false} axisLine={false} domain={domain ?? [0, "auto"]} />
        <ChartTooltip cursor={{ stroke: "var(--muted-foreground)" }} content={<ChartTip series={series} fmt={fmt} events={events} />} />
        {events.map((e) => <ReferenceLine key={e.date} x={e.date} stroke="var(--muted-foreground)" strokeOpacity={0.6} label={{ value: e.label, position: "insideTopLeft", fontSize: 10, fill: "var(--muted-foreground)", dy: -16 }} />)}
        {refs.map((r) => <ReferenceLine key={r.label} y={r.y} stroke="var(--foreground)" strokeOpacity={0.5} label={{ value: r.label, position: "insideTopRight", fontSize: 10, fill: "var(--muted-foreground)" }} />)}
        {series.map((s) => <Line key={s.key} dataKey={s.key} type="linear" stroke={`var(--color-${s.key})`} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} connectNulls={false} isAnimationActive={false} />)}
      </LineChart>
    </ChartContainer>
  )
}

function Columns({ data, series, fmt, height = 210 }: { data: Record<string, number | string>[]; series: Series[]; fmt: (v: number) => string; height?: number }) {
  const config = Object.fromEntries(series.map((s) => [s.key, { label: s.label, color: s.color }])) satisfies ChartConfig
  return (
    <ChartContainer config={config} className="w-full" style={{ height }}>
      <BarChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }} barGap={2} accessibilityLayer>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="group" tickLine={false} axisLine={false} />
        <YAxis tickFormatter={(v) => fmt(+v)} width={46} tickLine={false} axisLine={false} />
        <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={<ChartTip series={series} fmt={fmt} />} />
        {series.map((s) => <Bar key={s.key} dataKey={s.key} fill={`var(--color-${s.key})`} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />)}
      </BarChart>
    </ChartContainer>
  )
}

// ------------------------------------------------------------------- Trend --
export function TrendPanel({ S }: { S: UIState }) {
  const compare = S.contender === "compare"
  const defs = useMemo(() => {
    if (compare) {
      const cids = contendersWithData(S), shared = sharedTasks(S, cids)
      return cids.map((cid, i) => ({ key: "c" + i, label: CONT[cid].label, color: SLOT_VAR[i % 3], rows: daily(S, cid, S.compareEffort, shared) }))
    }
    return effortsOf(S.contender).map((e) => ({ key: e, label: e, color: LEVEL_VAR[e], rows: daily(S, S.contender, e) }))
  }, [S, compare])
  const dates = rangeDates(uniq(defs.flatMap((d) => d.rows.map((r) => r.date))).sort(), S.range)
  if (!dates.length) return <Empty robot="empty" title="No complete run days here" body="Try another machine or bench. The robot is asking the bin." />
  const wide = (k: MetricKey) => dates.map((date) => Object.fromEntries([["date", date], ...defs.map((d) => [d.key, d.rows.find((r) => r.date === date)?.[k] ?? NaN])]))
  const series = defs.map((d) => ({ key: d.key, label: d.label, color: d.color }))
  const eKey: MetricKey = compare ? "outTok" : "effort"
  const charts: [string, string, MetricKey, (v: number) => string, [number | "auto", number | "auto"] | undefined, RobotName | undefined][] = [
    [M[eKey].label, compare ? "Same shared tasks for every model" : "100 = this suite's first weeks. Tokens, tool calls, files read and test runs, blended.", eKey, M[eKey].fmt, compare ? undefined : ["auto", "auto"], "mascot"],
    ["Pass rate", "Share of runs the hidden grader accepted", "passRate", F.pct, [0, 1], undefined],
    ["Said “done!”, wasn't", "False-done rate. Lower is better.", "falseDone", F.pct, [0, "auto"], "falsedone"],
    ["Cost / task", "API-equivalent dollars, not money charged on a subscription", "cost", F.usd, [0, "auto"], "budget"],
  ]
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(460px,100%),1fr))] gap-5">
      {charts.map(([title, note, k, fmt, domain, robot]) => (
        <Panel key={k} title={title} note={note} robot={robot}>
          <Legend items={series} />
          <Lines data={wide(k)} series={series} fmt={fmt} domain={domain} />
        </Panel>
      ))}
      <details className="col-span-full text-base">
        <summary className="cursor-pointer text-muted-foreground">View as a table (for people who don't trust squiggles)</summary>
        <Card className="doodle mt-3 overflow-x-auto px-3 py-2">
          <Table>
            <TableHeader><TableRow><TableHead>Run day</TableHead>{defs.flatMap((d) => [<TableHead key={d.key + "p"} className="text-right">{d.label} pass</TableHead>, <TableHead key={d.key + "e"} className="text-right">{d.label} {eKey === "effort" ? "effort" : "tokens"}</TableHead>])}</TableRow></TableHeader>
            <TableBody>{[...dates].reverse().map((date) => (
              <TableRow key={date}><TableCell>{fmtDay(date)}</TableCell>{defs.flatMap((d) => { const r = d.rows.find((x) => x.date === date); return [<TableCell key={d.key + "p"} className="text-right tabular-nums">{r ? F.pct(r.passRate) : "–"}</TableCell>, <TableCell key={d.key + "e"} className="text-right tabular-nums">{r ? M[eKey].fmt(r[eKey]) : "–"}</TableCell>] })}</TableRow>
            ))}</TableBody>
          </Table>
        </Card>
      </details>
    </div>
  )
}

// ------------------------------------------------------------ Effort levels --
export function LevelsPanel({ S, verdicts }: { S: UIState; verdicts: (Verdict | null)[] }) {
  const keys: MetricKey[] = ["passRate", "falseDone", "outTok", "tools", "files", "ranTests", "verified", "minutes", "cost", "costPerPass", "judge"]
  const compare = S.contender === "compare"
  const cols = compare
    ? (() => { const cids = contendersWithData(S), shared = sharedTasks(S, cids); return cids.map((cid) => { const r = daily(S, cid, S.compareEffort, shared); return { label: CONT[cid].label, L: r[r.length - 1], v: null as Verdict | null } }) })()
    : verdicts.filter((v): v is Verdict => !!v).map((v) => ({ label: v.effort as string, L: v.latest, v }))
  return (
    <Panel title="Effort levels, side by side" note="Red cells are outside that level's normal range. If high is acting like medium, it shows up here." robot="unusual">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow><TableHead>Metric (last run{compare ? ", " + S.compareEffort : ""})</TableHead>{cols.map((c) => <TableHead key={c.label} className="text-right capitalize">{c.label}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{keys.map((k) => (
            <TableRow key={k}>
              <TableCell className="align-top">{M[k].label}{M[k].hint && <div className="text-xs text-muted-foreground">{M[k].hint}</div>}</TableCell>
              {cols.map((c) => {
                const n = c.v?.N[k], x = c.L?.[k] ?? NaN
                const bad = !!n && n.out && (M[k].good === "up" ? n.dir < 0 : M[k].good === "down" ? n.dir > 0 : !!M[k].effort && n.dir < 0)
                return (
                  <TableCell key={c.label} className={cn("text-right align-top tabular-nums", bad && "bg-crit-wash font-semibold text-crit-ink")}>
                    {M[k].fmt(x)}{bad ? (n!.dir < 0 ? " ▼" : " ▲") : ""}
                    {n && !n.baseline && <div className="text-xs font-normal text-muted-foreground">normal {k === "judge" ? `${n.lo.toFixed(1)}–${n.hi.toFixed(1)}` : `${M[k].fmt(n.lo)}–${M[k].fmt(n.hi)}`}</div>}
                  </TableCell>
                )
              })}
            </TableRow>
          ))}</TableBody>
        </Table>
      </div>
    </Panel>
  )
}

// --------------------------------------------------------------- Efficiency --
export function EfficiencyPanel({ S }: { S: UIState }) {
  if (S.contender === "compare") return <Empty robot="compare" title="Pick one model" body="Efficiency by difficulty works on one model at a time. These two are too tangled up." />
  const efforts = effortsOf(S.contender), diffs = ["easy", "medium", "hard"] as const
  const days = runDaysFor(S)
  const keep = new Set(rangeDates(uniq(days.filter((d) => d.status === "complete").map((d) => d.date)).sort(), S.range))
  const runs = filterRuns(S, { contender: S.contender }).filter((r) => keep.has(r.date))
  const A = Object.fromEntries(efforts.map((e) => [e, Object.fromEntries(diffs.map((d) => [d, agg(runs.filter((r) => r.effort === e && TASK[r.task].difficulty === d))]))]))
  const series = efforts.map((e) => ({ key: e, label: e, color: LEVEL_VAR[e] }))
  const bars = (k: "cost" | "costPerPass" | "outTok") => diffs.map((d) => Object.fromEntries([["group", d], ...efforts.map((e) => [e, A[e][d][k]])]))
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(460px,100%),1fr))] gap-5">
        <Panel title="Cost per task" note="By difficulty, over the selected range (API-equivalent $)"><Legend items={series} /><Columns data={bars("cost")} series={series} fmt={F.usd} /></Panel>
        <Panel title="Cost per correct answer" note="What a passing result actually costs. Lower is better."><Legend items={series} /><Columns data={bars("costPerPass")} series={series} fmt={F.usd} /></Panel>
        <Panel title="Output tokens per task" note="How much it wrote, by difficulty"><Legend items={series} /><Columns data={bars("outTok")} series={series} fmt={F.k} /></Panel>
      </div>
      <Panel title="The receipts" note="Everything above, as numbers">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>{["Difficulty · level", "Runs", "Pass", "Cost / task", "Cost / correct", "Out tokens / task", "Out tokens / correct"].map((h, i) => <TableHead key={h} className={i ? "text-right" : ""}>{h}</TableHead>)}</TableRow></TableHeader>
            <TableBody>{diffs.flatMap((d) => efforts.map((e) => { const a = A[e][d]; return (
              <TableRow key={d + e}><TableCell className="capitalize">{d} · {e}</TableCell>{[a.n, F.pct(a.passRate), F.usd(a.cost), F.usd(a.costPerPass), F.k(a.outTok), F.k(a.tokPerPass)].map((v, i) => <TableCell key={i} className="text-right tabular-nums">{v}</TableCell>)}</TableRow>
            ) }))}</TableBody>
          </Table>
        </div>
      </Panel>
    </div>
  )
}

// -------------------------------------------------------------------- Tasks --
const HEAT: Record<string, { label: string; val: (r: Run, maxTok: number) => number; say: (r: Run) => string }> = {
  quality: { label: "Quality (grader score)", val: (r) => (TASK[r.task].ui ? (r.score - 1) / 4 : r.score), say: (r) => (TASK[r.task].ui ? `${r.score} / 5 from the judge` : `${r.tests_passed}/${r.tests_total} hidden tests`) },
  tokens: { label: "Output tokens", val: (r, m) => r.output_tokens / m, say: (r) => `${F.k(r.output_tokens)} tokens` },
  tests: { label: "Ran the tests", val: (r) => (r.ran_tests ? 1 : 0), say: (r) => (r.ran_tests ? "ran the tests" : "didn't run the tests") },
  falsedone: { label: "Said “done”, wasn't", val: (r) => (r.claimed_done && !r.pass ? 1 : 0), say: (r) => (r.claimed_done && !r.pass ? "claimed done, failed" : "honest") },
}
export function TasksPanel({ S, set }: { S: UIState; set: (p: Partial<UIState>) => void }) {
  if (S.contender === "compare") return <Empty robot="compare" title="Pick one model" body="The task grid shows one model at a time." />
  const efforts = effortsOf(S.contender), eff = efforts.includes(S.heatEffort) ? S.heatEffort : efforts[0]
  const runs = filterRuns(S, { contender: S.contender, effort: eff })
  const dates = rangeDates(uniq(runs.map((r) => r.date)).sort(), S.range)
  const tasks = uniq(runs.filter((r) => dates.includes(r.date)).map((r) => r.task)).sort((a, b) => TASK[a].language.localeCompare(TASK[b].language) || a.localeCompare(b))
  const by = groupBy(runs, (r) => r.task + "|" + r.date)
  const maxTok = Object.fromEntries(tasks.map((t) => [t, Math.max(...runs.filter((r) => r.task === t).map((r) => r.output_tokens))]))
  const h = HEAT[S.heatMetric] ?? HEAT.quality
  const open = (t: string, d: string) => set({ tab: "runs", runsDate: d, runSel: t + "|" + eff })
  return (
    <Panel title="Tasks × run days" note="Click a square to open that run." robot="baseline">
      <div className="mb-4 flex flex-wrap gap-4">
        <label className="flex flex-col gap-1"><span className="text-sm text-muted-foreground">Effort level</span><Pick label="Effort level" value={eff} onChange={(v) => set({ heatEffort: v as Effort })} groups={[{ items: efforts.map((e) => ({ value: e, label: e })) }]} /></label>
        <label className="flex flex-col gap-1"><span className="text-sm text-muted-foreground">Colour by</span><Pick label="Colour by" value={S.heatMetric} onChange={(v) => set({ heatMetric: v })} groups={[{ items: Object.entries(HEAT).map(([k, m]) => ({ value: k, label: m.label })) }]} className="min-w-56" /></label>
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[640px] items-center gap-[3px] font-data text-xs" style={{ gridTemplateColumns: `minmax(170px, 260px) repeat(${dates.length}, minmax(14px, 1fr))` }}>
          <div />
          {dates.map((d) => <div key={d} className="h-11 rotate-180 text-center text-[10.5px] text-muted-foreground [writing-mode:vertical-rl]">{fmtDate(d)}</div>)}
          {tasks.map((t) => [
            <div key={t} className="truncate pr-2 text-[13px]" title={TASK[t].title}>{TASK[t].title}</div>,
            ...dates.map((d) => {
              const r = by[t + "|" + d]?.[0]
              if (!r) return <div key={t + d} className="h-6 rounded-[3px]" style={{ background: "repeating-linear-gradient(45deg, transparent 0 3px, var(--border) 3px 4px)" }} title="Not run" />
              const v = Math.max(0, Math.min(1, h.val(r, maxTok[t])))
              return (
                <Tooltip key={t + d}>
                  <TooltipTrigger asChild>
                    <button type="button" onClick={() => open(t, d)} aria-label={`${TASK[t].title}, ${fmtDay(d)}: ${r.pass ? "passed" : "failed"}, ${h.say(r)}`}
                      className="h-6 rounded-[3px] outline-offset-1 hover:outline-2 hover:outline-foreground focus-visible:outline-2" style={{ background: `var(--seq-${Math.round(v * 6)})` }} />
                  </TooltipTrigger>
                  <TooltipContent className="font-data"><b>{r.pass ? "✓ passed" : "✗ failed"}</b> · {h.say(r)}<br />{fmtDay(d)}</TooltipContent>
                </Tooltip>
              )
            }),
          ])}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 font-data text-xs text-muted-foreground">
        <span>low</span>{[0, 1, 2, 3, 4, 5, 6].map((i) => <i key={i} className="inline-block h-2.5 w-5 rounded-sm" style={{ background: `var(--seq-${i})` }} />)}<span>high</span>
        <i className="ml-4 inline-block h-2.5 w-5 rounded-sm" style={{ background: "repeating-linear-gradient(45deg, transparent 0 3px, var(--border) 3px 4px)" }} /><span>not run</span>
      </div>
    </Panel>
  )
}

// --------------------------------------------------------------------- Runs --
export function RunsPanel({ S, set }: { S: UIState; set: (p: Partial<UIState>) => void }) {
  if (S.contender === "compare") return <Empty robot="compare" title="Pick one model" body="Browse runs for one model at a time." />
  const all = filterRuns(S, { contender: S.contender })
  const dates = uniq(all.map((r) => r.date)).sort().reverse()
  if (!dates.length) return <Empty robot="empty" title="No runs" body="Not a single one. The bin has heard everything." />
  const date = S.runsDate && dates.includes(S.runsDate) ? S.runsDate : dates[0]
  const runs = all.filter((r) => r.date === date).sort((a, b) => a.task.localeCompare(b.task) || LEVELS.indexOf(a.effort) - LEVELS.indexOf(b.effort))
  const key = (r: Run) => r.task + "|" + r.effort + (S.machine === "everyone" ? "|" + r.machine : "")
  const sel = runs.find((r) => key(r) === S.runSel) ?? runs.find((r) => r.claimed_done && !r.pass) ?? runs[0]
  const t = TASK[sel.task], liar = sel.claimed_done && !sel.pass
  return (
    <div className="flex flex-col gap-4">
      <label className="flex w-fit flex-col gap-1"><span className="text-sm text-muted-foreground">Run day</span><Pick label="Run day" value={date} onChange={(v) => set({ runsDate: v, runSel: null })} groups={[{ items: dates.map((d) => ({ value: d, label: fmtDay(d) })) }]} /></label>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card className="doodle overflow-x-auto px-3 py-2">
          <Table>
            <TableHeader><TableRow>{["Task", "Level", "Result", "Claimed", "Ran tests", "Tokens", "Cost"].map((h, i) => <TableHead key={h} className={i > 3 ? "text-right" : ""}>{h}</TableHead>)}</TableRow></TableHeader>
            <TableBody>{runs.map((r) => (
              <TableRow key={key(r)} data-state={r === sel ? "selected" : undefined} tabIndex={0} className="cursor-pointer" onClick={() => set({ runsDate: date, runSel: key(r) })} onKeyDown={(e) => e.key === "Enter" && set({ runsDate: date, runSel: key(r) })}>
                <TableCell className="max-w-56 truncate">{TASK[r.task].title}{S.machine === "everyone" && <span className="text-muted-foreground"> · {r.machine}</span>}</TableCell>
                <TableCell><span className="inline-flex items-center gap-1.5 capitalize"><span className="inline-block h-0.5 w-3 rounded" style={{ background: LEVEL_VAR[r.effort] }} />{r.effort}</span></TableCell>
                <TableCell>{r.pass ? <Badge variant="outline" className="text-good-ink">✓ pass</Badge> : <Badge variant="outline">✗ fail</Badge>}</TableCell>
                <TableCell>{r.claimed_done && !r.pass ? <Badge className="bg-crit text-white">📦 fibbed</Badge> : r.claimed_done ? "done" : <span className="text-muted-foreground">unsure</span>}</TableCell>
                <TableCell className="text-right">{r.ran_tests ? "yes" : "no"}</TableCell>
                <TableCell className="text-right tabular-nums">{F.k(r.output_tokens)}</TableCell>
                <TableCell className="text-right tabular-nums">{F.usd(r.cost_usd)}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        </Card>
        <Card className={cn("doodle gap-3 px-5 py-4 lg:sticky lg:top-4 lg:self-start", liar && "bg-crit-wash")}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-heading text-2xl leading-tight">{t.title}</div>
              <div className="text-sm text-muted-foreground">{t.language} · {t.kind} · {t.difficulty} · <span className="capitalize">{sel.effort}</span> · {sel.machine} · {fmtDay(sel.date)} · CC {sel.cc_version}</div>
            </div>
            <Robot name={liar ? "falsedone" : sel.pass ? "normal" : "unusual"} className="h-20 w-16" />
          </div>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 font-data text-sm">
            <dt className="text-muted-foreground">Result</dt><dd className="text-right">{sel.pass ? "✓ pass" : "✗ fail"}</dd>
            {t.ui && sel.ui_checks ? <>
              <dt className="text-muted-foreground">UI hard checks</dt><dd className="text-right">{sel.ui_checks.renders ? "renders" : "doesn't render"}, {sel.ui_checks.console_errors} console errors, {sel.ui_checks.states_present}/3 states</dd>
              <dt className="text-muted-foreground">Judge score (secondary)</dt><dd className="text-right">{F.n1(sel.score)} / 5</dd>
            </> : <><dt className="text-muted-foreground">Hidden tests</dt><dd className="text-right">{sel.tests_passed} / {sel.tests_total}</dd></>}
            <dt className="text-muted-foreground">Ran the tests</dt><dd className="text-right">{sel.ran_tests ? "yes" : "no"}</dd>
            <dt className="text-muted-foreground">Re-ran after last edit</dt><dd className="text-right">{sel.verified_after_last_edit ? "yes" : "no"}</dd>
            <dt className="text-muted-foreground">Output tokens</dt><dd className="text-right tabular-nums">{sel.output_tokens.toLocaleString()}</dd>
            <dt className="text-muted-foreground">Input / cache read</dt><dd className="text-right tabular-nums">{F.k(sel.input_tokens)} / {F.k(sel.cache_read_tokens)}</dd>
            <dt className="text-muted-foreground">Tool calls · files read</dt><dd className="text-right tabular-nums">{sel.tool_calls} · {sel.files_read}</dd>
            <dt className="text-muted-foreground">Time</dt><dd className="text-right">{sel.minutes} min</dd>
            <dt className="text-muted-foreground">Cost (API-equiv.)</dt><dd className="text-right">{F.usd(sel.cost_usd)}</dd>
          </dl>
          <div>
            <div className="text-sm text-muted-foreground">What it said at the end</div>
            <p className="text-lg italic">“{sel.claim_text}”</p>
            {liar && <Badge className="mt-1 bg-crit text-white">📦 Box on head: it said done, the grader disagrees</Badge>}
          </div>
          <div><div className="text-sm text-muted-foreground">What it actually did</div><p className="text-base">{sel.digest}</p></div>
          <p className="text-xs text-muted-foreground">Full transcript stays on {sel.machine}.</p>
        </Card>
      </div>
    </div>
  )
}

// ------------------------------------------------------- Which setting card --
export function SettingPanel({ S, set }: { S: UIState; set: (p: Partial<UIState>) => void }) {
  const current = D.contenders.find((c) => !c.retired) ?? D.contenders[0]
  const cid = S.contender === "compare" ? current.id : S.contender
  const efforts = effortsOf(cid)
  const runs = RUNS.filter((r) => r.contender === cid && (S.bench === "all" || r.bench === S.bench)) // everyone's runs, on purpose
  const groups = groupBy(runs, (r) => (S.recoBy === "kind" ? TASK[r.task].kind : TASK[r.task].language))
  const MIN_N = 20
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-3xl text-base text-muted-foreground">{CONT[cid].label}, from everyone's runs ({uniq(runs.map((r) => r.machine)).length} machines, {runs.length.toLocaleString()} runs). The pick is the cheapest level within 5 points of the best pass rate. Recent slacking pulls these numbers down.</p>
        <ToggleGroup type="single" variant="outline" value={S.recoBy} onValueChange={(v) => v && set({ recoBy: v as "kind" | "language" })} className="doodle-sm bg-card" spacing={0}>
          <ToggleGroupItem value="kind">Kind of work</ToggleGroupItem>
          <ToggleGroupItem value="language">Language</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-5">
        {Object.entries(groups).sort((a, b) => b[1].length - a[1].length).map(([g, rs], i) => {
          const per = efforts.map((e) => ({ e, a: agg(rs.filter((r) => r.effort === e)) }))
          const enough = per.every((p) => p.a.n >= MIN_N)
          const best = Math.max(...per.map((p) => p.a.passRate))
          const pick = enough ? per.filter((p) => p.a.passRate >= best - 0.05).sort((x, y) => x.a.costPerPass - y.a.costPerPass)[0] : null
          return (
            <Card key={g} className={cn("doodle gap-2 px-5 py-4", i % 3 === 1 ? "tilt-r" : i % 3 === 2 ? "tilt-l" : "")}>
              <div className="text-base capitalize text-muted-foreground">{g}</div>
              {pick ? <div className="flex items-center gap-2 font-heading text-4xl capitalize"><span className="inline-block h-1 w-6 rounded" style={{ background: LEVEL_VAR[pick.e] }} />use {pick.e}</div>
                : <div className="flex items-center gap-2"><Robot name="baseline" className="h-12 w-10" decorative /><span className="font-heading text-2xl text-muted-foreground">Not enough data yet</span></div>}
              <p className="text-sm text-muted-foreground">{pick ? "Cheapest correct answer without losing quality." : `Needs ${MIN_N}+ runs at every level.`}</p>
              <Table className="[&_td]:px-1.5 [&_th]:px-1.5">
                <TableHeader><TableRow><TableHead>Level</TableHead><TableHead className="text-right">Runs</TableHead><TableHead className="text-right">Pass</TableHead><TableHead className="text-right whitespace-nowrap">$ / correct</TableHead></TableRow></TableHeader>
                <TableBody>{per.map((p) => (
                  <TableRow key={p.e} className={pick?.e === p.e ? "font-semibold" : ""}>
                    <TableCell><span className="inline-flex items-center gap-1.5 capitalize"><span className="inline-block h-0.5 w-3 rounded" style={{ background: LEVEL_VAR[p.e] }} />{p.e}</span></TableCell>
                    <TableCell className="text-right tabular-nums">{p.a.n}</TableCell><TableCell className="text-right tabular-nums">{F.pct(p.a.passRate)}</TableCell><TableCell className="text-right tabular-nums">{F.usd(p.a.costPerPass)}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            </Card>
          )
        })}
      </div>
    </div>
  )
}


// shared with v2
export { Lines as LinesExport }
