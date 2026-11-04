import { test } from "node:test"
import assert from "node:assert/strict"
import { defaults } from "./config.ts"
import { windowsRegisterScript, launchdPlist } from "./schedule.ts"

const cfg = { ...defaults(), machine: "t", person: "t", repo_dir: "D:\\Positec\\slackometer" }

test("schedule builds Mon/Wed 03:00 triggers that wake the PC", () => {
  const ps = windowsRegisterScript(cfg, "C:\\Program Files\\nodejs\\node.exe")
  assert.match(ps, /-DaysOfWeek Monday,Wednesday/)
  assert.match(ps, /-At '03:00'/)
  assert.match(ps, /-WakeToRun/)
  assert.match(ps, /cli\.ts/); assert.match(ps, /\brun\b/)
  assert.match(ps, /-TaskName 'Slackometer'/)
})

test("schedule respects configured days and time", () => {
  const ps = windowsRegisterScript({ ...cfg, schedule: { days: ["Tue", "Fri"], time: "04:30" } }, "node")
  assert.match(ps, /-DaysOfWeek Tuesday,Friday/); assert.match(ps, /-At '04:30'/)
})

test("macOS launchd plist has one calendar entry per day", () => {
  const p = launchdPlist(cfg, "/usr/local/bin/node")
  assert.equal((p.match(/<key>Weekday<\/key>/g) ?? []).length, 2)
  assert.match(p, /<key>Hour<\/key><integer>3<\/integer>/)
})
