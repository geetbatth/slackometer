// Keep the person's own Claude Code setup (CLAUDE.md, skills, plugins, hooks, MCP servers, memory)
// out of bench runs while still using their subscription login.
//
// --bare can't be used: it only accepts an API key and ignores subscription logins.
// Instead each run gets:
//   * CLAUDE_CONFIG_DIR = an empty config folder of its own, so no personal settings or skills,
//   * CLAUDE_CODE_OAUTH_TOKEN = the subscription token, so the person's own login files are never touched,
//   * a run folder outside the home folder, because Claude Code looks for CLAUDE.md in every parent
//     folder, and ~/.claude/CLAUDE.md would be found from anywhere under the home folder.
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, parse, relative, isAbsolute } from "node:path"
import { defaultRefresh, readCreds } from "./usage.ts"

const slkHome = () => process.env.SLACKOMETER_HOME ?? join(homedir(), ".slackometer")

// real paths: Windows may hand out 8.3 short names (C:\Users\USER~1.SUR) for the same folder
const real = (p: string) => { try { return realpathSync.native(p) } catch { return p } }
const inside = (child: string, parent: string) => {
  const r = relative(real(parent).toLowerCase(), real(child).toLowerCase())
  return r === "" || (!r.startsWith("..") && !isAbsolute(r))
}

/** Where run folders go: never under the home folder (see above). */
export function runsRoot(): string {
  if (process.env.SLACKOMETER_RUNS_DIR) return process.env.SLACKOMETER_RUNS_DIR
  const tmp = tmpdir()
  return inside(tmp, homedir()) ? join(parse(homedir()).root, "slackometer-runs") : join(tmp, "slackometer")
}

/** Long-lived token from `claude setup-token`, if the person saved one. */
function savedToken(): string | null {
  if (process.env.SLACKOMETER_OAUTH_TOKEN) return process.env.SLACKOMETER_OAUTH_TOKEN.trim()
  const f = join(slkHome(), "oauth-token")
  return existsSync(f) ? readFileSync(f, "utf8").trim() || null : null
}

/** A token that stays valid for at least `minValidMs` (best effort without a saved token). */
export async function benchToken(minValidMs: number): Promise<{ token: string; source: "saved" | "login"; validMs: number }> {
  const saved = savedToken()
  if (saved) return { token: saved, source: "saved", validMs: Infinity }
  let c = readCreds()
  const short = () => !!c.expiresAt && c.expiresAt < Date.now() + minValidMs + 5 * 60_000
  if (short()) { await defaultRefresh(); c = readCreds() }
  if (short()) {
    // Claude Code only renews its token close to expiry: wait for that, then renew, so a run never loses its login midway
    const wait = c.expiresAt - Date.now() - 2 * 60_000
    if (wait > 0) { console.log(`  login token expires in ${Math.round(wait / 60000) + 2} min, too soon for the next run; waiting to renew it`); await new Promise((r) => setTimeout(r, wait)) }
    await defaultRefresh(); c = readCreds()
  }
  return { token: c.accessToken, source: "login", validMs: c.expiresAt ? c.expiresAt - Date.now() : Infinity }
}

/** Environment for a bench `claude` process. */
export async function claudeEnv(minValidMs: number): Promise<NodeJS.ProcessEnv> {
  const configDir = join(slkHome(), "claude-home")
  mkdirSync(configDir, { recursive: true })
  const { token } = await benchToken(minValidMs)
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CONFIG_DIR: configDir, CLAUDE_CODE_OAUTH_TOKEN: token }
  delete env.ANTHROPIC_API_KEY // never bill an API key by accident
  for (const k of Object.keys(env)) if (k.startsWith("CLAUDECODE") || k === "CLAUDE_CODE_ENTRYPOINT") delete env[k] // don't look like a nested session
  return env
}
