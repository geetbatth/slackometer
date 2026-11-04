import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findChrome, uiCheck } from "./ui-check.ts"

const fx = (f: string) => join(import.meta.dirname, "fixtures/ui", f)
const skip = !findChrome() ? "no Chrome/Edge on this machine" : false
const checks = { selectors: ["#settings", "form button[type=submit]", "#name"], states: ["[data-state=empty]", "[data-state=error]"] }

test("good.html renders with 0 errors and all selectors", { skip }, async () => {
  const out = mkdtempSync(join(tmpdir(), "slk-ui-"))
  const r = await uiCheck(fx("good.html"), checks, out)
  assert.equal(r.renders, true); assert.equal(r.console_errors, 0)
  assert.deepEqual(r.missing, []); assert.equal(r.states_present, 2); assert.equal(r.mobile_overflow, false)
  assert.equal(r.screenshots.length, 2); assert.ok(r.screenshots.every((s) => existsSync(s)))
})

test("broken.html counts console errors, missing selectors and mobile overflow", { skip }, async () => {
  const out = mkdtempSync(join(tmpdir(), "slk-ui-"))
  const r = await uiCheck(fx("broken.html"), checks, out)
  assert.ok(r.console_errors >= 2, `errors=${r.console_errors}`)
  assert.deepEqual(r.missing.sort(), ["#name", "#settings", "form button[type=submit]"])
  assert.equal(r.states_present, 0); assert.equal(r.mobile_overflow, true)
})
