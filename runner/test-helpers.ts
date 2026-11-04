import { join } from "node:path"
import { defaults } from "./config.ts"
export const FIXTURE_TASKS = join(import.meta.dirname, "fixtures")
export const fixtureCfg = () => ({ ...defaults(), machine: "t", person: "t", tasks_dir: FIXTURE_TASKS, benches: ["demo"] })
