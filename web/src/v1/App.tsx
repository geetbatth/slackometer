import { useEffect, useMemo, useState } from "react"
import { Moon, Sun } from "lucide-react"
import { GithubButton } from "@/components/github-link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Robot } from "@/components/robot"
import { CONT, D, F, RAW, type Effort, type Filters, type Status, type Verdict, contendersWithData, daily, effortsOf, fmtDate, fmtDay, runDaysFor, sharedTasks, verdictFor } from "@/lib/data"
import { EfficiencyPanel, LevelsPanel, RunsPanel, SettingPanel, TasksPanel, TrendPanel, Empty, LEVEL_VAR, SLOT_VAR } from "@/v1/panels"
import { cn } from "@/lib/utils"

export interface UIState extends Filters { tab: string; compareEffort: Effort; heatEffort: Effort; heatMetric: string; runsDate: string | null; runSel: string | null; recoBy: "kind" | "language" }

export const STATUS: Record<Status, { label: string; robot: "slacking" | "unusual" | "leaner" | "normal" | "baseline"; quip: string; dot: string }> = {
  slacking: { label: "Slacking", robot: "slacking", quip: "Caught eating a shoe instead of running the tests.", dot: "bg-crit" },
  unusual: { label: "Something's off", robot: "unusual", quip: "Numbers wandered outside normal. The robot is confused too.", dot: "bg-warn" },
  leaner: { label: "Leaner", robot: "leaner", quip: "Same results, fewer tokens. A toaster on a skateboard.", dot: "bg-good" },
  normal: { label: "Doing its job", robot: "normal", quip: "Suspiciously normal. Carry on.", dot: "bg-good" },
  baseline: { label: "Building baseline", robot: "baseline", quip: "Still climbing. Needs a few more runs.", dot: "bg-muted-foreground" },
}

const HASH_KEYS = ["tab", "bench", "contender", "machine", "range"] as const
export const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem("so-" + k); return v == null ? d : (JSON.parse(v) as T) } catch { return d } },
  set(k: string, v: unknown) { try { localStorage.setItem("so-" + k, JSON.stringify(v)) } catch { /* private mode */ } },
}

export function initialState(): UIState {
  const current = D.contenders.find((c) => !c.retired) ?? D.contenders[0]
  const s: UIState = {
    bench: store.get("bench", "all"), contender: store.get("contender", current.id), machine: store.get("machine", D.machines[0].id),
    range: store.get("range", 26), tab: store.get("tab", "trend"),
    compareEffort: "high", heatEffort: "high", heatMetric: "quality", runsDate: null, runSel: null, recoBy: "kind",
  }
  try {
    new URLSearchParams(location.hash.slice(1)).forEach((v, k) => {
      if ((HASH_KEYS as readonly string[]).includes(k)) (s as unknown as Record<string, unknown>)[k] = k === "range" ? +v : v
    })
  } catch { /* ignore */ }
  if (s.contender !== "compare" && !CONT[s.contender]) s.contender = current.id
  if (s.machine !== "everyone" && !D.machines.some((m) => m.id === s.machine)) s.machine = D.machines[0].id
  return s
}

export function useTheme() {
  const [dark, setDark] = useState(() => {
    const saved = store.get<string | null>("theme", null)
    return saved ? saved === "dark" : matchMedia("(prefers-color-scheme: dark)").matches
  })
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); store.set("theme", dark ? "dark" : "light") }, [dark])
  return [dark, setDark] as const
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1"><span className="text-sm text-muted-foreground">{label}</span>{children}</label>
}

export function Pick({ value, onChange, groups, className, label }: { value: string; onChange: (v: string) => void; groups: { label?: string; items: { value: string; label: string }[] }[]; className?: string; label: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className={cn("doodle-sm min-w-40 bg-card", className)}><SelectValue /></SelectTrigger>
      <SelectContent>
        {groups.map((g, i) => (
          <SelectGroup key={i}>
            {g.label && <SelectLabel>{g.label}</SelectLabel>}
            {g.items.map((it) => <SelectItem key={it.value} value={it.value}>{it.label}</SelectItem>)}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}

export default function App() {
  const [S, setS] = useState<UIState>(initialState)
  const [dark, setDark] = useTheme()
  const set = (patch: Partial<UIState>) => setS((prev) => ({ ...prev, ...patch }))
  useEffect(() => {
    HASH_KEYS.forEach((k) => store.set(k, S[k]))
    try { history.replaceState(null, "", "#" + new URLSearchParams(HASH_KEYS.map((k) => [k, String(S[k])])).toString()) } catch { /* ignore */ }
  }, [S])

  const compare = S.contender === "compare"
  const verdicts = useMemo(() => (compare ? [] : effortsOf(S.contender).map((e) => verdictFor(S, S.contender, e))), [S.bench, S.contender, S.machine]) // eslint-disable-line react-hooks/exhaustive-deps
  const live = D.contenders.filter((c) => !c.retired), old = D.contenders.filter((c) => c.retired)

  if (!RAW) return <div className="p-10"><Empty robot="empty" title="No data found" body="Couldn't find data/runs.js. The robot is asking the bin about it." /></div>

  return (
    <div className="mx-auto max-w-[1240px] px-4 pb-16 pt-6">
      {/* ---------- header ---------- */}
      <header className="mb-5 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Robot name="mascot" className="h-20 w-16 sm:h-24 sm:w-20" />
          <div>
            <h1 className="font-heading text-4xl leading-none sm:text-5xl"><span className="squiggle">Slackometer</span></h1>
            <p className="mt-2 text-lg text-muted-foreground">Is the robot still trying? Checked every Monday &amp; Wednesday.</p>
          </div>
          {D.sample && <Badge variant="outline" className="doodle-sm tilt-r ml-1 hidden bg-warn-wash text-sm sm:inline-flex">Sample data · fake robots, fake drama</Badge>}
        </div>
        <div className="flex items-center gap-2">
          <GithubButton size="icon" className="doodle-sm bg-card" />
          <Button variant="outline" size="icon" className="doodle-sm bg-card" onClick={() => setDark(!dark)} aria-label={dark ? "Switch to graph paper (light)" : "Switch to blueprint (dark)"}>
            {dark ? <Sun /> : <Moon />}
          </Button>
        </div>
      </header>

      {/* ---------- filters: one row, scope everything below ---------- */}
      <div className="mb-3 flex flex-wrap items-end gap-x-4 gap-y-3">
        <Field label="Bench"><Pick label="Bench" value={S.bench} onChange={(v) => set({ bench: v })} groups={[{ items: [{ value: "all", label: "All benches" }, ...D.benches.map((b) => ({ value: b.id, label: b.name }))] }]} /></Field>
        <Field label="Model"><Pick label="Model" value={S.contender} onChange={(v) => set({ contender: v })} groups={[
          { label: "Current", items: live.map((c) => ({ value: c.id, label: c.label })) },
          ...(old.length ? [{ label: "Retired", items: old.map((c) => ({ value: c.id, label: c.label + " (retired)" })) }] : []),
          { label: "Compare", items: [{ value: "compare", label: "Compare models…" }] },
        ]} /></Field>
        <Field label="Machine"><Pick label="Machine" value={S.machine} onChange={(v) => set({ machine: v })} groups={[{ items: [...D.machines.map((m) => ({ value: m.id, label: m.person ? `${m.id} (${m.person})` : m.id })), { value: "everyone", label: "Everyone" }] }]} /></Field>
        {compare && <Field label="Effort level"><Pick label="Effort level" value={S.compareEffort} onChange={(v) => set({ compareEffort: v as Effort })} groups={[{ items: ["medium", "high", "xhigh"].map((x) => ({ value: x, label: x })) }]} className="min-w-28" /></Field>}
        <Field label="Range">
          <ToggleGroup type="single" variant="outline" value={String(S.range)} onValueChange={(v) => v && set({ range: +v })} className="doodle-sm bg-card" spacing={0}>
            <ToggleGroupItem value="8">Last 8 runs</ToggleGroupItem>
            <ToggleGroupItem value="26">Last 26</ToggleGroupItem>
            <ToggleGroupItem value="0">All</ToggleGroupItem>
          </ToggleGroup>
        </Field>
      </div>
      <Meta S={S} />
      <Banners S={S} verdicts={verdicts} />
      {compare ? <CompareStrip S={S} /> : <VerdictStrip verdicts={verdicts} />}

      {/* ---------- tabs ---------- */}
      <Tabs value={S.tab} onValueChange={(v) => set({ tab: v })} className="mt-6">
        <div className="overflow-x-auto pb-1">
          <TabsList className="doodle-sm h-auto bg-card p-1 text-base">
            <TabsTrigger value="trend" className="px-3 py-1.5 font-heading text-lg">📈 Trend</TabsTrigger>
            <TabsTrigger value="levels" className="px-3 py-1.5 font-heading text-lg">🎚️ Effort levels</TabsTrigger>
            <TabsTrigger value="efficiency" className="px-3 py-1.5 font-heading text-lg">💸 Efficiency</TabsTrigger>
            <TabsTrigger value="tasks" className="px-3 py-1.5 font-heading text-lg">🧩 Tasks</TabsTrigger>
            <TabsTrigger value="runs" className="px-3 py-1.5 font-heading text-lg">🔍 Runs</TabsTrigger>
            <TabsTrigger value="setting" className="px-3 py-1.5 font-heading text-lg">🧭 Which setting for which job</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="trend"><TrendPanel S={S} /></TabsContent>
        <TabsContent value="levels"><LevelsPanel S={S} verdicts={verdicts} /></TabsContent>
        <TabsContent value="efficiency"><EfficiencyPanel S={S} /></TabsContent>
        <TabsContent value="tasks"><TasksPanel S={S} set={set} /></TabsContent>
        <TabsContent value="runs"><RunsPanel S={S} set={set} /></TabsContent>
        <TabsContent value="setting"><SettingPanel S={S} set={set} /></TabsContent>
      </Tabs>

      <footer className="mt-12 flex items-center gap-3 text-sm text-muted-foreground">
        <Robot name="plunger" className="h-16 w-16" decorative />
        <p>
          {D.sample ? "Sample data generated " : "Updated "}{new Date(D.generated_at).toLocaleString()}. Costs are API-equivalent, not money charged on a subscription. Held together with a plunger and Claude Code.
        </p>
      </footer>
    </div>
  )
}

function Meta({ S }: { S: UIState }) {
  const days = runDaysFor(S), last = days[days.length - 1]
  if (!last) return null
  const suite = D.suites.find((x) => x.contender === last.contender && x.machine === last.machine && x.version === last.suite_version)
  return (
    <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1 text-base text-muted-foreground">
      <span>Latest run <b className="text-foreground">{fmtDay(last.date)}</b></span>
      <span>Claude Code <b className="text-foreground">{last.cc_version}</b></span>
      {S.contender !== "compare" && <span><b className="text-foreground">{CONT[S.contender].model}</b></span>}
      {suite && S.machine !== "everyone" && <span>Suite v{suite.version}: <b className="text-foreground">{suite.tasks.length} tasks × {effortsOf(suite.contender).length} levels</b> (calibrated {fmtDate(suite.calibrated_at)})</span>}
    </div>
  )
}

function Banners({ S, verdicts }: { S: UIState; verdicts: (Verdict | null)[] }) {
  const days = runDaysFor(S), last = days[days.length - 1]
  return (
    <div className="flex flex-col gap-3">
      {D.paused && (
        <Card className="doodle flex-row items-center gap-4 bg-crit-wash px-4 py-3">
          <Robot name="paused" className="h-16 w-16" decorative />
          <div><b className="text-lg">Other Claude usage is still paused</b> since {D.paused.since}. Run <code>bench resume</code> to put the umbrella away.</div>
        </Card>
      )}
      {verdicts.filter((v): v is Verdict => !!v && v.status === "slacking").map((v) => {
        const L = v.latest, N = v.N, items: string[] = []
        if (N.outTok.dir < 0) items.push(`wrote ${Math.abs(Math.round(N.outTok.rel * 100))}% fewer tokens than normal (${F.k(L.outTok)} vs ${F.k(N.outTok.med)} per task)`)
        if (N.ranTests.dir < 0) items.push(`ran the tests in only ${L.ranTestsN}/${L.n} tasks (normally ${Math.round(N.ranTests.med * L.n)}/${L.n})`)
        if (N.verified.dir < 0) items.push(`re-checked after its last edit ${F.pct(L.verified)} of the time (normally ${F.pct(N.verified.med)})`)
        if (N.falseDone.dir > 0) items.push(`said “done!” but failed ${F.pct(L.falseDone)} of the time (normally ${F.pct(N.falseDone.med)})`)
        if (N.passRate.dir < 0) items.push(`passed ${F.pct(L.passRate)} (normally ${F.pct(N.passRate.med)})`)
        return (
          <Card key={v.effort} role="alert" className="doodle flex-row items-center gap-4 bg-crit-wash px-4 py-3">
            <Robot name="slacking" className="h-24 w-20" decorative />
            <div>
              <div className="font-heading text-2xl"><span className="capitalize">{v.effort}</span> is slacking on {fmtDay(L.date)}</div>
              <ul className="mt-1 list-disc pl-5 text-base">{items.map((t) => <li key={t}>{t}</li>)}</ul>
            </div>
          </Card>
        )
      })}
      {last?.status === "incomplete" && (
        <Card className="doodle flex-row items-center gap-4 bg-warn-wash px-4 py-3">
          <Robot name="baseline" className="h-14 w-12" decorative />
          <div><b>Latest run day is incomplete.</b> {last.incomplete_reason}. It's left out of every chart and verdict.</div>
        </Card>
      )}
    </div>
  )
}

function Delta({ rel }: { rel: number }) {
  if (!isFinite(rel)) return <span className="text-muted-foreground">–</span>
  const v = Math.round(rel * 100)
  const cls = v <= -15 ? "text-crit-ink font-bold" : ""
  return <span className={cls}>{v < 0 ? "▼ −" : v > 0 ? "▲ +" : "±"}{Math.abs(v)}%</span>
}

function VerdictStrip({ verdicts }: { verdicts: (Verdict | null)[] }) {
  const vs = verdicts.filter((v): v is Verdict => !!v)
  if (!vs.length) return <Empty robot="empty" title="No runs yet" body="Nothing to judge. The robot is chatting with the bin instead." />
  return (
    <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-5">
      {vs.map((v, i) => {
        const L = v.latest, N = v.N, st = STATUS[v.status]
        const outKeys = (Object.keys(N) as (keyof typeof N)[]).filter((k) => N[k].out && k !== "effort")
        return (
          <Card key={v.effort} className={cn("doodle relative gap-2 px-5 py-4", i % 2 ? "tilt-r" : "tilt-l", v.status === "slacking" && "bg-crit-wash", v.status === "unusual" && "bg-warn-wash")}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2 font-heading text-2xl capitalize">
                  <span className="inline-block h-1 w-5 rounded" style={{ background: LEVEL_VAR[v.effort] }} />{v.effort}
                </div>
                <Badge variant="outline" className="mt-1 gap-1.5 bg-card text-sm"><span className={cn("size-2 rounded-full", st.dot)} />{st.label}</Badge>
              </div>
              <Robot name={st.robot} className="-mr-1 -mt-1 h-24 w-20" />
            </div>
            <div className="font-heading text-6xl leading-none">{F.pct(L.passRate)}</div>
            <div className="text-sm text-muted-foreground">pass rate · normally {F.pct(N.passRate.med)}</div>
            <p className="text-sm italic">{st.quip}{outKeys.length > 0 && v.status !== "normal" ? ` (${outKeys.map((k) => k === "outTok" ? "tokens" : k === "ranTests" ? "tests" : k === "falseDone" ? "false-done" : k === "verified" ? "re-checks" : k === "passRate" ? "pass rate" : k === "costPerPass" ? "cost/correct" : k).join(", ")})` : ""}</p>
            <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-base">
              <dt className="text-muted-foreground">Effort vs normal</dt><dd className="text-right"><Delta rel={N.effort.rel} /></dd>
              <dt className="text-muted-foreground">Ran the tests</dt><dd className="text-right">{L.ranTestsN}/{L.n}</dd>
              <dt className="text-muted-foreground">Said “done”, wasn't</dt><dd className="text-right"><span className={N.falseDone.dir > 0 ? "font-bold text-crit-ink" : ""}>{F.pct(L.falseDone)}</span> <span className="text-muted-foreground">· norm {F.pct(N.falseDone.med)}</span></dd>
              <dt className="text-muted-foreground">Cost / task</dt><dd className="text-right">{F.usd(L.cost)}</dd>
            </dl>
          </Card>
        )
      })}
    </div>
  )
}

function CompareStrip({ S }: { S: UIState }) {
  const cids = contendersWithData(S), shared = sharedTasks(S, cids)
  return (
    <div className="mt-5 grid grid-cols-[auto_repeat(auto-fit,minmax(min(240px,100%),1fr))] items-stretch gap-5 max-sm:grid-cols-1">
      <div className="flex flex-col items-center justify-center text-center"><Robot name="compare" className="h-28 w-40" /><p className="text-sm text-muted-foreground">{shared.size} shared tasks, {S.compareEffort}</p></div>
      {cids.map((cid, i) => {
        const rows = daily(S, cid, S.compareEffort, shared), L = rows[rows.length - 1]
        return (
          <Card key={cid} className={cn("doodle gap-2 px-5 py-4", i % 2 ? "tilt-r" : "tilt-l")}>
            <div className="flex items-center gap-2 font-heading text-2xl"><span className="inline-block h-1 w-5 rounded" style={{ background: SLOT_VAR[i % 3] }} />{CONT[cid].label}{CONT[cid].retired && <Badge variant="outline" className="text-xs">retired</Badge>}</div>
            {L ? <>
              <div className="font-heading text-6xl leading-none">{F.pct(L.passRate)}</div>
              <div className="text-sm text-muted-foreground">pass rate, last run {fmtDate(L.date)}</div>
              <dl className="grid grid-cols-[1fr_auto] gap-x-3 text-base">
                <dt className="text-muted-foreground">Said “done”, wasn't</dt><dd className="text-right">{F.pct(L.falseDone)}</dd>
                <dt className="text-muted-foreground">Output tokens / task</dt><dd className="text-right">{F.k(L.outTok)}</dd>
                <dt className="text-muted-foreground">Cost / correct answer</dt><dd className="text-right">{F.usd(L.costPerPass)}</dd>
              </dl>
            </> : <span className="text-muted-foreground">No runs</span>}
          </Card>
        )
      })}
    </div>
  )
}

