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

test("reading through the shell counts as reading files", async () => {
  const { shellReadFiles } = await import("./transcript.ts")
  assert.deepEqual(shellReadFiles("cat Importer/*.cs Importer/*.csproj tests/*"), ["Importer/*.cs", "Importer/*.csproj", "tests/*"])
  assert.deepEqual(shellReadFiles("find . -type f | head -50 && cat README.md"), ["README.md"])
  assert.deepEqual(shellReadFiles("head -n 40 src/a.ts; sed -n '1,80p' src/b.ts"), ["src/a.ts", "src/b.ts"])
  assert.deepEqual(shellReadFiles("Get-Content -TotalCount 20 .\\app.ps1"), [".\\app.ps1"])
  assert.deepEqual(shellReadFiles("dotnet test 2>&1 | tail -25"), [])
  assert.deepEqual(shellReadFiles("cat > notes.txt"), [])
})

test("shell reads appear in files_read; thinking tokens are recorded", async () => {
  const { parseTranscript } = await import("./transcript.ts")
  const lines = [
    { type: "system", subtype: "init", cwd: "C:\\runs\\x", claude_code_version: "2.1.316", model: "claude-opus-5-5" },
    { type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "cat README.md src/a.cs" } }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "C:\\runs\\x\\src\\a.cs" } }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "C:\\runs\\x\\src\\a.cs" } }] } },
    { type: "result", subtype: "success", result: "Done.", total_cost_usd: 0.1, num_turns: 3, usage: { output_tokens: 900, output_tokens_details: { thinking_tokens: 400 } } },
  ].map((x) => JSON.stringify(x))
  const m = parseTranscript(lines, { test_command_hints: [] }, 60_000, false)
  assert.equal(m.files_read, 2)                 // README.md and src/a.cs (same file via cat and Read)
  assert.equal(m.files_read_before_first_edit, 2)
  assert.equal(m.thinking_tokens, 400)
})
