// `setup --check`: is this machine ready to run Slackometer? Read-only; makes no Claude calls.
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { loadConfig, REPO_DIR } from "./config.ts"
import { hasTool, loadTasks, missingTools } from "./tasks.ts"
import { findChrome } from "./ui-check.ts"

const version = (cmd: string, args = ["--version"]) => { const r = spawnSync(cmd, args, { encoding: "utf8", shell: process.platform === "win32" }); return r.status === 0 ? (r.stdout || r.stderr).split(/\r?\n/)[0].trim() : null }

export async function main(): Promise<number> {
  const rows: [string, boolean, string][] = []
  const nodeMajor = Number(process.versions.node.split(".")[0])
  rows.push(["node >= 24", nodeMajor >= 24, process.versions.node])
  for (const [name, cmd] of [["git", "git"], ["gh (GitHub CLI)", "gh"], ["claude (Claude Code)", "claude"]] as const) { const v = hasTool(cmd) ? version(cmd) : null; rows.push([name, !!v, v ?? "not found"]) }
  const cred = join(homedir(), ".claude", ".credentials.json")
  rows.push(["Claude Code logged in", existsSync(cred) || process.platform === "darwin", existsSync(cred) ? "credentials found" : process.platform === "darwin" ? "macOS keychain (not checked)" : "run `claude` once and log in"])
  rows.push(["Chrome or Edge (UI tasks)", !!findChrome(), findChrome() ?? "not found"])
  for (const t of ["python", "dotnet", "powershell"]) rows.push([`${t} (task toolchain)`, hasTool(t), hasTool(t) ? "found" : "missing: tasks needing it are skipped"])
  let cfgOk = false
  try {
    const cfg = loadConfig(); cfgOk = true
    rows.push(["local.json", true, `machine ${cfg.machine}, ${cfg.contenders.map((c) => `${c.model} [${c.efforts.join(",")}]`).join("; ")}`])
    const tasksOk = existsSync(cfg.tasks_dir)
    rows.push(["private tasks repo", tasksOk, tasksOk ? cfg.tasks_dir : `${cfg.tasks_dir} not found: clone the private tasks repo there`])
    if (tasksOk) {
      const ts = loadTasks(cfg)
      const runnable = ts.filter((t) => !missingTools(t).length)
      rows.push(["tasks", runnable.length > 0, `${runnable.length}/${ts.length} runnable on this machine`])
    }
  } catch (e) { rows.push(["local.json", false, (e as Error).message.split("\n")[0]]) }
  const width = Math.max(...rows.map((r) => r[0].length))
  for (const [n, ok, info] of rows) console.log(`${ok ? "✓" : "✗"} ${n.padEnd(width)}  ${info}`)
  const pkg = JSON.parse(readFileSync(join(REPO_DIR, "package.json"), "utf8"))
  console.log(`\n${pkg.name} at ${REPO_DIR}`)
  const required = rows.filter(([n]) => /node|git|claude|logged|local\.json|tasks/.test(n))
  return cfgOk && required.every(([, ok]) => ok) ? 0 : 1
}
