import { test } from "node:test"
import assert from "node:assert/strict"
import { buildArgs } from "./claude.ts"

test("buildArgs has prompt, model, effort, stream-json, isolation and max turns", () => {
  const a = buildArgs("do it", "claude-opus-5-5", "xhigh", 60)
  const at = (f: string) => a[a.indexOf(f) + 1]
  assert.equal(a[0], "-p"); assert.equal(a[1], "do it")
  assert.equal(at("--model"), "claude-opus-5-5"); assert.equal(at("--effort"), "xhigh"); assert.equal(at("--max-turns"), "60")
  assert.equal(at("--output-format"), "stream-json"); assert.ok(a.includes("--verbose"))
  assert.ok(a.includes("--strict-mcp-config"))
})
test("isolation args can be overridden", () => {
  const a = buildArgs("x", "m", "high", 5, ["--setting-sources", "project"])
  assert.ok(a.includes("--setting-sources")); assert.ok(!a.includes("--bare"))
})
