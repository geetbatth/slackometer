// Check that bench runs keep the subscription login but none of the person's own setup
// (MCP servers, skills, plugins, CLAUDE.md). One tiny Haiku call, made exactly the way bench runs are made.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { REPO_DIR } from "./config.ts"
import { DEFAULT_ISOLATION } from "./claude.ts"
import { benchToken, claudeEnv, runsRoot } from "./isolate.ts"
import { run } from "./proc.ts"

const ASK = "List the names of any MCP servers, skills or plugins you can see, and quote any CLAUDE.md / memory instructions you were given (or say NONE). Then say OK."

/** Names that would only show up if the person's own setup leaked in. */
export function personalMarkers(home = homedir()): string[] {
  const names = new Set<string>(["mcp__"])
  const ls = (d: string) => (existsSync(d) ? readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : [])
  for (const n of ls(join(home, ".claude", "skills"))) names.add(n)
  try { // installed plugins only ("name@marketplace"), not the whole catalogue
    const j = JSON.parse(readFileSync(join(home, ".claude", "plugins", "installed_plugins.json"), "utf8"))
    for (const k of Object.keys(j.plugins ?? j)) names.add(k.split("@")[0] + ":")
  } catch { /* none */ }
  try { for (const k of Object.keys(JSON.parse(readFileSync(join(home, ".claude.json"), "utf8")).mcpServers ?? {})) names.add(k) } catch { /* none */ }
  const md = join(home, ".claude", "CLAUDE.md")
  if (existsSync(md)) { const line = readFileSync(md, "utf8").split(/\r?\n/).find((l) => l.trim().length > 25); if (line) names.add(line.trim().slice(0, 40)) }
  return [...names].filter((n) => n.length >= 4)
}

export function findLeaks(text: string, markers: string[]): string[] {
  const t = text.toLowerCase()
  return markers.filter((m) => t.includes(m.toLowerCase()))
}

export async function main(args: string[]): Promise<number> {
  const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : "claude-haiku-5-5"
  mkdirSync(runsRoot(), { recursive: true })
  const cwd = mkdtempSync(join(runsRoot(), "probe-"))
  const tok = await benchToken(120_000)
  const r = await run("claude", ["-p", ASK, "--model", model, "--max-turns", "1", "--output-format", "json", ...DEFAULT_ISOLATION], { cwd, shell: false, timeoutMs: 120_000, env: await claudeEnv(120_000) })
  rmSync(cwd, { recursive: true, force: true })
  let text = "", ok = false
  try { const j = JSON.parse(r.stdout); text = String(j.result ?? ""); ok = !j.is_error } catch { text = (r.stderr || r.stdout).slice(0, 500) }
  const leaks = ok ? findLeaks(text, personalMarkers()) : []
  const verdict = !ok ? "NOT LOGGED IN / ERROR" : leaks.length ? "LEAKS personal setup: " + leaks.join(", ") : "clean"
  console.log(`run folder:  ${runsRoot()}`)
  console.log(`token:       ${tok.source === "saved" ? "saved long-lived token" : `your current login (valid ${Math.round(tok.validMs / 60000)} more min)`}`)
  console.log(`isolation:   ${verdict}`)
  writeFileSync(join(REPO_DIR, "runner", "fixtures", "probe.md"), ["# Isolation probe", "", `date: ${new Date().toISOString()}`, `verdict: ${verdict}`, "", "```", text.slice(0, 2000), "```", ""].join("\n"))
  if (tok.source === "login") console.log("\ntip: for unattended runs, run `claude setup-token` and save the token to ~/.slackometer/oauth-token (it never goes to GitHub).")
  return ok && !leaks.length ? 0 : 1
}
