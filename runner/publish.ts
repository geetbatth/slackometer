// Commit this machine's results and the rebuilt site data, then push. Rebase and retry on a race; never force.
import { appendFileSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { run } from "./proc.ts"
import { loadTasks } from "./tasks.ts"
import type { LocalConfig } from "./types.ts"

async function git(cwd: string, ...args: string[]) {
  const r = await run("git", args, { cwd, shell: false, timeoutMs: 120_000 })
  return { ok: r.code === 0, out: r.stdout + r.stderr }
}

/** local-only private benches: keep their result files out of git entirely. */
function excludePrivate(cfg: LocalConfig) {
  if (cfg.private_results !== "local-only" || !cfg.private_benches.length) return
  const excl = join(cfg.repo_dir, ".git", "info", "exclude")
  if (!existsSync(excl)) return
  const have = readFileSync(excl, "utf8")
  const ids = loadTasks({ ...cfg, benches: [] }).map((t) => t.id)
  const lines = ids.map((id) => `results/*/*/${id}__*.json`).filter((l) => !have.includes(l))
  if (lines.length) appendFileSync(excl, "\n" + lines.join("\n") + "\n")
}

export async function publish(cfg: LocalConfig, message: string): Promise<void> {
  const cwd = cfg.repo_dir
  excludePrivate(cfg)
  const toAdd = ["results", "site/data"].filter((p) => existsSync(join(cwd, p)))
  if (!toAdd.length) return
  await git(cwd, "add", "--", ...toAdd)
  const staged = await git(cwd, "diff", "--cached", "--quiet")
  if (staged.ok) return // nothing to commit
  const c = await git(cwd, "commit", "-q", "-m", message)
  if (!c.ok) throw new Error(`git commit failed: ${c.out}`)
  for (let attempt = 1; attempt <= 3; attempt++) {
    const p = await git(cwd, "push", "-q", "origin", "HEAD")
    if (p.ok) return
    if (!/non-fast-forward|fetch first|rejected/i.test(p.out) || attempt === 3) throw new Error(`git push failed: ${p.out}`)
    const r = await git(cwd, "pull", "-q", "--rebase", "origin", "HEAD")
    if (!r.ok) { await git(cwd, "rebase", "--abort"); throw new Error(`git pull --rebase failed (results are committed locally; push by hand): ${r.out}`) }
  }
}
