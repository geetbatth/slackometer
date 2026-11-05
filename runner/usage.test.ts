import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defaults } from "./config.ts"
import { readUsage, guard, safeGuard, addSample, currentRate, UsageError } from "./usage.ts"

const cfg = { ...defaults(), machine: "t", person: "t" }
const fixture = readFileSync(join(import.meta.dirname, "fixtures/usage-2026-11-03.json"), "utf8")
function creds(expiresAt = Date.now() + 3_600_000) {
  const p = join(mkdtempSync(join(tmpdir(), "slk-cred-")), ".credentials.json")
  writeFileSync(p, JSON.stringify({ claudeAiOauth: { accessToken: "tok", expiresAt } })); return p
}
const fakeFetch = (status: number, body: string) => (async (_url: string, init?: RequestInit) => {
  assert.equal((init?.headers as Record<string, string>)["anthropic-beta"], "oauth-2025-04-20")
  return new Response(body, { status })
}) as typeof fetch

test("parses the real response shape", async () => {
  const u = await readUsage({ fetchImpl: fakeFetch(200, fixture), credPath: creds() })
  assert.deepEqual(u, { five_hour: 47, seven_day: 19, seven_day_resets_at: "2026-11-10T16:00:00.585813+00:00", extra_usage_enabled: true })
})

test("guard refuses at 90", () => {
  assert.equal(guard({ five_hour: 89.9, seven_day: 10, seven_day_resets_at: "", extra_usage_enabled: true }, cfg).ok, true)
  assert.equal(guard({ five_hour: 90, seven_day: 10, seven_day_resets_at: "", extra_usage_enabled: true }, cfg).ok, false)
  assert.equal(guard({ five_hour: 1, seven_day: 95, seven_day_resets_at: "", extra_usage_enabled: false }, cfg).ok, false)
})

test("guard refuses when reading fails (throw, 401, missing fields, no credentials)", async () => {
  const cases = [
    () => readUsage({ fetchImpl: (async () => { throw new Error("offline") }) as typeof fetch, credPath: creds() }),
    () => readUsage({ fetchImpl: fakeFetch(401, "{}"), credPath: creds() }),
    () => readUsage({ fetchImpl: fakeFetch(200, "{}"), credPath: creds() }),
    () => readUsage({ fetchImpl: fakeFetch(200, fixture), credPath: join(tmpdir(), "nope-" + Date.now()) }),
  ]
  for (const read of cases) {
    await assert.rejects(read, UsageError)
    const g = await safeGuard(cfg, read)
    assert.equal(g.ok, false); assert.match(g.reason, /usage unreadable/); assert.equal(g.usage, null)
  }
})

test("expired token triggers a refresh before reading", async () => {
  let refreshed = 0
  const p = creds(Date.now() - 1000)
  await readUsage({ fetchImpl: fakeFetch(200, fixture), credPath: p, refresh: async () => { refreshed++; writeFileSync(p, JSON.stringify({ claudeAiOauth: { accessToken: "new", expiresAt: Date.now() + 3_600_000 } })) } })
  assert.equal(refreshed, 1)
})

test("rate ignores unclean samples and is null with no data", () => {
  const f = join(mkdtempSync(join(tmpdir(), "slk-rate-")), "rate.json")
  assert.equal(currentRate(f), null)
  addSample(f, { date: "2026-11-02", d_pct: 2, usd: 20, clean: true })
  addSample(f, { date: "2026-11-04", d_pct: 9, usd: 10, clean: false })
  addSample(f, { date: "2026-11-09", d_pct: 1, usd: 10, clean: true })
  assert.equal(currentRate(f), 0.1)
})

test("sameWeek ignores the endpoint's sub-second jitter but catches a real reset", async () => {
  const { sameWeek } = await import("./usage.ts")
  assert.equal(sameWeek("2026-11-10T16:00:00.739091+00:00", "2026-11-10T16:00:00.944869+00:00"), true)
  assert.equal(sameWeek("2026-11-10T16:00:00.739091+00:00", "2026-11-17T16:00:00.1+00:00"), false)
  assert.equal(sameWeek("", "2026-11-10T16:00:00Z"), true)
})

test("safeGuard falls back to a recent reading well under the guard when the endpoint is busy, never to an old or close one", async () => {
  const { safeGuard } = await import("./usage.ts")
  const cfg = (await import("./config.ts")).defaults()
  const busy = async () => { throw new Error("usage endpoint returned HTTP 429") }
  const u = (seven_day: number) => ({ five_hour: 20, seven_day, seven_day_resets_at: "", extra_usage_enabled: false })
  const recentLow = await safeGuard(cfg, busy, () => ({ at: Date.now() - 5 * 60_000, usage: u(60) }))
  assert.equal(recentLow.ok, true); assert.match(recentLow.reason, /min ago/)
  assert.equal((await safeGuard(cfg, busy, () => ({ at: Date.now() - 45 * 60_000, usage: u(60) }))).ok, false) // too old
  assert.equal((await safeGuard(cfg, busy, () => ({ at: Date.now() - 5 * 60_000, usage: u(80) }))).ok, false)  // too close to 90%
  assert.equal((await safeGuard(cfg, busy, () => null)).ok, false)
})
