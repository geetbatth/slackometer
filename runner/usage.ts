// Read the person's Claude subscription usage (the endpoint behind Claude Code's /usage screen).
// Fail closed: anything unexpected is an error, never "0% used".
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import { run } from "./proc.ts"
import type { LocalConfig, Usage } from "./types.ts"

export class UsageError extends Error {}
const URL_USAGE = "https://api.anthropic.com/api/oauth/usage"
const DEFAULT_CRED = join(homedir(), ".claude", ".credentials.json")

interface Creds { accessToken: string; expiresAt: number }

export function readCreds(credPath: string = DEFAULT_CRED): Creds {
  if (process.platform === "darwin" && credPath === DEFAULT_CRED && !existsSync(credPath)) {
    // macOS keeps Claude Code's login in the Keychain (untested here)
    const r = spawnSync("security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"], { encoding: "utf8" })
    if (r.status === 0) { const j = JSON.parse(r.stdout); return j.claudeAiOauth }
  }
  if (!existsSync(credPath)) throw new UsageError(`no Claude Code login found at ${credPath} (is Claude Code logged in?)`)
  try {
    const c = JSON.parse(readFileSync(credPath, "utf8")).claudeAiOauth
    if (!c?.accessToken) throw new Error("no accessToken")
    return c
  } catch (e) { throw new UsageError(`unreadable credentials: ${(e as Error).message}`) }
}

/** Ask Claude Code to refresh its own token (cheapest possible call). */
export async function defaultRefresh(): Promise<void> {
  await run("claude", ["-p", "ok", "--max-turns", "1", "--model", "claude-haiku-5-5", "--output-format", "json"], { shell: false, timeoutMs: 120_000 })
}

export async function readUsage(o: { fetchImpl?: typeof fetch; credPath?: string; refresh?: () => Promise<void> } = {}): Promise<Usage> {
  const credPath = o.credPath ?? DEFAULT_CRED
  let c = readCreds(credPath)
  if (c.expiresAt && c.expiresAt < Date.now() + 60_000) { await (o.refresh ?? defaultRefresh)(); c = readCreds(credPath) }
  let res: Response
  try {
    res = await (o.fetchImpl ?? fetch)(URL_USAGE, { headers: { Authorization: `Bearer ${c.accessToken}`, "anthropic-beta": "oauth-2025-04-20", "User-Agent": "slackometer" } })
  } catch (e) { throw new UsageError(`usage request failed: ${(e as Error).message}`) }
  if (res.status !== 200) throw new UsageError(`usage endpoint returned HTTP ${res.status}`)
  let j: any
  try { j = await res.json() } catch { throw new UsageError("usage endpoint returned non-JSON") }
  const five = j?.five_hour?.utilization, week = j?.seven_day?.utilization
  if (typeof five !== "number" || typeof week !== "number") throw new UsageError("usage response is missing five_hour/seven_day utilization (endpoint changed?)")
  return { five_hour: five, seven_day: week, seven_day_resets_at: String(j.seven_day.resets_at ?? ""), extra_usage_enabled: !!j?.extra_usage?.is_enabled }
}

export function guard(u: Usage, cfg: LocalConfig): { ok: boolean; reason: string } {
  const g = cfg.budget.guard_percent
  if (u.five_hour >= g) return { ok: false, reason: `5-hour usage at ${u.five_hour}% (guard ${g}%)` }
  if (u.seven_day >= g) return { ok: false, reason: `weekly usage at ${u.seven_day}% (guard ${g}%)` }
  return { ok: true, reason: `5-hour ${u.five_hour}%, weekly ${u.seven_day}%` }
}

export async function safeGuard(cfg: LocalConfig, read: () => Promise<Usage> = () => readUsage()): Promise<{ ok: boolean; reason: string; usage: Usage | null }> {
  try { const u = await read(); return { ...guard(u, cfg), usage: u } }
  catch (e) { return { ok: false, reason: `usage unreadable: ${(e as Error).message}`, usage: null } }
}

// ---- exchange rate: % of the weekly limit per API-equivalent dollar ----
export interface RateSample { date: string; d_pct: number; usd: number; clean: boolean }
interface RateFile { pct_per_usd: number | null; samples: RateSample[] }

const readRate = (f: string): RateFile => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : { pct_per_usd: null, samples: [] })
export function addSample(f: string, s: RateSample): void {
  const r = readRate(f)
  r.samples.push(s)
  r.pct_per_usd = rateOf(r.samples)
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(f, JSON.stringify(r, null, 2))
}
function rateOf(samples: RateSample[]): number | null {
  const clean = samples.filter((s) => s.clean)
  const usd = clean.reduce((a, s) => a + s.usd, 0)
  return usd > 0 ? Math.round((clean.reduce((a, s) => a + s.d_pct, 0) / usd) * 1e6) / 1e6 : null
}
export const currentRate = (f: string): number | null => rateOf(readRate(f).samples)
