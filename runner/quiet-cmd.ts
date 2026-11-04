import { existsSync, readFileSync } from "node:fs"
import { loadConfig } from "./config.ts"
import { DEFAULT_STATE, pause, resume } from "./quiet.ts"

export async function main(args: string[]): Promise<number> {
  const sub = args[0] ?? "status"
  if (sub === "resume") { await resume(); console.log("Everything is resumed."); return 0 }
  if (sub === "pause") { await pause(loadConfig()); console.log("Paused. Run `node runner/cli.ts quiet resume` to undo."); return 0 }
  if (sub === "status") {
    if (!existsSync(DEFAULT_STATE)) { console.log("Nothing is paused."); return 0 }
    const m = JSON.parse(readFileSync(DEFAULT_STATE, "utf8"))
    console.log(`Paused since ${m.since}:\n  tasks: ${m.tasks.join(", ") || "-"}\n  apps: ${m.apps.map((a: { name: string }) => a.name).join(", ") || "-"}\n  manual: ${m.manual.join(", ") || "-"}`)
    return 0
  }
  console.error("usage: quiet pause|resume|status"); return 1
}
