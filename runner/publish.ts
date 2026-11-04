// Publish this machine's results: pull first, rebuild the site index on top of everyone's results, commit, push.
// On a push race: undo our commit, pull again, rebuild, retry (max 3). Never force-push.
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

async function hasUpstream(cwd: string) { return (await git(cwd, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")).ok }

export async function publish(cfg: LocalConfig, message: string, rebuild: () => Promise<unknown> = async () => {}): Promise<void> {
  const cwd = cfg.repo_dir
  excludePrivate(cfg)
  const upstream = await hasUpstream(cwd)
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (upstream) {
      // the generated index will be rebuilt, so drop any local copy that would conflict with the pull
      await git(cwd, "checkout", "--", "site/data")
      const p = await git(cwd, "pull", "-q", "--rebase", "--autostash")
      if (!p.ok) { await git(cwd, "rebase", "--abort"); throw new Error(`git pull failed (results are saved locally; publish later): ${p.out}`) }
    }
    await rebuild()
    const toAdd = ["results", "site/data"].filter((p) => existsSync(join(cwd, p)))
    if (!toAdd.length) return
    await git(cwd, "add", "--", ...toAdd)
    if ((await git(cwd, "diff", "--cached", "--quiet")).ok) return // nothing new
    const c = await git(cwd, "commit", "-q", "-m", message)
    if (!c.ok) throw new Error(`git commit failed: ${c.out}`)
    if (!upstream) return
    const push = await git(cwd, "push", "-q")
    if (push.ok) return
    if (!/non-fast-forward|fetch first|rejected/i.test(push.out) || attempt === 3) throw new Error(`git push failed (results are committed locally): ${push.out}`)
    // someone pushed meanwhile: undo our commit (keep the files), pull, rebuild, try again
    await git(cwd, "reset", "-q", "--soft", "HEAD~1")
    await git(cwd, "reset", "-q")
  }
}
