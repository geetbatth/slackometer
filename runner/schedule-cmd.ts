import { loadConfig } from "./config.ts"
import { register, status, unregister } from "./schedule.ts"

export async function main(args: string[]): Promise<number> {
  const sub = args[0] ?? "status"
  if (sub === "register") { console.log(await register(loadConfig())); return 0 }
  if (sub === "unregister") { console.log(await unregister()); return 0 }
  if (sub === "status") { console.log(await status()); return 0 }
  console.error("usage: schedule register|unregister|status"); return 1
}
