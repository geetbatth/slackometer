import { join } from "node:path"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { defaults } from "./config.ts"
export const FIXTURE_TASKS = join(import.meta.dirname, "fixtures")
// each config gets its own throwaway home, so tests never touch the real ~/.slackometer
export const fixtureCfg = () => ({ ...defaults(), machine: "t", person: "t", tasks_dir: FIXTURE_TASKS, benches: ["demo"], home_dir: mkdtempSync(join(tmpdir(), "slk-home-")) })
