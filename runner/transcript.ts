// Turn a Claude Code stream-json transcript into RunMetrics. Deterministic; no model calls.
import type { RunMetrics, TaskDef } from "./types.ts"

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"])
const DONE = /\b(done|complete[d]?|fixed|implemented|all tests pass|tests (are )?(passing|green)|verified|works now)\b/i
const HEDGE = /\b(couldn'?t|could not|unable|not (yet )?(run|verified|tested)|partially|may (still )?(fail|remain)|please (check|verify)|didn'?t)\b/i
const LIMIT = /usage limit|rate limit|\b429\b|overloaded|limit reached/i

type Json = Record<string, any>

// Reading through the shell counts as reading: models often explore with `cat a.cs b.cs` instead of the Read tool.
const SHELL_READERS = new Set(["cat", "head", "tail", "less", "more", "type", "nl", "bat", "get-content", "gc"])
export function shellReadFiles(command: string): string[] {
  const out: string[] = []
  for (const seg of command.split(/&&|\|\||;|\||\r?\n/)) {
    const words = seg.trim().match(/"[^"]*"|'[^']*'|\S+/g) ?? []
    if (!words.length) continue
    const cmd = words[0].toLowerCase()
    const sedN = cmd === "sed" && words.includes("-n")
    if (!SHELL_READERS.has(cmd) && !sedN) continue
    for (let i = 1; i < words.length; i++) {
      const w = words[i].replace(/^["']|["']$/g, "")
      if (/^[<>&0-9]*[<>]/.test(w)) break                       // redirection: the rest isn't input
      if (w.startsWith("-")) { if (/^-(n|c|-lines|-bytes|TotalCount|Tail|Head)$/i.test(w)) i++; continue }
      if (sedN && /^\d*,?\$?\d*p$|^\d+,\d+p$/.test(w)) continue   // sed -n '1,40p' script
      if (/^\d+$/.test(w)) continue
      out.push(w)
    }
  }
  return out
}
const normPath = (p: string, cwd: string) => {
  let x = p.replace(/\\/g, "/").toLowerCase()
  const c = cwd.replace(/\\/g, "/").toLowerCase().replace(/\/$/, "")
  if (c && x.startsWith(c + "/")) x = x.slice(c.length + 1)
  return x.replace(/^\.\//, "")
}
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`

export function parseTranscript(lines: string[], t: Pick<TaskDef, "test_command_hints">, wallMs: number, timedOut: boolean, stderr = ""): RunMetrics {
  const msgs: Json[] = []
  for (const l of lines) { try { msgs.push(JSON.parse(l)) } catch { /* partial line from a killed process */ } }
  const hints = t.test_command_hints.map((h) => new RegExp(h, "i"))
  const init = msgs.find((m) => m.type === "system" && m.subtype === "init") ?? {}
  const result = [...msgs].reverse().find((m) => m.type === "result")

  // ordered tool calls
  const calls: { name: string; input: Json }[] = []
  for (const m of msgs) if (m.type === "assistant") for (const c of m.message?.content ?? []) if (c?.type === "tool_use") calls.push({ name: c.name, input: c.input ?? {} })

  const isTest = (c: { name: string; input: Json }) => c.name === "Bash" && hints.some((h) => h.test(String(c.input.command ?? "")))
  const firstEdit = calls.findIndex((c) => EDIT_TOOLS.has(c.name))
  let lastEdit = -1; calls.forEach((c, i) => { if (EDIT_TOOLS.has(c.name)) lastEdit = i })
  const cwd = String(init.cwd ?? "")
  const reads = calls.flatMap((c, i) =>
    c.name === "Read" ? [{ f: normPath(String(c.input.file_path), cwd), i }]
    : c.name === "Bash" ? shellReadFiles(String(c.input.command ?? "")).map((f) => ({ f: normPath(f, cwd), i }))
    : [])
  const files = new Set(reads.map((r) => r.f))
  const before = new Set(reads.filter(({ i }) => firstEdit < 0 || i < firstEdit).map((r) => r.f))
  const testIdx = calls.map((c, i) => (isTest(c) ? i : -1)).filter((i) => i >= 0)
  const edits = calls.filter((c) => EDIT_TOOLS.has(c.name)).length
  const ran = testIdx.length > 0
  const verified = ran && testIdx.some((i) => i > lastEdit)

  const text = String(result?.result ?? "")
  const limited = (!result && LIMIT.test(stderr)) || (result?.is_error && (LIMIT.test(text) || LIMIT.test(stderr))) || msgs.some((m) => (m.type === "error" || (m.type === "system" && /retry|error/i.test(String(m.subtype ?? "")))) && LIMIT.test(JSON.stringify(m)))
  const end: RunMetrics["end"] = limited ? "limited" : timedOut ? "timeout" : result?.subtype === "error_max_turns" ? "turn_limit" : !result || result.is_error ? "errored" : "finished"
  const u = result?.usage ?? {}

  const testsPart = !ran ? "; never ran the tests" : `, ran tests ${plural(testIdx.length, "time")}; ${verified ? "re-ran them after its last edit" : "never re-ran them after its last edit"}`
  return {
    output_tokens: u.output_tokens ?? 0, thinking_tokens: u.output_tokens_details?.thinking_tokens ?? 0, input_tokens: u.input_tokens ?? 0,
    cache_read_tokens: u.cache_read_input_tokens ?? 0, cache_write_tokens: u.cache_creation_input_tokens ?? 0,
    cost_usd: Number(result?.total_cost_usd ?? 0), tool_calls: calls.length, turns: Number(result?.num_turns ?? 0),
    files_read: files.size, files_read_before_first_edit: before.size,
    ran_tests: ran, verified_after_last_edit: verified, minutes: Math.round(wallMs / 6000) / 10,
    claimed_done: DONE.test(text) && !HEDGE.test(text), claim_text: text.slice(0, 280),
    digest: `Read ${plural(files.size, "file")} (${before.size} before its first edit), made ${plural(edits, "edit")}${testsPart}.`,
    cc_version: String(init.claude_code_version ?? init.version ?? ""), model_id: String(init.model ?? ""),
    end,
  }
}
