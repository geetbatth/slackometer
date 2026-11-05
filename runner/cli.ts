#!/usr/bin/env node
// Slackometer command line. Each command lives in its own module, loaded on demand.
const COMMANDS: Record<string, { help: string; load: () => Promise<{ main: (args: string[]) => Promise<number> }> }> = {
  setup: { help: "setup --check            check toolchains, Claude login, tasks repo (read-only)", load: () => import("./setup.ts") },
  probe: { help: "probe                    test Claude Code isolation flags (tiny Haiku calls)", load: () => import("./probe.ts") },
  validate: { help: "validate [task|all]      prove each grader fails on the starter and passes on the reference", load: () => import("./validate-cmd.ts") },
  "ui-grade": { help: "ui-grade <checks.json>   (used by UI task graders)", load: () => import("./ui-grade.ts") },
  "run-one": { help: "run-one <task> <effort> [--model m]   one real run, for testing", load: () => import("./run-one-cmd.ts") },
  calibrate: { help: "calibrate [--yes]        run every task x level once, then lock a suite (uses real usage)", load: () => import("./calibrate-cmd.ts") },
  run: { help: "run [--date YYYY-MM-DD]  run today's locked suite (what the schedule calls)", load: () => import("./batch-cmd.ts") },
  index: { help: "index                    rebuild site/data/runs.js from results/", load: () => import("./index-cmd.ts") },
  reparse: { help: "reparse                  recompute transcript metrics for finished runs (after parser fixes)", load: () => import("./reparse.ts") },
  usage: { help: "usage                    show current Claude usage and the guard verdict", load: () => import("./usage-cmd.ts") },
  quiet: { help: "quiet pause|resume|status", load: () => import("./quiet-cmd.ts") },
  schedule: { help: "schedule register|unregister|status", load: () => import("./schedule-cmd.ts") },
}

export function usage(): string {
  return "Slackometer\n\nUsage: node runner/cli.ts <command>\n\n" + Object.values(COMMANDS).map((c) => "  " + c.help).join("\n") + "\n"
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv
  const entry = cmd ? COMMANDS[cmd] : undefined
  if (!entry) { process.stderr.write(usage()); return 1 }
  if (cmd !== "quiet") {
    // a calibration that crashed must never leave the person's other Claude usage paused
    const { resumeIfPaused } = await import("./quiet.ts").catch(() => ({ resumeIfPaused: async () => {} }))
    await resumeIfPaused()
  }
  const mod = await entry.load()
  if (["run", "calibrate", "run-one", "probe"].includes(cmd!) && !(cmd === "calibrate" && !rest.includes("--yes"))) {
    const { acquireRunLock } = await import("./lock.ts")
    const release = acquireRunLock(cmd!)
    try { return await mod.main(rest) } finally { release() }
  }
  return mod.main(rest)
}

const isMain = import.meta.url === new URL(process.argv[1], "file:").href || process.argv[1]?.endsWith("cli.ts")
if (isMain) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
    process.stderr.write((e?.name === "ConfigError" ? "" : "Error: ") + (e?.message ?? String(e)) + "\n")
    process.exit(2)
  })
}
