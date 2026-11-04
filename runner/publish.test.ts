import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { publish } from "./publish.ts"
import { defaults } from "./config.ts"

const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
function clone(remote: string, name: string) {
  const d = join(mkdtempSync(join(tmpdir(), "slk-pub-")), name)
  git(tmpdir(), "clone", "-q", remote, d)
  git(d, "config", "user.email", "t@example.com"); git(d, "config", "user.name", "t")
  return d
}

test("retries on non-fast-forward (two machines pushing at once)", async () => {
  const remote = mkdtempSync(join(tmpdir(), "slk-remote-"))
  git(remote, "init", "-q", "--bare", "-b", "main")
  const a = clone(remote, "a")
  writeFileSync(join(a, "README.md"), "x"); git(a, "add", "."); git(a, "commit", "-qm", "init"); git(a, "push", "-q", "origin", "main")
  const b = clone(remote, "b")
  // machine B pushes first
  mkdirSync(join(b, "results", "mb"), { recursive: true }); writeFileSync(join(b, "results", "mb", "x.json"), "{}")
  git(b, "add", "."); git(b, "commit", "-qm", "b results"); git(b, "push", "-q", "origin", "main")
  // machine A publishes without having pulled
  mkdirSync(join(a, "results", "ma"), { recursive: true }); writeFileSync(join(a, "results", "ma", "y.json"), "{}")
  await publish({ ...defaults(), machine: "ma", person: "t", repo_dir: a }, "ma results")
  const log = git(remote, "log", "--format=%s", "main")
  assert.match(log, /ma results/); assert.match(log, /b results/)
})

test("nothing to commit is a no-op", async () => {
  const remote = mkdtempSync(join(tmpdir(), "slk-remote-"))
  git(remote, "init", "-q", "--bare", "-b", "main")
  const a = clone(remote, "a")
  writeFileSync(join(a, "README.md"), "x"); git(a, "add", "."); git(a, "commit", "-qm", "init"); git(a, "push", "-q", "origin", "main")
  await publish({ ...defaults(), machine: "ma", person: "t", repo_dir: a }, "nothing")
  assert.doesNotMatch(git(remote, "log", "--format=%s", "main"), /nothing/)
})
