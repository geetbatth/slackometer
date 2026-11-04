# Setting up Slackometer on a machine

*Written for Claude to follow. When a person says "set this up", work through these steps with them and confirm each one. Do not run calibration or any bench run as part of setup.*

1. **Check the machine.** Run `node runner/cli.ts setup --check`.
   - Node ≥ 24, git and Claude Code (logged in) are required. Python, .NET and PowerShell are optional: tasks that need a missing toolchain are skipped.
   - If Node is older than 24, help them upgrade first.

2. **Get the private tasks repo.** Clone `geetbatth/slackometer-tasks` next to this repo, so `../slackometer-tasks` exists. It's private: if the clone fails with "not found", the person needs to be given access. Stop and tell them.

3. **Create `local.json`** (it's gitignored) from `local.example.json`. Ask the person for:
   - `machine`: a short unique name, letters, digits and dashes only (for example `sam-laptop`)
   - `person`: their handle
   - their budget, if they want something other than the defaults (2% of the weekly limit per run day, 3% hard ceiling)
   - which benches to run (default `["core"]`) and any `private_benches` (local folders that never leave their machine)

   Leave `contenders` at the default unless they ask.

4. **Prove the tasks work here.** Run `node runner/cli.ts validate all`. Every task should print `ok`. This makes no Claude calls.

5. **Check isolation (tiny usage, ask first).** `node runner/cli.ts probe` makes 3 very small Haiku calls to find Claude Code flags that keep their login but hide their personal MCP servers, skills and CLAUDE.md from bench runs. It saves the result to `local.json`.

6. **Schedule it.** Run `node runner/cli.ts schedule register`. On Windows this registers a task that wakes the PC on Mon/Wed at 03:00. On macOS it's a launchd agent (a sleeping Mac won't wake for it). Check with `node runner/cli.ts schedule status`.

7. **Make sure they can push.** Results are committed and pushed to `main` after each run day. Check `git push --dry-run` works.

8. **Tell them the next step:** run [CALIBRATE.md](CALIBRATE.md) overnight once. Until then, scheduled runs just say "calibrate first".
