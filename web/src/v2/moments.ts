// "Dumb robot moments": individual runs worth laughing at, from the latest run day.
import type { RobotName } from "@/components/robot"
import { TASK, median, type Run } from "@/lib/data"

export interface Moment { run: Run; kind: Kind; robot: RobotName; title: string; caption: string; severity: number }
type Kind = "fib" | "skipped" | "lazy" | "unverified" | "gaveup"

const KINDS: Record<Kind, { robot: RobotName; title: string; severity: number }> = {
  fib: { robot: "fib", title: "Said DONE. Wasn't.", severity: 5 },
  skipped: { robot: "skiptests", title: "Didn't run the tests", severity: 4 },
  lazy: { robot: "hammock", title: "Barely wrote anything", severity: 3 },
  unverified: { robot: "rug", title: "Never re-checked its work", severity: 2 },
  gaveup: { robot: "giveup", title: "Gave up (and admitted it)", severity: 1 },
}

/** @param history all runs of the same contender/machine, used for "normal tokens for this task+level". */
export function findMoments(day: Run[], history: Run[]): Moment[] {
  const out: Moment[] = []
  for (const r of day) {
    const t = TASK[r.task]
    const past = history.filter((h) => h.task === r.task && h.effort === r.effort && h.date < r.date).map((h) => h.output_tokens)
    const usual = past.length >= 3 ? median(past) : NaN
    const tests = t.ui ? `judge gave it ${r.score}/5` : `${r.tests_passed}/${r.tests_total} hidden tests passed`
    let kind: Kind | null = null, caption = ""
    if (r.claimed_done && !r.pass) { kind = "fib"; caption = `Said “${r.claim_text}” Reality: ${tests}.` }
    else if (!r.ran_tests && !t.ui && !r.pass) { kind = "skipped"; caption = `Shipped it without running a single test. ${tests}.` }
    else if (isFinite(usual) && r.output_tokens < usual * 0.55) { kind = "lazy"; caption = `Wrote ${Math.round(r.output_tokens / 100) / 10}k tokens. Usually writes ${Math.round(usual / 100) / 10}k here.${r.pass ? " Still passed, somehow." : ""}` }
    else if (r.ran_tests && !r.verified_after_last_edit && !r.pass) { kind = "unverified"; caption = `Ran the tests once, edited again, never looked back. ${tests}.` }
    else if (!r.pass && !r.claimed_done) { kind = "gaveup"; caption = `Said “${r.claim_text}” Honest, at least.` }
    if (kind) out.push({ run: r, kind, caption, ...KINDS[kind] })
  }
  out.sort((a, b) => b.severity - a.severity || a.run.task.localeCompare(b.run.task))
  // two fib robots take turns so the wall doesn't look copy-pasted
  let n = 0
  for (const m of out) if (m.kind === "fib") m.robot = n++ % 2 ? "falsedone" : "fib"
  return out
}
