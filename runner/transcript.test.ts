import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parseTranscript } from "./transcript.ts"

const lines = (f: string) => readFileSync(join(import.meta.dirname, "fixtures/transcripts", f), "utf8").split("\n").filter(Boolean)
const hints = { test_command_hints: ["node --test", "python -m unittest", "pytest"] }
const parse = (f: string, timedOut = false) => parseTranscript(lines(f), hints, 240_000, timedOut)

test("counts reads before first edit, unique files, tool calls", () => {
  const m = parse("verified.jsonl")
  assert.equal(m.tool_calls, 7)
  assert.equal(m.files_read, 3)
  assert.equal(m.files_read_before_first_edit, 2)
})
test("tokens, cost, turns, version and model come from the transcript", () => {
  const m = parse("verified.jsonl")
  assert.equal(m.output_tokens, 15500); assert.equal(m.cache_read_tokens, 98000); assert.equal(m.cache_write_tokens, 17000)
  assert.equal(m.cost_usd, 0.42); assert.equal(m.turns, 9); assert.equal(m.cc_version, "2.1.316"); assert.equal(m.model_id, "claude-opus-5-5")
  assert.equal(m.minutes, 4)
})
test("ran_tests via hint regex", () => {
  assert.equal(parse("verified.jsonl").ran_tests, true)
  assert.equal(parse("no-tests.jsonl").ran_tests, false)
})
test("verified only if tests after last edit", () => {
  assert.equal(parse("verified.jsonl").verified_after_last_edit, true)
  assert.equal(parse("tests-before-edit-only.jsonl").verified_after_last_edit, false)
})
test("claimed_done true on a plain claim, false on a hedged one", () => {
  assert.equal(parse("verified.jsonl").claimed_done, true)
  assert.equal(parse("tests-before-edit-only.jsonl").claimed_done, false)
})
test("detects limited", () => assert.equal(parse("limited.jsonl").end, "limited"))
test("a finished run that merely mentions rate limits is not limited", () => assert.equal(parse("mentions-rate-limit.jsonl").end, "finished"))
test("turn limit", () => assert.equal(parse("max-turns.jsonl").end, "turn_limit"))
test("timeout wins over finished", () => assert.equal(parse("verified.jsonl", true).end, "timeout"))
test("digest describes the work", () => {
  assert.match(parse("verified.jsonl").digest, /Read 3 files \(2 before its first edit\), made 1 edit, ran tests 2 times; re-ran them after its last edit\./)
  assert.match(parse("no-tests.jsonl").digest, /never ran the tests/)
})
test("empty transcript (claude never started) is errored, not a crash", () => {
  const m = parseTranscript([], hints, 1000, false)
  assert.equal(m.end, "errored"); assert.equal(m.output_tokens, 0)
})
