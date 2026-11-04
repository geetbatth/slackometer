import { test } from "node:test"
import assert from "node:assert/strict"
import { homedir } from "node:os"
import { relative } from "node:path"
import { mkdirSync, realpathSync } from "node:fs"
import { claudeEnv, runsRoot } from "./isolate.ts"
import { findLeaks } from "./probe.ts"

test("run folders are never under the home folder (CLAUDE.md is searched in every parent)", () => {
  mkdirSync(runsRoot(), { recursive: true })
  const r = relative(realpathSync.native(homedir()).toLowerCase(), realpathSync.native(runsRoot()).toLowerCase())
  assert.ok(r.startsWith(".."), `${runsRoot()} is inside ${homedir()}`)
})

test("bench claude gets its own config folder and the subscription token, never an API key", async () => {
  const save = { ...process.env }
  try {
    process.env.SLACKOMETER_OAUTH_TOKEN = "tok-123"; process.env.ANTHROPIC_API_KEY = "sk-nope"; process.env.CLAUDECODE = "1"
    const env = await claudeEnv(60_000)
    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "tok-123")
    assert.match(env.CLAUDE_CONFIG_DIR!, /claude-home$/)
    assert.equal(env.ANTHROPIC_API_KEY, undefined)
    assert.equal(env.CLAUDECODE, undefined)
  } finally { process.env = save }
})

test("probe flags the person's own skills, plugins and MCP tools", () => {
  const markers = ["mcp__", "grill-web", "superpowers"]
  assert.deepEqual(findLeaks("Skills: dataviz, init", markers), [])
  assert.deepEqual(findLeaks("Skills: grill-web; tools mcp__clippy__ask_user", markers).sort(), ["grill-web", "mcp__"])
})
