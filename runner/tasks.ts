import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import type { LocalConfig, TaskDef } from "./types.ts"

const REQUIRED = ["id", "title", "language", "kind", "difficulty", "version", "time_limit_min", "max_turns", "required_tools", "test_command_hints", "grade"] as const

function benchDirs(cfg: LocalConfig): string[] {
  const shared = cfg.benches.map((b) => join(cfg.tasks_dir, "benches", b))
  const priv = cfg.private_benches.map((p) => resolve(p))
  return [...shared, ...priv]
}

export function loadTasks(cfg: LocalConfig): TaskDef[] {
  const out: TaskDef[] = []
  const seen = new Map<string, string>()
  for (const bdir of benchDirs(cfg)) {
    if (!existsSync(bdir)) throw new Error(`bench folder not found: ${bdir}`)
    const bench = existsSync(join(bdir, "bench.json")) ? JSON.parse(readFileSync(join(bdir, "bench.json"), "utf8")).id : bdir.split(/[\/]/).pop()!
    const tdir = join(bdir, "tasks")
    if (!existsSync(tdir)) continue
    for (const name of readdirSync(tdir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
      const dir = join(tdir, name)
      const file = join(dir, "task.json")
      if (!existsSync(file)) continue
      let raw: any
      try { raw = JSON.parse(readFileSync(file, "utf8")) } catch (e) { throw new Error(`invalid JSON in ${file}: ${(e as Error).message}`) }
      const missing = REQUIRED.filter((k) => raw[k] === undefined)
      if (missing.length) throw new Error(`task ${raw.id ?? name} (${file}) is missing: ${missing.join(", ")}`)
      if (cfg.exclude_tasks.includes(raw.id)) continue
      if (seen.has(raw.id)) throw new Error(`duplicate task id "${raw.id}" in ${seen.get(raw.id)} and ${dir}`)
      seen.set(raw.id, dir)
      out.push({ ui: false, added_by: "unknown", ...raw, bench, dir })
    }
  }
  return out
}

const ALIASES: Record<string, string[]> = { powershell: ["powershell", "pwsh"], python: ["python", "python3"] }
const cache = new Map<string, boolean>()
export function hasTool(name: string): boolean {
  if (cache.has(name)) return cache.get(name)!
  const finder = process.platform === "win32" ? "where" : "which"
  const ok = (ALIASES[name] ?? [name]).some((n) => spawnSync(finder, [n], { stdio: "ignore", shell: false }).status === 0)
  cache.set(name, ok)
  return ok
}
export const missingTools = (t: TaskDef) => t.required_tools.filter((x) => !hasTool(x))
