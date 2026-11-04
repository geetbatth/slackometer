import { useEffect, useMemo, useState } from "react"
import { Moon, Sun, ArrowUpRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Robot, type RobotName } from "@/components/robot"
import { Pick, initialState, store, useTheme, type UIState } from "@/v1/App"
import { EfficiencyPanel, LevelsPanel, RunsPanel, SettingPanel, TasksPanel, LEVEL_VAR, SLOT_VAR, LinesExport as LinesProxy } from "@/v1/panels"
import { CONT, D, F, M, RAW, RUNS, TASK, agg, contendersWithData, daily, effortsOf, filterRuns, fmtDate, fmtDay, groupBy, runDaysFor, rangeDates, sharedTasks, uniq, verdictFor, type Effort, type Verdict, type Run } from "@/lib/data"
import { Gauge, Rough, Spark, SectionTitle, Squiggle, zoneOf, type Needle } from "@/v2/parts"
import { findMoments, type Moment } from "@/v2/moments"
import { cn } from "@/lib/utils"

const HASH_KEYS = ["tab", "bench", "contender", "machine", "range"] as const
const TILT = ["-rotate-2", "rotate-1", "-rotate-1", "rotate-2", "rotate-0", "-rotate-[1.5deg]"]
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x))

/** 0 = overachieving … 1 = slacking. Effort vs its own normal, plus penalties for skipped steps and fibs. */
function slackScore(v: Verdict | null): number | null {
  if (!v || v.status === "baseline") return null
  const r = v.latest.effort / v.N.effort.med
  let s = clamp((1.3 - r) / 0.9)
  for (const bad of [v.N.ranTests.dir < 0, v.N.verified.dir < 0, v.N.falseDone.dir > 0, v.N.passRate.dir < 0]) if (bad) s += 0.12
  return clamp(s, 0.02, 0.98)
}
const ROBOT_FOR: Record<string, RobotName> = { slacking: "asleep", unusual: "shrug", leaner: "piggy", normal: "inspect", baseline: "measure" }
const STATUS_TXT: Record<string, string> = { slacking: "Caught napping", unusual: "Acting weird", leaner: "Leaner, same results", normal: "Doing its job", baseline: "Still measuring" }
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1])

export default function AppV2() {
  const [S, setS] = useState<UIState>(() => { const s = initialState(); if (s.tab === "trend") s.tab = "levels"; return s })
  const [dark, setDark] = useTheme()
  const [openMoment, setOpenMoment] = useState<Moment | null>(null)
  const [showAll, setShowAll] = useState(false)
  const set = (p: Partial<UIState>) => setS((prev) => ({ ...prev, ...p }))
  useEffect(() => {
    HASH_KEYS.forEach((k) => store.set(k, S[k]))
    try { history.replaceState(null, location.pathname + location.search, "#" + new URLSearchParams(HASH_KEYS.map((k) => [k, String(S[k])])).toString()) } catch { /* ignore */ }
  }, [S])

  const compare = S.contender === "compare"
  const efforts = compare ? [] : effortsOf(S.contender)
  const verdicts = useMemo(() => efforts.map((e) => verdictFor(S, S.contender, e)), [S.bench, S.contender, S.machine]) // eslint-disable-line react-hooks/exhaustive-deps
  const days = runDaysFor(S), lastDay = days[days.length - 1]

  // compare mode: one needle per model at the chosen level
  const cids = compare ? contendersWithData(S) : []
  const shared = compare ? sharedTasks(S, cids) : undefined

  const needles: Needle[] = compare
    ? cids.map((cid, i) => {
        const rows = daily(S, cid, S.compareEffort, shared), L = rows[rows.length - 1], prior = rows.slice(-9, -1)
        const med = prior.length ? prior.map((p) => p.effort).sort((a, b) => a - b)[prior.length >> 1] : NaN
        return { key: cid, label: CONT[cid].label, color: SLOT_VAR[i % 3], score: L && isFinite(med) ? clamp((1.3 - L.effort / med) / 0.9, 0.02, 0.98) : null }
      })
    : verdicts.map((v, i) => ({ key: efforts[i], label: efforts[i], color: LEVEL_VAR[efforts[i]], score: slackScore(v) }))

  // moments from the latest run day
  const latestDate = lastDay?.date
  const contRuns = compare ? [] : filterRuns(S, { contender: S.contender })
  const moments = useMemo(() => (latestDate && !compare ? findMoments(contRuns.filter((r) => r.date === latestDate), contRuns) : []), [latestDate, S.bench, S.contender, S.machine]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!RAW) return <div className="p-10 text-center"><Robot name="empty" className="mx-auto h-40 w-48" /><p className="font-heading text-2xl">No data/runs.js found. The robot is asking the bin.</p></div>

  const slackers = verdicts.filter((v): v is Verdict => !!v && v.status === "slacking")
  const fine = verdicts.filter((v): v is Verdict => !!v && v.status !== "slacking")
  const headline = compare ? `${list(cids.map((c) => CONT[c].label))}, head to head`
    : slackers.length ? `${list(slackers.map((v) => v.effort))} got lazy.`
    : verdicts.some((v) => v?.status === "unusual") ? "Something's a bit off." : "Everyone's trying. Suspicious."

  return (
    <div className="min-h-screen">
      {/* ---------------- sticky toolbar ---------------- */}
      <header className="sticky top-0 z-30 border-b-2 border-foreground/80 bg-background/92 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
          <a href="#top" className="flex items-center gap-2"><Robot name="mascot" className="h-11 w-9" decorative /><span className="poster-title text-2xl">Slackometer</span></a>
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <Pick label="Bench" value={S.bench} onChange={(v) => set({ bench: v })} className="h-8 min-w-32" groups={[{ items: [{ value: "all", label: "All benches" }, ...D.benches.map((b) => ({ value: b.id, label: b.name }))] }]} />
            <Pick label="Model" value={S.contender} onChange={(v) => set({ contender: v })} className="h-8 min-w-32" groups={[
              { label: "Current", items: D.contenders.filter((c) => !c.retired).map((c) => ({ value: c.id, label: c.label })) },
              ...(D.contenders.some((c) => c.retired) ? [{ label: "Retired", items: D.contenders.filter((c) => c.retired).map((c) => ({ value: c.id, label: c.label + " (retired)" })) }] : []),
              { label: "Compare", items: [{ value: "compare", label: "Compare models…" }] },
            ]} />
            <Pick label="Machine" value={S.machine} onChange={(v) => set({ machine: v })} className="h-8 min-w-32" groups={[{ items: [...D.machines.map((m) => ({ value: m.id, label: m.id })), { value: "everyone", label: "Everyone" }] }]} />
            {compare && <Pick label="Effort level" value={S.compareEffort} onChange={(v) => set({ compareEffort: v as Effort })} className="h-8 min-w-24" groups={[{ items: ["medium", "high", "xhigh"].map((x) => ({ value: x, label: x })) }]} />}
            <ToggleGroup type="single" variant="outline" size="sm" value={String(S.range)} onValueChange={(v) => v && set({ range: +v })} spacing={0} className="bg-card" aria-label="Range">
              <ToggleGroupItem value="8">8 runs</ToggleGroupItem><ToggleGroupItem value="26">26</ToggleGroupItem><ToggleGroupItem value="0">All</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <nav className="hidden items-center gap-3 text-base lg:flex" aria-label="Sections">
            {[["verdict", "Verdict"], ["moments", "Dumb moments"], ["trends", "Trends"], ["cheat", "Cheat sheet"], ["details", "Details"]].map(([id, l]) => <a key={id} href={"#" + id} onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }) }} className="hover:underline">{l}</a>)}
          </nav>
          <Button variant="outline" size="icon-sm" className="bg-card" onClick={() => setDark(!dark)} aria-label={dark ? "Graph paper (light)" : "Blueprint (dark)"}>{dark ? <Sun /> : <Moon />}</Button>
        </div>
      </header>

      <main id="top" className="mx-auto max-w-[1240px] px-4 pb-20">
        {/* ---------------- verdict hero ---------------- */}
        <section id="verdict" className="grid scroll-mt-24 items-center gap-8 pt-8 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-lg text-muted-foreground">
              {lastDay && <span>Verdict for <b className="text-foreground">{fmtDay(lastDay.date)}</b></span>}
              <span>· {compare ? `at ${S.compareEffort}, ${shared?.size ?? 0} shared tasks` : CONT[S.contender].label}</span>
              <span>· {S.machine === "everyone" ? "everyone" : S.machine}</span>
              {D.sample && <Badge variant="outline" className="note rotate-2 border-0 text-sm text-[#2a2622]">sample data · fake drama</Badge>}
            </div>
            <h1 className="poster-title mt-3 text-6xl sm:text-7xl lg:text-8xl">
              {slackers.length && !compare ? <span className="hl hl-red">{headline}</span> : <span className="hl">{headline}</span>}
            </h1>
            {!compare && (
              <p className="mt-4 text-2xl">
                {fine.length > 0 && <>{list(fine.map((v) => v.effort))} {fine.length === 1 ? "kept" : "kept"} trying. </>}
                <a href="#moments" className="underline decoration-crit decoration-wavy underline-offset-4" onClick={(e) => { e.preventDefault(); document.getElementById("moments")?.scrollIntoView({ behavior: "smooth" }) }}>
                  {moments.length} dumb robot moment{moments.length === 1 ? "" : "s"}
                </a>{" "}caught on the last run.
              </p>
            )}
            {/* evidence: sticky notes */}
            <div className="mt-7 flex flex-wrap gap-5">
              {!compare && slackers.flatMap((v) => evidence(v)).slice(0, 4).map((e, i) => (
                <div key={i} className={cn("note tape w-44 px-4 pb-3 pt-5", TILT[i % TILT.length])}>
                  <div className="font-heading text-4xl leading-none">{e.big}</div>
                  <div className="mt-1 text-base leading-snug">{e.small}</div>
                </div>
              ))}
              {!compare && !slackers.length && <div className="note tape -rotate-1 w-60 px-4 pb-3 pt-5 text-lg">Nothing weird on the last run. Go write some code.</div>}
            </div>
          </div>
          <div>
            <Gauge needles={needles} />
            <div className="mt-2 flex flex-wrap justify-center gap-x-5 gap-y-1 text-lg">
              {needles.map((n) => <span key={n.key} className="inline-flex items-center gap-1.5"><span className="inline-block h-1.5 w-6 rounded" style={{ background: n.color }} /><span className="capitalize">{n.label}</span>: <b>{n.score == null ? "still measuring" : zoneOf(n.score).label.toLowerCase()}</b></span>)}
            </div>
            <p className="mt-1 text-center text-base text-muted-foreground">Needles show effort vs each level's own normal. Skipped tests and fibs push them right.</p>
          </div>
        </section>

        {/* ---------------- specimen cards ---------------- */}
        {!compare && (
          <section className="mt-14 grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-7">
            {verdicts.map((v, i) => v && (
              <Rough key={v.effort} seed={11 + i} className={cn("bg-card px-5 pb-4 pt-3", v.status === "slacking" && "bg-crit-wash", i % 2 ? "rotate-[0.6deg]" : "-rotate-[0.6deg]")}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-heading text-xl text-muted-foreground">#{i + 1}</div>
                    <div className="poster-title flex items-center gap-2 text-4xl"><span className="inline-block h-1.5 w-7 rounded" style={{ background: LEVEL_VAR[v.effort] }} />{v.effort}</div>
                    <div className="text-lg">{STATUS_TXT[v.status]}</div>
                  </div>
                  <Robot name={v.status === "normal" && v.latest.effort / v.N.effort.med > 1.25 ? "overachiever" : ROBOT_FOR[v.status]} className="-mr-2 h-28 w-28" />
                </div>
                <div className="mt-1 flex items-end gap-3">
                  <span className="font-heading text-6xl leading-none"><span className={v.status === "slacking" ? "hl hl-red" : "hl"}>{F.pct(v.latest.passRate)}</span></span>
                  <span className="pb-1 text-base text-muted-foreground">passed · usually {F.pct(v.N.passRate.med)}</span>
                </div>
                <div className="mt-2 text-sm text-muted-foreground">effort, last {Math.min(8, v.rows.length)} runs (band = normal)</div>
                <Spark values={v.rows.slice(-8).map((r) => r.effort)} color={LEVEL_VAR[v.effort]} lo={v.N.effort.lo} hi={v.N.effort.hi} />
                <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 text-lg">
                  <dt>Ran the tests</dt><dd className={cn("text-right", v.N.ranTests.dir < 0 && "font-bold text-crit-ink")}>{v.latest.ranTestsN}/{v.latest.n}</dd>
                  <dt>Said done, wasn't</dt><dd className={cn("text-right", v.N.falseDone.dir > 0 && "font-bold text-crit-ink")}>{F.pct(v.latest.falseDone)}</dd>
                  <dt>Cost / task</dt><dd className="text-right">{F.usd(v.latest.cost)}</dd>
                </dl>
              </Rough>
            ))}
          </section>
        )}

        {/* ---------------- dumb robot moments ---------------- */}
        {!compare && (
          <section className="mt-20">
            <SectionTitle id="moments" kicker={latestDate ? `from ${fmtDay(latestDate)} · click one for the receipts` : undefined}>
              <Squiggle>{moments.length} dumb robot moment{moments.length === 1 ? "" : "s"}</Squiggle>
            </SectionTitle>
            {moments.length === 0 ? (
              <div className="flex items-center gap-5"><Robot name="trophy" className="h-36 w-28" /><p className="font-heading text-3xl">Zero. Not one. Frame this.</p></div>
            ) : (
              <>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(min(230px,100%),1fr))] gap-x-6 gap-y-9">
                  {(showAll ? moments : moments.slice(0, 12)).map((m, i) => (
                    <button key={m.run.task + m.run.effort + m.run.machine} type="button" onClick={() => setOpenMoment(m)}
                      className={cn("moment relative flex flex-col items-center rounded-sm bg-card px-4 pb-4 pt-6 text-left shadow-[2px_6px_16px_-8px_rgb(0_0_0/0.45)] focus-visible:outline-2 focus-visible:outline-ring", TILT[i % TILT.length])}>
                      <span className="absolute left-3 top-2 font-heading text-2xl text-muted-foreground">#{i + 1}</span>
                      <span className="absolute right-3 top-3 inline-flex items-center gap-1 text-sm capitalize"><span className="inline-block h-1 w-4 rounded" style={{ background: LEVEL_VAR[m.run.effort] }} />{m.run.effort}</span>
                      <Robot name={m.robot} className="mt-2 h-32 w-36" decorative />
                      <div className="poster-title mt-2 w-full text-center text-2xl">{m.title}</div>
                      <p className="mt-1 w-full text-center text-base leading-snug">{m.caption}</p>
                      <p className="mt-2 w-full truncate text-center text-sm text-muted-foreground">{TASK[m.run.task].title}</p>
                    </button>
                  ))}
                </div>
                {moments.length > 12 && <div className="mt-8 text-center"><Button variant="outline" className="bg-card font-heading text-lg" onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer" : `Show all ${moments.length}`}</Button></div>}
              </>
            )}
          </section>
        )}

        {/* ---------------- trends ---------------- */}
        <section className="mt-20">
          <SectionTitle id="trends" kicker="the receipts, over time" robot={<Robot name="whiteboard" className="h-24 w-28" decorative />}>Trends</SectionTitle>
          <TrendsV2 S={S} verdicts={verdicts} cids={cids} shared={shared} />
        </section>

        {/* ---------------- cheat sheet ---------------- */}
        <section className="mt-20 max-w-3xl">
          <SectionTitle id="cheat" kicker="which level for which job, from everyone's runs">Cheat sheet</SectionTitle>
          <CheatSheet S={S} onMore={() => { set({ tab: "setting" }); document.getElementById("details")?.scrollIntoView({ behavior: "smooth" }) }} />
        </section>

        {/* ---------------- details ---------------- */}
        <section className="mt-20">
          <SectionTitle id="details" kicker="for the nerds" robot={<Robot name="scroll" className="h-24 w-24" decorative />}>The details</SectionTitle>
          <Tabs value={S.tab} onValueChange={(v) => set({ tab: v })}>
            <div className="overflow-x-auto pb-1">
              <TabsList className="h-auto bg-card p-1">
                {[["levels", "Effort levels"], ["efficiency", "Efficiency"], ["tasks", "Tasks"], ["runs", "Every run"], ["setting", "Setting picker"]].map(([v, l]) => <TabsTrigger key={v} value={v} className="px-3 py-1.5 font-heading text-lg">{l}</TabsTrigger>)}
              </TabsList>
            </div>
            <TabsContent value="levels"><LevelsPanel S={S} verdicts={verdicts} /></TabsContent>
            <TabsContent value="efficiency"><EfficiencyPanel S={S} /></TabsContent>
            <TabsContent value="tasks"><TasksPanel S={S} set={set} /></TabsContent>
            <TabsContent value="runs"><RunsPanel S={S} set={set} /></TabsContent>
            <TabsContent value="setting"><SettingPanel S={S} set={set} /></TabsContent>
          </Tabs>
        </section>

        <footer className="mt-20 flex flex-wrap items-center gap-4 border-t-2 border-dashed border-foreground/30 pt-6 text-base text-muted-foreground">
          <Robot name="plunger" className="h-16 w-16" decorative />
          <p className="flex-1">
            {D.sample ? "Sample data generated " : "Updated "}{new Date(D.generated_at).toLocaleString()}. Costs are API-equivalent, not money charged on a subscription. Held together with a plunger and Claude Code.
          </p>
          <a href="?v=1" className="inline-flex items-center gap-1 underline">See the v1 design <ArrowUpRight className="size-4" /></a>
        </footer>
      </main>

      <MomentDialog m={openMoment} onClose={() => setOpenMoment(null)} />
    </div>
  )
}

function evidence(v: Verdict): { big: string; small: string }[] {
  const L = v.latest, N = v.N, out: { big: string; small: string }[] = []
  if (N.outTok.dir < 0) out.push({ big: `−${Math.abs(Math.round(N.outTok.rel * 100))}%`, small: `tokens written at ${v.effort}` })
  if (N.ranTests.dir < 0) out.push({ big: `${L.ranTestsN}/${L.n}`, small: `ran the tests (usually ${Math.round(N.ranTests.med * L.n)}/${L.n})` })
  if (N.verified.dir < 0) out.push({ big: F.pct(L.verified), small: `re-checked its work (usually ${F.pct(N.verified.med)})` })
  if (N.falseDone.dir > 0) out.push({ big: F.pct(L.falseDone), small: `said “done!” and wasn't (usually ${F.pct(N.falseDone.med)})` })
  if (N.passRate.dir < 0) out.push({ big: F.pct(L.passRate), small: `passed (usually ${F.pct(N.passRate.med)})` })
  return out
}

function TrendsV2({ S, verdicts, cids, shared }: { S: UIState; verdicts: (Verdict | null)[]; cids: string[]; shared?: Set<string> }) {
  const compare = S.contender === "compare"
  const defs = compare
    ? cids.map((cid, i) => ({ key: "c" + i, label: CONT[cid].label, color: SLOT_VAR[i % 3], rows: daily(S, cid, S.compareEffort, shared) }))
    : effortsOf(S.contender).map((e) => ({ key: e as string, label: e as string, color: LEVEL_VAR[e], rows: daily(S, S.contender, e) }))
  const dates = rangeDates(uniq(defs.flatMap((d) => d.rows.map((r) => r.date))).sort(), S.range)
  if (!dates.length) return <p className="text-lg text-muted-foreground">No complete run days yet.</p>
  // annotation: when did the slacking start, and did something ship that day?
  const notes = verdicts.filter((v): v is Verdict => !!v && v.status === "slacking").map((v) => {
    let i = v.rows.length - 1
    while (i > 0 && v.rows[i - 1].effort < v.N.effort.lo) i--
    const start = v.rows[i].date
    const ev = D.events.filter((e) => e.date <= start && (+new Date(start) - +new Date(e.date)) / 864e5 <= 4).pop()
    return `${v.effort[0].toUpperCase() + v.effort.slice(1)} fell off a cliff on ${fmtDate(start)}${ev ? `, the same day ${ev.label} showed up. Coincidence? The robots think not.` : "."}`
  })
  const series = defs.map((d) => ({ key: d.key, label: d.label, color: d.color }))
  const wide = (k: keyof typeof M) => dates.map((date) => Object.fromEntries([["date", date], ...defs.map((d) => [d.key, d.rows.find((r) => r.date === date)?.[k] ?? NaN])]))
  const eKey = compare ? "outTok" : "effort"
  const charts: [string, string, keyof typeof M, (v: number) => string, [number | "auto", number | "auto"]][] = [
    [compare ? "Output tokens / task" : "Effort", compare ? "Same shared tasks for every model" : "100 = this level's first weeks", eKey, M[eKey].fmt, compare ? [0, "auto"] : ["auto", "auto"]],
    ["Said “done”, wasn't", "False-done rate, lower is better", "falseDone", F.pct, [0, "auto"]],
    ["Pass rate", "Hidden grader's verdict", "passRate", F.pct, [0, 1]],
    ["Cost / task", "API-equivalent $", "cost", F.usd, [0, "auto"]],
  ]
  return (
    <div className="relative">
      {notes.length > 0 && (
        <div className="note tape relative z-10 mb-6 max-w-xl -rotate-1 px-5 pb-4 pt-6 text-xl lg:absolute lg:-top-24 lg:right-0 lg:mb-0">
          {notes.map((n) => <p key={n}>↙ {n}</p>)}
        </div>
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(460px,100%),1fr))] gap-7">
        {charts.map(([title, note, k, fmt, domain], i) => (
          <Rough key={k} seed={31 + i} className="bg-card px-5 pb-3 pt-4">
            <div className="poster-title text-3xl">{title}</div>
            <div className="mb-1 text-base text-muted-foreground">{note}</div>
            <div className="mb-1 flex flex-wrap gap-4 text-base">{series.map((s) => <span key={s.key} className="inline-flex items-center gap-1.5 capitalize"><span className="inline-block h-1 w-5 rounded" style={{ background: s.color }} />{s.label}</span>)}</div>
            <LinesProxy data={wide(k)} series={series} fmt={fmt} domain={domain} />
          </Rough>
        ))}
      </div>
    </div>
  )
}


function CheatSheet({ S, onMore }: { S: UIState; onMore: () => void }) {
  const cur = D.contenders.find((c) => !c.retired) ?? D.contenders[0]
  const cid = S.contender === "compare" ? cur.id : S.contender
  const efforts = effortsOf(cid)
  const runs = RUNS.filter((r) => r.contender === cid && (S.bench === "all" || r.bench === S.bench))
  const groups = Object.entries(groupBy(runs, (r) => TASK[r.task].kind)).sort((a, b) => b[1].length - a[1].length)
  const rows = groups.map(([g, rs]) => {
    const per = efforts.map((e) => ({ e, a: agg(rs.filter((r: Run) => r.effort === e)) }))
    if (!per.every((p) => p.a.n >= 20)) return { g, pick: null as Effort | null, cost: NaN }
    const best = Math.max(...per.map((p) => p.a.passRate))
    const p = per.filter((x) => x.a.passRate >= best - 0.05).sort((x, y) => x.a.costPerPass - y.a.costPerPass)[0]
    return { g, pick: p.e, cost: p.a.costPerPass }
  })
  return (
    <div className="relative">
      <Rough seed={5} className="index-card rotate-[0.8deg] px-6 pb-6 pt-4 pl-16 text-[22px] leading-[34px]">
        <div className="poster-title text-3xl leading-[34px]">Use this level for…</div>
        {rows.map((r) => (
          <div key={r.g} className="flex items-baseline gap-2">
            <span className="capitalize">{r.g}</span>
            <span className="mx-1 flex-1 translate-y-[-6px] border-b-2 border-dotted border-[#2a2622]/40" />
            {r.pick ? <b className="poster-title"><span className="hl">{r.pick}</span></b> : <span className="text-[#6e665a]">not sure yet</span>}
            {r.pick && <span className="w-16 text-right text-base text-[#6e665a]">{F.usd(r.cost)}</span>}
          </div>
        ))}
        <div className="mt-2 text-base text-[#6e665a]">Cheapest correct answer within 5 points of the best pass rate. $ = per correct answer.</div>
      </Rough>
      <Robot name="hustle" className="absolute -bottom-10 -right-4 hidden h-28 w-24 sm:flex" decorative />
      <button type="button" onClick={onMore} className="mt-4 text-lg underline">Show the full numbers</button>
    </div>
  )
}

function MomentDialog({ m, onClose }: { m: Moment | null; onClose: () => void }) {
  const r = m?.run
  const t = r ? TASK[r.task] : null
  return (
    <Dialog open={!!m} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg bg-card">
        {m && r && t && (
          <>
            <DialogHeader>
              <div className="flex items-start gap-4">
                <Robot name={m.robot} className="h-28 w-28" decorative />
                <div>
                  <DialogTitle className="poster-title text-3xl">{m.title}</DialogTitle>
                  <DialogDescription className="text-base">{t.title}</DialogDescription>
                  <div className="mt-1 text-sm text-muted-foreground">{t.language} · {t.kind} · {t.difficulty} · <span className="capitalize">{r.effort}</span> · {r.machine} · {fmtDay(r.date)} · CC {r.cc_version}</div>
                </div>
              </div>
            </DialogHeader>
            <div className="note -rotate-1 px-4 py-3 text-lg">“{r.claim_text}”<div className="text-sm">what it said at the end</div></div>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 font-data text-sm">
              <dt className="text-muted-foreground">Result</dt><dd className="text-right">{r.pass ? "✓ passed" : "✗ failed"}</dd>
              {t.ui ? <><dt className="text-muted-foreground">Judge score</dt><dd className="text-right">{r.score} / 5</dd></> : <><dt className="text-muted-foreground">Hidden tests</dt><dd className="text-right">{r.tests_passed} / {r.tests_total}</dd></>}
              <dt className="text-muted-foreground">Ran the tests</dt><dd className="text-right">{r.ran_tests ? "yes" : "no"}</dd>
              <dt className="text-muted-foreground">Re-checked after last edit</dt><dd className="text-right">{r.verified_after_last_edit ? "yes" : "no"}</dd>
              <dt className="text-muted-foreground">Output tokens</dt><dd className="text-right tabular-nums">{r.output_tokens.toLocaleString()}</dd>
              <dt className="text-muted-foreground">Tool calls · files read</dt><dd className="text-right tabular-nums">{r.tool_calls} · {r.files_read}</dd>
              <dt className="text-muted-foreground">Time · cost</dt><dd className="text-right">{r.minutes} min · {F.usd(r.cost_usd)}</dd>
            </dl>
            <p className="text-base"><span className="text-muted-foreground">What it actually did: </span>{r.digest}</p>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
