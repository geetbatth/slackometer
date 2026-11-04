# Calibrating (one-off, overnight)

Calibration runs **every** task at **every** effort level once. It measures what each one costs and works out how your Claude usage % maps to API-equivalent dollars. Then it **locks** the biggest balanced daily suite that fits your budget. From then on every run day runs exactly that suite. Re-calibrate only when you change models, effort levels, budget, or add tasks.

It uses real usage, possibly several % of your weekly limit, so start it **when you're done for the day**.

*Steps for Claude to walk the person through:*

1. **Quiet everything else down first.** Other Claude usage during calibration ruins the measurement. Ask the person what else uses their Claude subscription on this machine and elsewhere:
   - **Scheduled things you can pause with tools** (for example T3 Code scheduled tasks across all projects): pause them now with those tools, and add a note of each to `local.json` › `quiet.manual` so you remember to resume them.
   - **Windows scheduled tasks** that start Claude: add their names to `quiet.scheduled_tasks`. The runner disables them during calibration and re-enables them afterwards.
   - **Apps that use Claude** (for example Claude Desktop): add process names to `quiet.close_apps`. The runner closes them gracefully and reopens them afterwards. **Don't list the app you're running this from.**
   - **The phone and claude.ai:** ask the person not to use Claude anywhere else until calibration finishes.

2. **Run it from a plain terminal** (not from inside a Claude Code session, which may get closed):
   ```
   node runner/cli.ts calibrate            # shows the estimate, changes nothing
   node runner/cli.ts calibrate --yes      # actually runs it
   ```
   The runner writes a pause list before it touches anything, waits a few minutes to check usage has stopped moving, runs everything, then **always** restores what it paused, even if it crashes. If anything is left paused, the next runner command restores it, or run `node runner/cli.ts quiet resume`.

3. **Afterwards:** resume anything you paused by hand (`quiet.manual`). Check `results/<machine>/suites/` for the new lock. `node runner/cli.ts usage` shows the learned rate and what one run day costs.

If calibration stops early (usage reached 90%, the PC slept, and so on), finished runs are kept. Run `calibrate --yes` again later to start a fresh calibration.
