// Find Claude Code flags that keep subscription login but drop the person's own setup
// (MCP servers, skills, hooks, CLAUDE.md). Uses a few tiny Haiku calls.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { REPO_DIR } from "./config.ts"
import { run } from "./proc.ts"

const VARIANTS: Record<string, string[]> = {
  bare: ["--bare", "--strict-mcp-config"],
  "settings-project": ["--strict-mcp-config", "--setting-sources", "project"],
  both: ["--bare", "--strict-mcp-config", "--setting-sources", "project"],
}
const ASK = "List the names of any MCP servers, skills or plugins you can see, and quote any CLAUDE.md / memory instructions you were given (or say NONE). Then say OK."

export async function main(args: string[]): Promise<number> {
  const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : "claude-haiku-5-5"
  const report: string[] = ["# Isolation probe", "", `date: ${new Date().toISOString()}`, ""]
  let chosen: string | null = null
  for (const [name, flags] of Object.entries(VARIANTS)) {
    const cwd = mkdtempSync(join(tmpdir(), "slk-probe-"))
    const r = await run("claude", ["-p", ASK, "--model", model, "--max-turns", "1", "--output-format", "json", ...flags], { cwd, shell: false, timeoutMs: 120_000 })
    let text = ""; let ok = false
    try { const j = JSON.parse(r.stdout); text = String(j.result ?? ""); ok = !j.is_error } catch { text = (r.stderr || r.stdout).slice(0, 500) }
    const leaks = /clippy|mcp__|finestra|superpowers|t3-code/i.test(text)
    const verdict = !ok ? "NOT LOGGED IN / ERROR" : leaks ? "LEAKS personal setup" : "clean"
    console.log(`${name.padEnd(18)} ${verdict}`)
    report.push(`## ${name}: ${verdict}`, "", "flags: `" + flags.join(" ") + "`", "", "```", text.slice(0, 1500), "```", "")
    if (!chosen && ok && !leaks) chosen = name
  }
  writeFileSync(join(REPO_DIR, "runner", "fixtures", "probe.md"), report.join("\n"))
  if (!chosen) { console.error("No variant was both logged in and clean. See runner/fixtures/probe.md."); return 1 }
  const localPath = join(REPO_DIR, "local.json")
  const local = JSON.parse(readFileSync(localPath, "utf8"))
  local.claude_isolation_args = VARIANTS[chosen]
  writeFileSync(localPath, JSON.stringify(local, null, 2))
  console.log(`\nUsing "${chosen}" (${VARIANTS[chosen].join(" ")}); saved to local.json`)
  return 0
}
