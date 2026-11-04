// Register the Mon/Wed 03:00 run: Windows Task Scheduler (wakes the PC) or a macOS launchd agent (untested).
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { run } from "./proc.ts"
import type { LocalConfig } from "./types.ts"

const DAY: Record<string, [string, number]> = { Mon: ["Monday", 1], Tue: ["Tuesday", 2], Wed: ["Wednesday", 3], Thu: ["Thursday", 4], Fri: ["Friday", 5], Sat: ["Saturday", 6], Sun: ["Sunday", 0] }
const q = (s: string) => `'${s.replace(/'/g, "''")}'`
export const TASK_NAME = "Slackometer"

export function windowsRegisterScript(cfg: LocalConfig, nodePath: string): string {
  const cli = join(cfg.repo_dir, "runner", "cli.ts")
  const logFile = join(homedir(), ".slackometer", "run.log")
  const days = cfg.schedule.days.map((d) => DAY[d][0]).join(",")
  const cmd = `& ${q(nodePath)} ${q(cli)} run *>> ${q(logFile)}`
  return [
    `$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ${q(`-NoProfile -WindowStyle Hidden -Command "${cmd.replace(/"/g, '\\"')}"`)} -WorkingDirectory ${q(cfg.repo_dir)}`,
    `$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek ${days} -At '${cfg.schedule.time}'`,
    `$settings = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 21)`,
    `Register-ScheduledTask -TaskName '${TASK_NAME}' -Action $action -Trigger $trigger -Settings $settings -Description 'Slackometer bench run (node runner/cli.ts run)' -Force | Out-Null`,
  ].join("\n")
}

export function launchdPlist(cfg: LocalConfig, nodePath: string): string {
  const [hh, mm] = cfg.schedule.time.split(":").map(Number)
  const entries = cfg.schedule.days.map((d) => `<dict><key>Weekday</key><integer>${DAY[d][1]}</integer><key>Hour</key><integer>${hh}</integer><key>Minute</key><integer>${mm}</integer></dict>`).join("")
  const log = join(homedir(), ".slackometer", "run.log")
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.slackometer.run</string>
<key>ProgramArguments</key><array><string>${nodePath}</string><string>${join(cfg.repo_dir, "runner", "cli.ts")}</string><string>run</string></array>
<key>WorkingDirectory</key><string>${cfg.repo_dir}</string>
<key>StartCalendarInterval</key><array>${entries}</array>
<key>StandardOutPath</key><string>${log}</string><key>StandardErrorPath</key><string>${log}</string>
</dict></plist>
`
}

const plistPath = () => join(homedir(), "Library", "LaunchAgents", "com.slackometer.run.plist")

export async function register(cfg: LocalConfig): Promise<string> {
  mkdirSync(join(homedir(), ".slackometer"), { recursive: true })
  if (process.platform === "win32") {
    const r = await run("powershell", ["-NoProfile", "-NonInteractive", "-Command", windowsRegisterScript(cfg, process.execPath)], { shell: false, timeoutMs: 60_000 })
    if (r.code !== 0) throw new Error(`Register-ScheduledTask failed: ${r.stderr || r.stdout}`)
    return `Registered Windows task "${TASK_NAME}": ${cfg.schedule.days.join("+")} at ${cfg.schedule.time}, wakes the PC, logs to ~/.slackometer/run.log`
  }
  if (process.platform === "darwin") {
    mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true })
    writeFileSync(plistPath(), launchdPlist(cfg, process.execPath))
    await run("launchctl", ["unload", plistPath()], { shell: false, timeoutMs: 30_000 })
    await run("launchctl", ["load", plistPath()], { shell: false, timeoutMs: 30_000 })
    return `Loaded launchd agent com.slackometer.run (untested on macOS; macOS will not wake a sleeping Mac for it)`
  }
  throw new Error("scheduling is supported on Windows and macOS only")
}

export async function unregister(): Promise<string> {
  if (process.platform === "win32") {
    await run("powershell", ["-NoProfile", "-NonInteractive", "-Command", `Unregister-ScheduledTask -TaskName '${TASK_NAME}' -Confirm:$false -ErrorAction SilentlyContinue`], { shell: false, timeoutMs: 60_000 })
    return `Removed Windows task "${TASK_NAME}"`
  }
  if (process.platform === "darwin" && existsSync(plistPath())) { await run("launchctl", ["unload", plistPath()], { shell: false, timeoutMs: 30_000 }); return "Unloaded launchd agent" }
  return "Nothing to remove"
}

export async function status(): Promise<string> {
  if (process.platform !== "win32") return existsSync(plistPath()) ? "launchd agent installed" : "not scheduled"
  const r = await run("powershell", ["-NoProfile", "-NonInteractive", "-Command", `$t = Get-ScheduledTask -TaskName '${TASK_NAME}' -ErrorAction SilentlyContinue; if ($t) { $i = $t | Get-ScheduledTaskInfo; "$($t.State); next run $($i.NextRunTime); last run $($i.LastRunTime) (result $($i.LastTaskResult))" } else { 'not scheduled' }`], { shell: false, timeoutMs: 60_000 })
  return r.stdout.trim()
}
